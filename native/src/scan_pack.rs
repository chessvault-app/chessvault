//! Port of `shared/scanPack.ts`: the packed scan-index blob, one per
//! game. That file is the spec — layout, event byte, stopping rules —
//! and the goldens pin this port to its bytes: `encode_scan_pack` must
//! produce exactly what the JS encoder wrote for the same movetext,
//! because whichever side scans a database reads blobs the other may
//! have written.

use shakmaty::{san::SanPlus, Chess, Move, Position, Role};

use crate::zobrist::hash_position;

pub const SCAN_PACK_VERSION: u32 = 1;
pub const SCAN_PACK_META: &str = "scan_pack";

/// Role numbering of the event byte: none=0, pawn=1 … queen=5. Kings
/// are never captured and never promoted to.
fn role_code(role: Role) -> u8 {
    match role {
        Role::Pawn => 1,
        Role::Knight => 2,
        Role::Bishop => 3,
        Role::Rook => 4,
        Role::Queen => 5,
        Role::King => 0,
    }
}

/// Encode one game's movetext, full depth, the plies replay's stopping
/// rules (first unparseable or illegal SAN ends the stream).
pub fn encode_scan_pack(moves: &str) -> Vec<u8> {
    let mut pos = Chess::default();
    let mut keys: Vec<u32> = vec![hash_position(&pos) as u32];
    let mut events: Vec<u8> = Vec::new();
    for token in moves.split(' ') {
        let Ok(san) = token.parse::<SanPlus>() else {
            break;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            break;
        };
        // shakmaty's move variants carry exactly the spec's derivation:
        // Normal{capture} is the enemy piece on the destination,
        // EnPassant captures a pawn, Castle captures nothing.
        let mut event = m.capture().map_or(0, role_code);
        if let Move::Normal {
            promotion: Some(role),
            ..
        } = m
        {
            event |= role_code(role) << 3;
        }
        pos.play_unchecked(m);
        events.push(event);
        keys.push(hash_position(&pos) as u32);
    }
    let npos = keys.len();
    let mut pack = Vec::with_capacity(2 + 4 * npos + events.len());
    pack.extend_from_slice(&(npos as u16).to_le_bytes());
    for key in keys {
        pack.extend_from_slice(&key.to_le_bytes());
    }
    pack.extend_from_slice(&events);
    pack
}
