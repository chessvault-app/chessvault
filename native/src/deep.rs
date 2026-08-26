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
use crate::zobrist::{hash_position, to_db_key};

pub const DEEP_SEARCH_CAP: u64 = 200;

/// The ply at which the game reaches the target, or None. The exact
/// gates of the JS loop: turn parity and men counts before the hash,
/// SAN's own capture mark for the men (a board check would miss en
/// passant), early exit once a side dips below the target, and the
/// final position checked too.
fn find_hit(
    moves: &str,
    target_key: i64,
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
            && to_db_key(hash_position(pos)) == target_key
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

pub fn run_deep_search(
    db_path: &Path,
    fen: &str,
    filters: &dyn Fn(&str) -> Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let parsed: Fen = fen.trim().parse().map_err(|_| "bad fen")?;
    let target: Chess = parsed
        .into_position(CastlingMode::Chess960)
        .map_err(|_| "bad position")?;
    let target_key = to_db_key(hash_position(&target));
    let target_w = i64::from(target.board().white().count() as u32);
    let target_b = i64::from(target.board().black().count() as u32);
    let missing = 32 - target_w - target_b;
    let want_black_to_move = target.turn() == Color::Black;

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
            Value::Integer(target_w),
            Value::Integer(target_b),
            Value::Integer(missing),
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
        "SELECT id, white, black, white_elo, black_elo, result, date, eco, opening, moves
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
        eco: Option<String>,
        opening: Option<String>,
        moves: String,
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
                    eco: r.get(7)?,
                    opening: r.get(8)?,
                    moves: r.get(9)?,
                })
            })?;
            rows.collect::<Result<_, _>>()?
        };
        if batch.is_empty() {
            break;
        }
        for row in &batch {
            scanned += 1;
            if let Some(hit_ply) = find_hit(
                &row.moves,
                target_key,
                target_w,
                target_b,
                want_black_to_move,
            ) {
                matched += 1;
                let elo = |v: f64| {
                    if v.fract() == 0.0 {
                        json!(v as i64)
                    } else {
                        json!(v)
                    }
                };
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
                    "eco": row.eco,
                    "opening": row.opening,
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
