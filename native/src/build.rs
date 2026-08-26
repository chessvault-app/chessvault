//! Port of `scripts/build-refgames.ts`: index full games (headers +
//! mainline SAN) into a browsable reference database, then run the
//! position-index pass over the result. Fresh builds write `<out>.building`
//! as fast as the disk allows and rename into place; `--append` grows the
//! live file under WAL with the same existence-seek dedup as the TS side.
//!
//! One knowing divergence: the TS parser stores SAN tokens as written in
//! the source, while pgn-reader hands over parsed moves, so the movetext
//! here is re-rendered SAN. Identical for well-formed sources (chessops
//! and Lichess both emit the same canonical SAN); a sloppy source's
//! `0-0` would land as `O-O`.

use std::fs::File;
use std::io::BufReader;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::time::Instant;

use pgn_reader::{RawTag, Reader, SanPlus, Visitor};
use rusqlite::{params, Connection};

use crate::index::{final_men, index_positions};
use crate::sql;
use crate::util::{commas, iso_now, js_number};

#[derive(Default)]
struct Game {
    variant: Option<String>,
    result: Option<String>,
    white: Option<String>,
    black: Option<String>,
    white_elo: Option<String>,
    black_elo: Option<String>,
    utc_date: Option<String>,
    date: Option<String>,
    event: Option<String>,
    eco: Option<String>,
    opening: Option<String>,
    has_fen: bool,
    sans: Vec<String>,
}

/// Collects one game per `read_game` call; all decisions happen in the
/// driver loop so the filter logic reads like the TS `handleGame`.
struct Collect;

impl Visitor for Collect {
    type Tags = Game;
    type Movetext = Game;
    type Output = Game;

    fn begin_tags(&mut self) -> ControlFlow<Game, Game> {
        ControlFlow::Continue(Game::default())
    }

    fn tag(&mut self, game: &mut Game, name: &[u8], value: RawTag<'_>) -> ControlFlow<Game> {
        let field = match name {
            b"Variant" => &mut game.variant,
            b"Result" => &mut game.result,
            b"White" => &mut game.white,
            b"Black" => &mut game.black,
            b"WhiteElo" => &mut game.white_elo,
            b"BlackElo" => &mut game.black_elo,
            b"UTCDate" => &mut game.utc_date,
            b"Date" => &mut game.date,
            b"Event" => &mut game.event,
            b"ECO" => &mut game.eco,
            b"Opening" => &mut game.opening,
            b"FEN" => {
                game.has_fen = true;
                return ControlFlow::Continue(());
            }
            _ => return ControlFlow::Continue(()),
        };
        *field = Some(value.decode_utf8_lossy().into_owned());
        ControlFlow::Continue(())
    }

    fn begin_movetext(&mut self, tags: Game) -> ControlFlow<Game, Game> {
        ControlFlow::Continue(tags)
    }

    fn san(&mut self, game: &mut Game, san_plus: SanPlus) -> ControlFlow<Game> {
        game.sans.push(san_plus.to_string());
        ControlFlow::Continue(())
    }

    fn end_game(&mut self, game: Game) -> Game {
        game
    }
}

const ACCEPTED_VARIANTS: [&str; 4] = ["standard", "chess", "classical", "normal"];
const ACCEPTED_RESULTS: [&str; 3] = ["1-0", "0-1", "1/2-1/2"];

