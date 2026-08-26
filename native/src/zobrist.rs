//! Port of `shared/zobrist.ts` — the app's own splitmix64-seeded 64-bit
//! Zobrist scheme, deliberately NOT Polyglot (the TS header says why).
//! Keys written by either side must be readable by the other forever, so
//! this file changes only together with its TS twin, and both are pinned
//! by `native/tests/goldens.json`.
//!
//! The TS side hashes a chessops `Setup` that went through X-FEN
//! normalisation: the en-passant square is kept only when a legal ep
//! capture exists. `Position::ep_square(EnPassantMode::Legal)` is
//! shakmaty's spelling of the same rule, so hashing a legal `Position`
//! here equals hashing `pos.toSetup()` there.

use shakmaty::{Color, EnPassantMode, Position};

const fn splitmix_next(state: u64) -> (u64, u64) {
    let state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    (state, z ^ (z >> 31))
}

struct Tables {
    /// piece keys: [color(2) × role(6) × square(64)], white first,
    /// roles in chessops order (pawn, knight, bishop, rook, queen, king).
    piece: [u64; 768],
    /// castling rights keyed by rook square.
    castling: [u64; 64],
    /// en passant keyed by file, hashed only when the capture is legal.
    ep_file: [u64; 8],
    black_to_move: u64,
}

const TABLES: Tables = {
    let mut t = Tables {
        piece: [0; 768],
        castling: [0; 64],
        ep_file: [0; 8],
        black_to_move: 0,
    };
    let mut state: u64 = 0x6368_6573_735f_7661; // 'chess_va'
    let mut i = 0;
    while i < 768 {
        let (s, v) = splitmix_next(state);
        state = s;
        t.piece[i] = v;
        i += 1;
    }
    let mut i = 0;
    while i < 64 {
        let (s, v) = splitmix_next(state);
        state = s;
        t.castling[i] = v;
        i += 1;
    }
    let mut i = 0;
    while i < 8 {
        let (s, v) = splitmix_next(state);
        state = s;
        t.ep_file[i] = v;
        i += 1;
    }
    let (_, v) = splitmix_next(state);
    t.black_to_move = v;
    t
};

/// Zobrist key of a legal position — equal to the TS side's
/// `hashSetup(pos.toSetup())` on the same position.
pub fn hash_position<P: Position>(pos: &P) -> u64 {
    let mut h = 0u64;
    for (square, piece) in pos.board().iter() {
        let color_offset = if piece.color == Color::White { 0 } else { 384 };
        // shakmaty roles are 1-based (Pawn = 1 … King = 6); the TS
        // ROLE_INDEX is 0-based in the same order.
        let role = piece.role as usize - 1;
        h ^= TABLES.piece[color_offset + role * 64 + square as usize];
    }
    for rook in pos.castles().castling_rights() {
        h ^= TABLES.castling[rook as usize];
    }
    if let Some(ep) = pos.ep_square(EnPassantMode::Legal) {
        h ^= TABLES.ep_file[u32::from(ep.file()) as usize];
    }
    if pos.turn() == Color::Black {
        h ^= TABLES.black_to_move;
    }
    h
}

/// The hash as SQLite stores it: signed 64-bit (`toDbKey` in TS).
pub fn to_db_key(hash: u64) -> i64 {
    hash as i64
}
