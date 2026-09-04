//! Port of `shared/scanMotif.ts`: the canned motifs' spec and the board
//! predicates. The spec struct parses exactly the CANONICAL
//! serialisation the server sends (`canonicalMotif`) — the server
//! validated the request already, so an unparseable spec here is a bug,
//! not input — and every predicate is compared against fixtures
//! exported from the JS side (`tests/goldens.json`). The castling and
//! move kinds are replay state, not board facts, so they live with the
//! replay in `deep.rs` (`find_motif_hit`), exactly as the JS side keeps
//! them in `server/refgamesScan.ts`. The definitions are the JS
//! header's; the predicates work on square numbers (a1 = 0 … h8 = 63)
//! as that side does, so nothing here re-derives a library helper.

use serde::Deserialize;
use shakmaty::{Bitboard, Board, Color, Square};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum MotifId {
    #[serde(rename = "iqp")]
    Iqp,
    #[serde(rename = "doubled-pawns")]
    DoubledPawns,
    #[serde(rename = "passed-pawn")]
    PassedPawn,
    #[serde(rename = "rook-on-seventh")]
    RookOnSeventh,
    #[serde(rename = "fianchetto")]
    Fianchetto,
    #[serde(rename = "knight-outpost")]
    KnightOutpost,
    #[serde(rename = "opposite-bishops")]
    OppositeBishops,
    #[serde(rename = "opposite-castling")]
    OppositeCastling,
    #[serde(rename = "same-side-castling")]
    SameSideCastling,
    #[serde(rename = "greek-gift")]
    GreekGift,
    #[serde(rename = "underpromotion")]
    Underpromotion,
    #[serde(rename = "en-passant")]
    EnPassant,
}

/// What the replay must watch for a motif (`MOTIF_KIND` on the JS side).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MotifKind {
    Board,
    Castling,
    Move,
}

impl MotifId {
    pub fn kind(self) -> MotifKind {
        match self {
            MotifId::Iqp
            | MotifId::DoubledPawns
            | MotifId::PassedPawn
            | MotifId::RookOnSeventh
            | MotifId::Fianchetto
            | MotifId::KnightOutpost
            | MotifId::OppositeBishops => MotifKind::Board,
            MotifId::OppositeCastling | MotifId::SameSideCastling => MotifKind::Castling,
            MotifId::GreekGift | MotifId::Underpromotion | MotifId::EnPassant => MotifKind::Move,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MotifSide {
    White,
    Black,
    Either,
}

/// The canonical motif spec, exactly as `canonicalMotif` writes it:
/// every field present, in this order.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MotifSpec {
    pub id: MotifId,
    pub side: MotifSide,
    pub stable: u32,
}

fn file_of(square: Square) -> i32 {
    i32::from(u32::from(square.file()) as u8)
}

fn rank_of(square: Square) -> i32 {
    i32::from(u32::from(square.rank()) as u8)
}

fn has(set: Bitboard, square: i32) -> bool {
    Square::try_from(square as u32).is_ok_and(|sq| set.contains(sq))
}

/// Does the colour hold the board motif in this position (stability
/// aside)? `OppositeBishops` is symmetric and answers the same for
/// either colour.
fn board_holds(board: &Board, id: MotifId, color: Color) -> bool {
    let white = color == Color::White;
    let own = if white { board.white() } else { board.black() };
    let theirs = if white { board.black() } else { board.white() };
    let own_pawns = board.pawns() & own;
    let their_pawns = board.pawns() & theirs;
    // "Ahead" from this side's point of view.
    let ahead = |rank: i32, from: i32| if white { rank > from } else { rank < from };
    let enemy_pawn_ahead = |files: &[i32], from: i32| {
        their_pawns
            .into_iter()
            .any(|sq| files.contains(&file_of(sq)) && ahead(rank_of(sq), from))
    };
    match id {
        MotifId::Iqp => {
            let mut d = 0;
            let mut ce = 0;
            for sq in own_pawns {
                let file = file_of(sq);
                if file == 3 {
                    d += 1;
                } else if file == 2 || file == 4 {
                    ce += 1;
                }
            }
            if d != 1 || ce != 0 {
                return false;
            }
            !their_pawns.into_iter().any(|sq| file_of(sq) == 3)
        }
        MotifId::DoubledPawns => {
            let mut files = [0u32; 8];
            for sq in own_pawns {
                let file = file_of(sq) as usize;
                files[file] += 1;
                if files[file] >= 2 {
                    return true;
                }
            }
            false
        }
        MotifId::PassedPawn => own_pawns.into_iter().any(|sq| {
            let file = file_of(sq);
            !enemy_pawn_ahead(&[file - 1, file, file + 1], rank_of(sq))
        }),
        MotifId::RookOnSeventh => {
            let seventh = if white { 6 } else { 1 };
            (board.rooks() & own).into_iter().any(|sq| rank_of(sq) == seventh)
        }
        MotifId::Fianchetto => {
            let bishops = board.bishops() & own;
            // g2+g3 / b2+b3, or g7+g6 / b7+b6.
            if white {
                (has(bishops, 14) && has(own_pawns, 22)) || (has(bishops, 9) && has(own_pawns, 17))
            } else {
                (has(bishops, 54) && has(own_pawns, 46)) || (has(bishops, 49) && has(own_pawns, 41))
            }
        }
        MotifId::KnightOutpost => (board.knights() & own).into_iter().any(|sq| {
            let file = file_of(sq);
            let rank = rank_of(sq);
            // The fifth or sixth rank from this side.
            let far_enough = if white { rank == 4 || rank == 5 } else { rank == 3 || rank == 2 };
            if !far_enough {
                return false;
            }
            // Supported by a pawn diagonally behind it.
            let behind = if white { rank - 1 } else { rank + 1 };
            let supported = (file > 0 && has(own_pawns, behind * 8 + file - 1))
                || (file < 7 && has(own_pawns, behind * 8 + file + 1));
            // No enemy pawn on an adjacent file could ever attack it.
            supported && !enemy_pawn_ahead(&[file - 1, file + 1], rank)
        }),
        MotifId::OppositeBishops => {
            if board.knights().any() || board.rooks().any() || board.queens().any() {
                return false;
            }
            let wb = board.bishops() & board.white();
            let bb = board.bishops() & board.black();
            if wb.count() != 1 || bb.count() != 1 {
                return false;
            }
            let dark = |sq: Square| (file_of(sq) + rank_of(sq)) & 1;
            dark(wb.first().expect("one bishop")) != dark(bb.first().expect("one bishop"))
        }
        MotifId::OppositeCastling
        | MotifId::SameSideCastling
        | MotifId::GreekGift
        | MotifId::Underpromotion
        | MotifId::EnPassant => false,
    }
}

/// Does this position hold the board motif for the side asked, or for
/// either side? For the castling and move kinds, which the board cannot
/// show, always false — the replay answers those.
pub fn board_motif_satisfied(board: &Board, id: MotifId, side: MotifSide) -> bool {
    if id.kind() != MotifKind::Board {
        return false;
    }
    match side {
        MotifSide::White => board_holds(board, id, Color::White),
        MotifSide::Black => board_holds(board, id, Color::Black),
        MotifSide::Either => {
            board_holds(board, id, Color::White) || board_holds(board, id, Color::Black)
        }
    }
}

/// The IQP alone, the first motif and the one the golden test names.
pub fn iqp_satisfied(board: &Board, side: MotifSide) -> bool {
    board_motif_satisfied(board, MotifId::Iqp, side)
}
