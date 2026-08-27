//! Port of `shared/scanPack.ts`: the packed scan-index blob, one per
//! game. That file is the spec — layout, event byte, stopping rules —
//! and the goldens pin this port to its bytes: `encode_scan_pack` must
//! produce exactly what the JS encoder wrote for the same movetext,
//! because whichever side scans a database reads blobs the other may
//! have written.

use shakmaty::{san::SanPlus, Board, Chess, Move, Position, Role};

use crate::zobrist::hash_position;

pub const SCAN_PACK_VERSION: u32 = 1;
pub const SCAN_PACK_META: &str = "scan_pack";

/// The pawn-files hash — the spec's own arithmetic (h = 5, then
/// h = (h * 33 + v) mod 256 over white files a…h then black a…h).
fn pawn_files_hash(board: &Board) -> u8 {
    let mut files = [0u32; 16];
    for sq in board.pawns() & board.white() {
        files[u32::from(sq.file()) as usize] += 1;
    }
    for sq in board.pawns() & board.black() {
        files[8 + u32::from(sq.file()) as usize] += 1;
    }
    let mut h: u32 = 5;
    for value in files {
        h = (h.wrapping_mul(33).wrapping_add(value)) & 0xff;
    }
    h as u8
}

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
/** Per-piece counts in p,n,b,r,q order per side, plus totals with the
    kings — the envelope's raw material. */
fn board_counts(board: &Board) -> ([u8; 5], [u8; 5], u8, u8) {
    let sets = [
        board.pawns(),
        board.knights(),
        board.bishops(),
        board.rooks(),
        board.queens(),
    ];
    let mut w = [0u8; 5];
    let mut b = [0u8; 5];
    let mut w_tot = 1u8;
    let mut b_tot = 1u8;
    for (at, set) in sets.iter().enumerate() {
        w[at] = (*set & board.white()).count() as u8;
        b[at] = (*set & board.black()).count() as u8;
        w_tot += w[at];
        b_tot += b[at];
    }
    (w, b, w_tot, b_tot)
}

pub fn encode_scan_pack(moves: &str) -> Vec<u8> {
    let mut pos = Chess::default();
    let mut keys: Vec<u32> = vec![hash_position(&pos) as u32];
    let mut pawns: Vec<u8> = vec![pawn_files_hash(pos.board())];
    let mut events: Vec<u8> = Vec::new();
    let mut min = [8u8, 2, 2, 2, 1, 8, 2, 2, 2, 1];
    let mut max = [8u8, 2, 2, 2, 1, 8, 2, 2, 2, 1];
    let mut min_w_tot = 16u8;
    let mut min_b_tot = 16u8;
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
        pawns.push(pawn_files_hash(pos.board()));
        let (w, b, w_tot, b_tot) = board_counts(pos.board());
        for at in 0..5 {
            min[at] = min[at].min(w[at]);
            max[at] = max[at].max(w[at]);
            min[5 + at] = min[5 + at].min(b[at]);
            max[5 + at] = max[5 + at].max(b[at]);
        }
        min_w_tot = min_w_tot.min(w_tot);
        min_b_tot = min_b_tot.min(b_tot);
    }
    let npos = keys.len();
    let mut pack = Vec::with_capacity(13 + 6 * npos);
    pack.extend_from_slice(&(npos as u16).to_le_bytes());
    pack.push(min_w_tot);
    pack.push(min_b_tot);
    for at in 0..10 {
        pack.push((min[at] << 4) | max[at]);
    }
    for key in keys {
        pack.extend_from_slice(&key.to_le_bytes());
    }
    pack.extend_from_slice(&pawns);
    pack.extend_from_slice(&events);
    pack
}
