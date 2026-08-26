//! The index contract of `server/refgamesIndex.ts`: the small per-game
//! codes carried on every plies row, and the replay loop that produces
//! those rows. Pinned by `native/tests/goldens.json` — behaviour here is
//! frozen to whatever the JS pipeline does, including its quirks (a
//! bogus SAN token containing 'x' still decrements `final_men`; a game
//! whose SAN stops parsing keeps the plies that did replay).

use shakmaty::{san::SanPlus, CastlingMode, Chess, Position};

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
