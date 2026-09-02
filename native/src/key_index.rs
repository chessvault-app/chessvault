//! Port of the inverted key index (shared/keyIndex.ts — that file is
//! the spec). Derived from scan_pack whole: two passes to size and
//! fill, a numeric sort per bucket (u64 order IS the spec's entry
//! order), little-endian bytes out. Byte-identical to the JS builder
//! by construction, held there by the whole-file parity diff.

use rusqlite::{params, Connection};

pub const KEY_INDEX_VERSION: u32 = 1;
pub const KEY_INDEX_META: &str = "key_index";

const PACK_KEYS_AT: usize = 14;

pub fn build_key_index(
    conn: &Connection,
    log: &mut dyn FnMut(&str),
) -> Result<(), Box<dyn std::error::Error>> {
    conn.execute_batch("DROP TABLE IF EXISTS key_index;")?;
    conn.execute_batch(crate::sql::KEY_INDEX_TABLE)?;
    let mut counts = vec![0u32; 65536];
    let mut total: usize = 0;
    {
        let mut stmt = conn.prepare("SELECT pack FROM scan_pack")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let pack: Vec<u8> = row.get(0)?;
            let npos = pack[0] as usize | ((pack[1] as usize) << 8);
            for at in 0..npos {
                let o = PACK_KEYS_AT + 4 * at;
                counts[pack[o + 2] as usize | ((pack[o + 3] as usize) << 8)] += 1;
            }
            total += npos;
        }
    }
    let mut starts = vec![0usize; 65537];
    for bucket in 0..65536 {
        starts[bucket + 1] = starts[bucket] + counts[bucket] as usize;
    }
    let mut entries = vec![0u64; total];
    let mut cursor = starts[..65536].to_vec();
    {
        let mut stmt = conn.prepare("SELECT game_id, pack FROM scan_pack")?;
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            let game_id: i64 = row.get(0)?;
            let pack: Vec<u8> = row.get(1)?;
            let npos = pack[0] as usize | ((pack[1] as usize) << 8);
            for at in 0..npos {
                let o = PACK_KEYS_AT + 4 * at;
                let key32 = u32::from_le_bytes([pack[o], pack[o + 1], pack[o + 2], pack[o + 3]]);
                let bucket = (key32 >> 16) as usize;
                entries[cursor[bucket]] = ((key32 as u64 & 0xffff) << 48)
                    | ((game_id as u64) << 16)
                    | (at as u64).min(65535);
                cursor[bucket] += 1;
            }
        }
    }
    conn.execute_batch("BEGIN")?;
    {
        let mut insert = conn.prepare("INSERT INTO key_index (bucket, entries) VALUES (?, ?)")?;
        for bucket in 0..65536usize {
            let count = counts[bucket] as usize;
            if count == 0 {
                continue;
            }
            let slice = &mut entries[starts[bucket]..starts[bucket] + count];
            slice.sort_unstable();
            let mut blob = Vec::with_capacity(count * 8);
            for entry in slice.iter() {
                blob.extend_from_slice(&entry.to_le_bytes());
            }
            insert.execute(params![bucket as i64, blob])?;
        }
    }
    conn.execute_batch("COMMIT")?;
    log(&format!(
        "  positions: {} keys inverted",
        crate::util::commas(total as u64)
    ));
    Ok(())
}
