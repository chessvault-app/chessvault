//! Port of `scripts/optimize-refgames.ts`: housekeeping for one
//! database, in place — exact-duplicate sweep, derived tables re-derived
//! when anything was removed, a stale index healed, VACUUM at the end.

use std::path::Path;
use std::time::Instant;

use rusqlite::{Connection, OptionalExtension};

use crate::index::index_positions;
use crate::sql;
use crate::util::commas;

pub fn run_optimize(db_path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "busy_timeout", 30_000)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;

    println!("sweeping duplicates…");
    // Keep the lowest id of each identical game.
    let swept = conn.execute(
        "DELETE FROM games WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY white, black, result, date, moves ORDER BY id
             ) AS rn FROM games
           ) WHERE rn > 1
         )",
        [],
    )?;
    println!("  {} duplicate games removed", commas(swept as u64));

    if swept > 0 {
        // Every derived table summarised games that are gone.
        conn.execute_batch("DROP TABLE IF EXISTS players; DROP TABLE IF EXISTS openings; DROP TABLE IF EXISTS events;")?;
        conn.execute_batch(sql::REFGAMES_LOOKUPS)?;
        let count: i64 = conn.query_row("SELECT COUNT(*) AS n FROM games", [], |r| r.get(0))?;
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            rusqlite::params!["games", count.to_string()],
        )?;
    }
    let had_index = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plies'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    // An interrupted append leaves games above the index's high-water
    // id; this pass also heals that — incrementally when nothing was
    // swept, whole when the sweep changed what the index should hold.
    let through: i64 = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'indexed_through'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let max_id: i64 = conn
        .query_row("SELECT MAX(id) AS n FROM games", [], |r| {
            r.get::<_, Option<i64>>(0)
        })?
        .unwrap_or(0);
    let stale = through > 0 && max_id > through;
    drop(conn);

    if had_index && (swept > 0 || stale) {
        println!("position index…");
        index_positions(db_path, swept == 0, &mut |line| println!("{line}"))?;
    }

    println!("vacuum…");
    let compact = Connection::open(db_path)?;
    // Fold back to a single plain file (see the TS twin): a sweep that
    // removed nothing would otherwise leave the database in WAL.
    compact.pragma_update(None, "journal_mode", "DELETE")?;
    compact.execute_batch("VACUUM")?;
    drop(compact);
    println!("done in {:.1}s", started.elapsed().as_secs_f64());
    Ok(())
}
