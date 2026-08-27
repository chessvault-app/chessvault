//! The index contract of `server/refgamesIndex.ts`: the small per-game
//! codes carried on every plies row, and the replay loop that produces
//! those rows. Pinned by `native/tests/goldens.json` — behaviour here is
//! frozen to whatever the JS pipeline does, including its quirks (a
//! bogus SAN token containing 'x' still decrements `final_men`; a game
//! whose SAN stops parsing keeps the plies that did replay).

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use shakmaty::{san::SanPlus, CastlingMode, Chess, Position};

use crate::scan_pack::{encode_scan_pack, SCAN_PACK_META, SCAN_PACK_VERSION};
use crate::sql;
use crate::util::{commas, iso_now};
use crate::zobrist::{hash_position, to_db_key};

/// Plies indexed per game — `REF_MAX_PLY` in TS.
pub const REF_MAX_PLY: u32 = 30;

/// 0 white won, 1 drawn, 2 black won (anything unknown counts drawn).
pub fn result_code(result: &str) -> i64 {
    match result {
        "1-0" => 0,
        "0-1" => 2,
        _ => 1,
    }
}

/// 200-point bucket of the game's LOWER rating, floored at zero.
pub fn elo_bucket(white_elo: i64, black_elo: i64) -> i64 {
    (white_elo.min(black_elo) / 200).max(0)
}

/// Men left per side at the end, from the SAN string alone: every token
/// containing 'x' removes one man from the side not moving at that ply.
pub fn final_men(moves: &str) -> (i64, i64) {
    let mut w = 16i64;
    let mut b = 16i64;
    for (ply, san) in moves.split(' ').enumerate() {
        if san.contains('x') {
            if ply % 2 == 0 {
                b -= 1;
            } else {
                w -= 1;
            }
        }
    }
    (w, b)
}

/// One row of the plies table: the position key BEFORE the move, the
/// move as UCI (castling in king-takes-rook form, e1h1 — what chessops
/// `makeUci` writes), and the 0-based ply.
pub struct PlyRow {
    pub pos: i64,
    pub uci: String,
    pub ply: u32,
}

/// Replay a game's SAN movetext exactly as `indexPositions` does: stop
/// at `max_ply` or at the first token that fails to parse or is not
/// legal, keeping everything before the stop.
pub fn replay_plies(moves: &str, max_ply: u32) -> Vec<PlyRow> {
    let mut pos = Chess::default();
    let mut out = Vec::new();
    for (ply, token) in moves.split(' ').enumerate() {
        if ply as u32 >= max_ply {
            break;
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            break;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            break;
        };
        out.push(PlyRow {
            pos: to_db_key(hash_position(&pos)),
            uci: m.to_uci(CastlingMode::Chess960).to_string(),
            ply: ply as u32,
        });
        pos.play_unchecked(m);
    }
    out
}

/// The level bucket as the index pass computes it from the stored Elo
/// columns (read as REAL so a stray fractional Elo floors like JS).
fn elo_bucket_of(white_elo: f64, black_elo: f64) -> i64 {
    ((white_elo.min(black_elo) / 200.0).floor() as i64).max(0)
}

pub struct IndexStats {
    pub games: u64,
    pub plies: u64,
}

