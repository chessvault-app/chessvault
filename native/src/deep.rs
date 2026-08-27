//! Port of the `/refgames/deep-search` route's scan loop
//! (`server/refgames.ts`): search the whole database for a position, any
//! depth, ndjson frames on stdout identical to the JS route's. Spawned
//! per request by the server, which pipes stdout into the response
//! stream — a closed pipe (client gone, child killed) ends the scan by
//! construction.

use std::io::Write;
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;
use shakmaty::{fen::Fen, san::SanPlus, CastlingMode, Chess, Color, Position};

use crate::filters::games_where;
use crate::scan_match::{
    material_men_bounds, material_satisfied, match_signature, MaterialSpec, Rung,
};
use crate::zobrist::{hash_position, to_db_key};

pub const DEEP_SEARCH_CAP: u64 = 200;

/// What one position must equal for the game to count: the exact rung
/// compares the Zobrist key, a relaxed rung its signature (see
/// scan_match). Both sit behind the same cheap gates.
enum Target {
    Exact(i64),
    Relaxed(Rung, String),
}

/// The ply at which the game reaches the target position, or None. The
/// exact gates of the JS loop (`findPositionHit`): turn parity and men
/// counts before the expensive test, SAN's own capture mark for the men
/// (a board check would miss en passant), early exit once a side dips
/// below the target, and the final position checked too.
fn find_position_hit(
    moves: &str,
    target: &Target,
    target_w: i64,
    target_b: i64,
    want_black_to_move: bool,
) -> Option<u32> {
    let mut pos = Chess::default();
    let mut w = 16i64;
    let mut b = 16i64;
    let mut ply: u32 = 0;
    let at_target = |pos: &Chess, w: i64, b: i64, ply: u32| {
        ((ply % 2 == 1) == want_black_to_move)
            && w == target_w
            && b == target_b
            && match target {
                Target::Exact(key) => to_db_key(hash_position(pos)) == *key,
                Target::Relaxed(rung, sig) => match_signature(pos.board(), *rung) == *sig,
            }
    };
    for token in moves.split(' ') {
        if at_target(&pos, w, b, ply) {
            return Some(ply);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            break;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            break;
        };
        if token.contains('x') {
            if ply % 2 == 0 {
                b -= 1;
            } else {
                w -= 1;
            }
            if w < target_w || b < target_b {
                break;
            }
        }
        pos.play_unchecked(m);
        ply += 1;
    }
    if at_target(&pos, w, b, ply) {
        return Some(ply);
    }
    None
}

/// The FIRST ply of the earliest streak satisfying the material spec
/// for its stability length, or None — the exact shape of the JS
/// `findMaterialHit`: no parity gate, the spec's own floor as the early
/// exit, and breaks return None directly rather than falling through
/// to a final test, because the streak is stateful and re-testing a
/// counted position would count it twice.
fn find_material_hit(moves: &str, spec: &MaterialSpec, lo_w: i64, lo_b: i64) -> Option<u32> {
    let mut pos = Chess::default();
    let mut w = 16i64;
    let mut b = 16i64;
    let mut ply: u32 = 0;
    let mut streak: u32 = 0;
    let step = |pos: &Chess, ply: u32, streak: &mut u32| -> Option<u32> {
        if material_satisfied(pos.board(), spec) {
            *streak += 1;
            if *streak >= spec.stable {
                // ply + 1 first: u32, and ply - stable alone underflows
                // on the very first ply of a stable-1 spec.
                return Some(ply + 1 - spec.stable);
            }
        } else {
            *streak = 0;
        }
        None
    };
    for token in moves.split(' ') {
        if let Some(hit) = step(&pos, ply, &mut streak) {
            return Some(hit);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            return None;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            return None;
        };
        if token.contains('x') {
            if ply % 2 == 0 {
                b -= 1;
            } else {
                w -= 1;
            }
            if w < lo_w || b < lo_b {
                return None;
            }
        }
        pos.play_unchecked(m);
        ply += 1;
    }
    step(&pos, ply, &mut streak)
}

