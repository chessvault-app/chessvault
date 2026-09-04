//! Port of `shared/scanMotif.ts`: the canned motifs' spec and the
//! isolated-queen's-pawn predicate. The spec struct parses exactly the
//! CANONICAL serialisation the server sends (`canonicalMotif`) — the
//! server validated the request already, so an unparseable spec here is
//! a bug, not input — and the predicate is compared against fixtures
//! exported from the JS side (`tests/goldens.json`). Opposite castling
//! is replay state, not a board fact, so it lives with the replay in
//! `deep.rs` (`find_motif_hit`), exactly as the JS side keeps it in
//! `server/refgamesScan.ts`.

use serde::Deserialize;
use shakmaty::{Bitboard, Board, File};

#[derive(Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum MotifId {
    #[serde(rename = "iqp")]
    Iqp,
    #[serde(rename = "opposite-castling")]
    OppositeCastling,
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

/// Does this position hold an isolated queen's pawn for the side
/// (stability aside)? The definition is shared/scanMotif.ts's header:
/// exactly one pawn on the d-file, none on c or e, and the opponent
/// has no d-pawn.
pub fn iqp_satisfied(board: &Board, side: MotifSide) -> bool {
    let c_file = Bitboard::from_file(File::C);
    let d_file = Bitboard::from_file(File::D);
    let e_file = Bitboard::from_file(File::E);
    let holds = |own: Bitboard, theirs: Bitboard| {
        (own & d_file).count() == 1
            && (own & c_file).is_empty()
            && (own & e_file).is_empty()
            && (theirs & d_file).is_empty()
    };
    let white = board.pawns() & board.white();
    let black = board.pawns() & board.black();
    match side {
        MotifSide::White => holds(white, black),
        MotifSide::Black => holds(black, white),
        MotifSide::Either => holds(white, black) || holds(black, white),
    }
}