pub fn run_build(
    sources: &[PathBuf],
    name: &str,
    data: &Path,
    append: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let out = data.join("refgames").join(format!("{name}.sqlite"));
    std::fs::create_dir_all(data.join("refgames"))?;
    if append && !out.exists() {
        return Err(format!("--append: no database called {name} to append to").into());
    }

    let tmp = out.with_extension("sqlite.building");
    if !append {
        let _ = std::fs::remove_file(&tmp);
    }
    let target = if append { &out } else { &tmp };
    let conn = Connection::open(target)?;
    conn.pragma_update(None, "journal_mode", if append { "WAL" } else { "OFF" })?;
    conn.pragma_update(None, "synchronous", if append { "NORMAL" } else { "OFF" })?;
    if append {
        conn.pragma_update(None, "busy_timeout", 30_000)?;
    }

    conn.execute_batch(sql::GAMES_SCHEMA)?;
    if append {
        for column in ["ply_count", "final_wmen", "final_bmen"] {
            let _ = conn.execute_batch(&format!("ALTER TABLE games ADD COLUMN {column} INTEGER"));
        }
        // Dedup seeks through the player index — make sure it exists
        // before the first probe.
        conn.execute_batch(sql::REFGAMES_INDEXES)?;
    }

    let mut games: u64 = 0;
    let mut skipped: u64 = 0;
    let mut duplicates: u64 = 0;
    let started = Instant::now();

    conn.execute_batch("BEGIN")?;
    {
        let mut insert = conn.prepare(
            "INSERT INTO games (white, black, white_elo, black_elo, result, date, event, eco, \
             opening, moves, ply_count, final_wmen, final_bmen) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )?;
        // The same game, byte for byte: players, result, date and
        // movetext. `date IS ?` so two missing dates also match.
        let mut exists = if append {
            Some(conn.prepare(
                "SELECT 1 FROM games WHERE white = ? AND black = ? AND result = ? \
                 AND date IS ? AND moves = ? LIMIT 1",
            )?)
        } else {
            None
        };

        let mut visitor = Collect;
        for source in sources {
            let base = source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| source.display().to_string());
            println!("indexing {base}…");
            let mut reader = Reader::new(BufReader::new(File::open(source)?));
            while let Some(game) = reader.read_game(&mut visitor)? {
                let variant = game
                    .variant
                    .as_deref()
                    .unwrap_or("standard")
                    .to_lowercase();
                let result = game.result.as_deref().unwrap_or("*");
                if !ACCEPTED_VARIANTS.contains(&variant.as_str())
                    || game.has_fen
                    || !ACCEPTED_RESULTS.contains(&result)
                {
                    skipped += 1;
                    continue;
                }
                if game.sans.len() < 2 {
                    skipped += 1;
                    continue;
                }

                let white = game.white.as_deref().unwrap_or("?");
                let black = game.black.as_deref().unwrap_or("?");
                let date = game.utc_date.as_deref().or(game.date.as_deref());
                let moves = game.sans.join(" ");
                if let Some(exists) = exists.as_mut() {
                    use rusqlite::OptionalExtension;
                    let duplicate = exists
                        .query_row(params![white, black, result, date, moves], |_| Ok(()))
                        .optional()?
                        .is_some();
                    if duplicate {
                        duplicates += 1;
                        continue;
                    }
                }
                let (wmen, bmen) = final_men(&moves);
                insert.execute(params![
                    white,
                    black,
                    js_number(game.white_elo.as_deref().unwrap_or("")),
                    js_number(game.black_elo.as_deref().unwrap_or("")),
                    result,
                    date,
                    game.event.as_deref(),
                    game.eco.as_deref(),
                    game.opening.as_deref(),
                    moves,
                    game.sans.len() as i64,
                    wmen,
                    bmen,
                ])?;
                games += 1;
                if games % 50_000 == 0 {
                    conn.execute_batch("COMMIT; BEGIN")?;
                    println!("  {} games…", commas(games));
                }
            }
        }
    }
    conn.execute_batch("COMMIT")?;

    println!("indexing…");
    conn.execute_batch(sql::REFGAMES_INDEXES)?;
    // The lookup tables summarise the whole games table, so an append
    // re-derives them rather than merging.
    if append {
        conn.execute_batch("DROP TABLE IF EXISTS players; DROP TABLE IF EXISTS openings;")?;
    }
    conn.execute_batch(sql::REFGAMES_LOOKUPS)?;

    let read_meta = |key: &str| -> Option<String> {
        use rusqlite::OptionalExtension;
        conn.query_row("SELECT value FROM meta WHERE key = ?", [key], |r| r.get(0))
            .optional()
            .ok()
            .flatten()
    };
    // The tally and the source list are maintained, not written once.
    let prev_games: u64 = if append {
        read_meta("games").and_then(|v| v.parse().ok()).unwrap_or(0)
    } else {
        0
    };
    let mut source_names: Vec<String> = if append {
        read_meta("sources")
            .unwrap_or_default()
            .split(", ")
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect()
    } else {
        Vec::new()
    };
    for source in sources {
        let base = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| source.display().to_string());
        if !source_names.contains(&base) {
            source_names.push(base);
        }
    }
    let mut set_meta = conn.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")?;
    set_meta.execute(params!["games", (prev_games + games).to_string()])?;
    set_meta.execute(params!["sources", source_names.join(", ")])?;
    set_meta.execute(params!["built_at", iso_now()])?;
    drop(set_meta);
    drop(conn);

    println!("position index…");
    index_positions(target, append, &mut |line| println!("{line}"))?;

    if !append {
        if let Err(error) = std::fs::rename(&tmp, &out) {
            // Windows: a server holding the old database open blocks the
            // rename — leave the .building file for the server to swap in.
            if error.kind() != std::io::ErrorKind::PermissionDenied {
                return Err(error.into());
            }
            println!("rename deferred (target busy) — server will swap the file in");
        }
    }
    println!(
        "done: {} games{}, {} skipped, {:.1}s → {}",
        commas(games),
        if append {
            format!(" added ({} already present)", commas(duplicates))
        } else {
            String::new()
        },
        commas(skipped),
        started.elapsed().as_secs_f64(),
        out.display(),
    );
    Ok(())
}