/// One hunt per invocation: a position (fen, optionally relaxed by
/// `rung`) or a material situation (`material`, the server's canonical
/// spec JSON). The server enforces exclusivity; both here is a usage
/// error.
pub fn run_deep_search(
    db_path: &Path,
    fen: Option<&str>,
    rung: Option<&str>,
    material: Option<&str>,
    filters: &dyn Fn(&str) -> Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // The men-column prefilter, one shape for every hunt — see the JS
    // route for why final counts against a ceiling are sufficient.
    let spec: Option<MaterialSpec> = material
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "bad material spec")?;
    let mut target = Target::Exact(0);
    let mut target_w = 0i64;
    let mut target_b = 0i64;
    let mut want_black_to_move = false;
    let (men_ceil_w, men_ceil_b, min_ply, material_floor) = if let Some(spec) = &spec {
        let (lo_w, hi_w, lo_b, hi_b) = material_men_bounds(spec);
        (hi_w, hi_b, i64::from(spec.stable) - 1, Some((lo_w, lo_b)))
    } else {
        let fen = fen.ok_or("--fen or --material is required")?;
        let parsed: Fen = fen.trim().parse().map_err(|_| "bad fen")?;
        let pos: Chess = parsed
            .into_position(CastlingMode::Chess960)
            .map_err(|_| "bad position")?;
        target = match rung {
            None => Target::Exact(to_db_key(hash_position(&pos))),
            Some(raw) => {
                let rung = Rung::parse(raw).ok_or("bad match mode")?;
                Target::Relaxed(rung, match_signature(pos.board(), rung))
            }
        };
        target_w = i64::from(pos.board().white().count() as u32);
        target_b = i64::from(pos.board().black().count() as u32);
        want_black_to_move = pos.turn() == Color::Black;
        (target_w, target_b, 32 - target_w - target_b, None)
    };

    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let has_table = |name: &str| {
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            [name],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
    };
    let seek_players = has_table("players");
    let gw = games_where(filters, "", seek_players);
    let sql_and = if gw.clauses.is_empty() {
        String::new()
    } else {
        format!(" AND {}", gw.clauses.join(" AND "))
    };
    // A database indexed before the reachability columns scans without
    // the prefilter — slower, never wrong.
    let has_men = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('games') WHERE name = 'final_wmen'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let men_where = if has_men {
        " AND (final_wmen IS NULL OR final_wmen <= ?)
          AND (final_bmen IS NULL OR final_bmen <= ?)
          AND (ply_count IS NULL OR ply_count >= ?)"
    } else {
        ""
    };
    let men_binds: Vec<Value> = if has_men {
        vec![
            Value::Integer(men_ceil_w),
            Value::Integer(men_ceil_b),
            Value::Integer(min_ply),
        ]
    } else {
        Vec::new()
    };

    let count_binds: Vec<&dyn rusqlite::ToSql> = men_binds
        .iter()
        .chain(gw.binds.iter())
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect();
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) AS n FROM games WHERE 1{men_where}{sql_and}"),
        count_binds.as_slice(),
        |r| r.get(0),
    )?;

    let mut page = conn.prepare(&format!(
        "SELECT id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves
         FROM games
         WHERE id > ?{men_where}{sql_and}
         ORDER BY id LIMIT 1000"
    ))?;

    struct Row {
        id: i64,
        white: String,
        black: String,
        white_elo: f64,
        black_elo: f64,
        result: String,
        date: Option<String>,
        event: Option<String>,
        eco: Option<String>,
        opening: Option<String>,
        moves: String,
    }

    // Mirrors movesPreview in server/refgames.ts — the JS scan emits the
    // same two fields, and the two implementations must answer identically.
    const SAN_PREFIX_PLIES: usize = 24;
    fn moves_preview(moves: &str) -> (u64, Option<String>) {
        if moves.is_empty() {
            return (0, None);
        }
        let sans: Vec<&str> = moves.split(' ').collect();
        let prefix = sans[..sans.len().min(SAN_PREFIX_PLIES)].join(" ");
        (sans.len() as u64, Some(prefix))
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    // The parent closing the pipe is the cancel signal — stop quietly.
    macro_rules! emit {
        ($value:expr) => {
            if writeln!(out, "{}", $value)
                .and_then(|()| out.flush())
                .is_err()
            {
                return Ok(());
            }
        };
    }

    let mut last_id: i64 = 0;
    let mut scanned: u64 = 0;
    let mut matched: u64 = 0;
    loop {
        let batch: Vec<Row> = {
            let last = Value::Integer(last_id);
            let binds: Vec<&dyn rusqlite::ToSql> = std::iter::once(&last as &dyn rusqlite::ToSql)
                .chain(men_binds.iter().map(|v| v as &dyn rusqlite::ToSql))
                .chain(gw.binds.iter().map(|v| v as &dyn rusqlite::ToSql))
                .collect();
            let rows = page.query_map(binds.as_slice(), |r| {
                Ok(Row {
                    id: r.get(0)?,
                    white: r.get(1)?,
                    black: r.get(2)?,
                    white_elo: r.get(3)?,
                    black_elo: r.get(4)?,
                    result: r.get(5)?,
                    date: r.get(6)?,
                    event: r.get(7)?,
                    eco: r.get(8)?,
                    opening: r.get(9)?,
                    moves: r.get(10)?,
                })
            })?;
            rows.collect::<Result<_, _>>()?
        };
        if batch.is_empty() {
            break;
        }
        for row in &batch {
            scanned += 1;
            let hit = match (&spec, material_floor) {
                (Some(spec), Some((lo_w, lo_b))) => {
                    find_material_hit(&row.moves, spec, lo_w, lo_b)
                }
                _ => find_position_hit(&row.moves, &target, target_w, target_b, want_black_to_move),
            };
            if let Some(hit_ply) = hit {
                matched += 1;
                let elo = |v: f64| {
                    if v.fract() == 0.0 {
                        json!(v as i64)
                    } else {
                        json!(v)
                    }
                };
                let (ply_count, san_prefix) = moves_preview(&row.moves);
                emit!(json!({
                    "type": "game",
                    "ply": hit_ply,
                    "id": row.id,
                    "white": row.white,
                    "black": row.black,
                    "white_elo": elo(row.white_elo),
                    "black_elo": elo(row.black_elo),
                    "result": row.result,
                    "date": row.date,
                    "event": row.event,
                    "eco": row.eco,
                    "opening": row.opening,
                    "plyCount": ply_count,
                    "sanPrefix": san_prefix,
                }));
            }
            if matched >= DEEP_SEARCH_CAP {
                break;
            }
        }
        last_id = batch.last().expect("non-empty batch").id;
        emit!(
            json!({ "type": "progress", "scanned": scanned, "total": total, "matched": matched })
        );
        if matched >= DEEP_SEARCH_CAP {
            break;
        }
    }
    emit!(json!({
        "type": "done",
        "scanned": scanned,
        "total": total,
        "matched": matched,
        "exhaustive": matched < DEEP_SEARCH_CAP,
    }));
    Ok(())
}