fn read_meta(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

/// Port of `indexPositions` in `server/refgamesIndex.ts`: build (or
/// extend) the position index of one database, in place, under WAL so a
/// server reading the file keeps a consistent snapshot throughout.
pub fn index_positions(
    db_path: &Path,
    mut append: bool,
    log: &mut dyn FnMut(&str),
) -> Result<IndexStats, Box<dyn std::error::Error>> {
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "busy_timeout", 30_000)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    // Appending replays only the games above the index's high-water id,
    // at the depth the file was indexed at. A plies table predating the
    // result/bucket columns forces a full pass.
    let mut max_ply = REF_MAX_PLY;
    let mut since_id: i64 = 0;
    if append {
        let has_eb = conn
            .query_row(
                "SELECT 1 FROM pragma_table_info('plies') WHERE name = 'eb'",
                [],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if has_eb {
            max_ply = read_meta(&conn, "index_max_ply")
                .and_then(|v| v.parse().ok())
                .filter(|&v| v > 0)
                .unwrap_or(max_ply);
            since_id = read_meta(&conn, "indexed_through")
                .and_then(|v| v.parse().ok())
                .filter(|&v| v > 0)
                .or_else(|| {
                    conn.query_row("SELECT MAX(game_id) AS n FROM plies", [], |r| r.get(0))
                        .ok()
                        .flatten()
                })
                .unwrap_or(0);
        } else {
            append = false;
        }
    }
    // Whether THIS pass emits scan packs — the TS twin's rule: a full
    // pass always packs; an append only extends packs already at the
    // current version, because a partially packed file is the one shape
    // the spec forbids.
    let packing = !append
        || (read_meta(&conn, SCAN_PACK_META).as_deref() == Some(&SCAN_PACK_VERSION.to_string())
            && conn
                .query_row(
                    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scan_pack'",
                    [],
                    |_| Ok(()),
                )
                .optional()?
                .is_some());
    if !append {
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_plies_pos; DROP TABLE IF EXISTS plies; \
             DROP INDEX IF EXISTS idx_move_counts_pos; DROP TABLE IF EXISTS move_counts; \
             DROP TABLE IF EXISTS scan_pack;",
        )?;
        conn.execute_batch(sql::PLIES_TABLE)?;
        conn.execute_batch(sql::SCAN_PACK_TABLE)?;
    } else {
        // The sums are re-derived whole either way — see the TS twin.
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_move_counts_pos; DROP TABLE IF EXISTS move_counts;",
        )?;
    }

    // Deep search's reachability columns, backfilled for databases built
    // before them.
    for column in ["ply_count", "final_wmen", "final_bmen"] {
        let _ = conn.execute_batch(&format!("ALTER TABLE games ADD COLUMN {column} INTEGER"));
    }

    // What THIS pass will replay — for an append, the games above the
    // high-water id (see the TS twin: counted against the whole table,
    // a small append logged no progress at all).
    let total = conn.query_row(
        "SELECT COUNT(*) AS n FROM games WHERE id > ?",
        [since_id],
        |r| r.get::<_, i64>(0),
    )? as u64;
    let mut games: u64 = 0;
    let mut plies: u64 = 0;

    struct GameRow {
        id: i64,
        moves: String,
        result: String,
        white_elo: f64,
        black_elo: f64,
        ply_count: Option<i64>,
    }

    // Keyset-paged batches, collected before writing — same shape as the
    // TS pass (better-sqlite3 refuses writes under an open cursor; here
    // it keeps one statement borrow at a time).
    let mut last_id = since_id;
    loop {
        let batch: Vec<GameRow> = {
            let mut page = conn.prepare_cached(
                "SELECT id, moves, result, white_elo, black_elo, ply_count \
                 FROM games WHERE id > ? ORDER BY id LIMIT 5000",
            )?;
            let rows = page.query_map([last_id], |r| {
                Ok(GameRow {
                    id: r.get(0)?,
                    moves: r.get(1)?,
                    result: r.get(2)?,
                    white_elo: r.get(3)?,
                    black_elo: r.get(4)?,
                    ply_count: r.get(5)?,
                })
            })?;
            rows.collect::<Result<_, _>>()?
        };
        if batch.is_empty() {
            break;
        }
        conn.execute_batch("BEGIN")?;
        {
            let mut insert = conn.prepare_cached(
                "INSERT INTO plies (pos, uci, game_id, ply, r, eb) VALUES (?, ?, ?, ?, ?, ?)",
            )?;
            // OR REPLACE: re-running an append over games a died pass
            // already packed must not throw on the primary key. Only
            // prepared while packing — the table may not exist at all.
            let mut insert_pack = if packing {
                Some(conn.prepare_cached(
                    "INSERT OR REPLACE INTO scan_pack (game_id, pack) VALUES (?, ?)",
                )?)
            } else {
                None
            };
            let mut set_men = conn.prepare_cached(
                "UPDATE games SET ply_count = ?, final_wmen = ?, final_bmen = ? WHERE id = ?",
            )?;
            for row in &batch {
                if row.ply_count.is_none() {
                    let (w, b) = final_men(&row.moves);
                    let count = row.moves.split(' ').count() as i64;
                    set_men.execute(params![count, w, b, row.id])?;
                }
                let r = result_code(&row.result);
                let eb = elo_bucket_of(row.white_elo, row.black_elo);
                for ply_row in replay_plies(&row.moves, max_ply) {
                    insert.execute(params![
                        ply_row.pos,
                        ply_row.uci,
                        row.id,
                        ply_row.ply,
                        r,
                        eb
                    ])?;
                    plies += 1;
                }
                // A second replay, full depth, in the pack's own module
                // — the loop above is golden-pinned and capped, and the
                // TS twin makes the same trade for the same reason.
                if let Some(insert_pack) = insert_pack.as_mut() {
                    insert_pack.execute(params![row.id, encode_scan_pack(&row.moves)])?;
                }
                games += 1;
            }
        }
        conn.execute_batch("COMMIT")?;
        last_id = batch.last().expect("non-empty batch").id;
        if games % 25_000 == 0 || games == total {
            log(&format!(
                "  positions: {} of {} games…",
                commas(games),
                commas(total)
            ));
        }
    }

    log("  positions: indexing…");
    conn.execute_batch(sql::PLIES_INDEX)?;
    log("  positions: summing per move…");
    conn.execute_batch(sql::MOVE_COUNTS)?;

    let prev_plies: u64 = if append {
        read_meta(&conn, "plies")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0)
    } else {
        0
    };
    let indexed_through: i64 = conn
        .query_row("SELECT MAX(id) AS n FROM games", [], |r| r.get(0))
        .optional()?
        .flatten()
        .unwrap_or(0);
    let mut set_meta = conn.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")?;
    if packing {
        set_meta.execute(params![SCAN_PACK_META, SCAN_PACK_VERSION.to_string()])?;
    }
    set_meta.execute(params!["plies", (prev_plies + plies).to_string()])?;
    set_meta.execute(params!["index_max_ply", max_ply.to_string()])?;
    set_meta.execute(params!["indexed_at", iso_now()])?;
    set_meta.execute(params!["indexed_through", indexed_through.to_string()])?;
    drop(set_meta);
    conn.pragma_update(None, "journal_mode", "DELETE")?;
    Ok(IndexStats { games, plies })
}
