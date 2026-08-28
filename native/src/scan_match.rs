//! Port of `shared/scanMatch.ts`: the deep scan's relaxation ladder
//! signatures and the material-search predicate. The signature strings
//! are compared byte-for-byte against fixtures exported from the JS
//! side (`tests/goldens.json`), and the spec struct parses exactly the
//! CANONICAL serialisation the server sends — the server validated the
//! request already, so an unparseable spec here is a bug, not input.

use std::collections::BTreeMap;

use serde::Deserialize;
use shakmaty::{Bitboard, Board};

/// The scan-mode request keys this build understands — the `scan` field
/// of the `capabilities` declaration, beside `SUPPORTED_FILTERS`. The
/// server routes a request using an undeclared key down its JS path.
/// `match:structure` is a VALUE token: the structure rung changed what
/// `match` can carry, and a binary without the token would refuse the
/// value rather than answer wrongly — declaring it is what lets the
/// server forward structure hunts here at all.
pub const SUPPORTED_SCAN: &[&str] = &["match", "material", "match:structure"];

/// Piece letters in the fixed order every signature and spec uses.
const LETTERS: [&str; 5] = ["p", "n", "b", "r", "q"];

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Rung {
    Pawns,
    Files,
    Material,
    /// Every pawn on its exact square and nothing else — pieces free,
    /// side to move free (see shared/scanMatch.ts's header).
    Structure,
}

impl Rung {
    pub fn parse(raw: &str) -> Option<Rung> {
        match raw {
            "pawns" => Some(Rung::Pawns),
            "files" => Some(Rung::Files),
            "material" => Some(Rung::Material),
            "structure" => Some(Rung::Structure),
            _ => None,
        }
    }
}

/// Per-side piece counts in LETTERS order (kings implicit — always 1).
fn counts(board: &Board) -> ([i64; 5], [i64; 5]) {
    let sets = [
        board.pawns(),
        board.knights(),
        board.bishops(),
        board.rooks(),
        board.queens(),
    ];
    let mut w = [0i64; 5];
    let mut b = [0i64; 5];
    for (at, set) in sets.iter().enumerate() {
        w[at] = (*set & board.white()).count() as i64;
        b[at] = (*set & board.black()).count() as i64;
    }
    (w, b)
}

fn joined(values: &[i64]) -> String {
    values
        .iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join(",")
}

/// The position's signature under a relaxed rung — identical bytes to
/// `matchSignature` in shared/scanMatch.ts.
pub fn match_signature(board: &Board, rung: Rung) -> String {
    if rung == Rung::Structure {
        let squares = |set: Bitboard| {
            set.into_iter()
                .map(|sq| (sq as u32).to_string())
                .collect::<Vec<_>>()
                .join(".")
        };
        let wp = squares(board.pawns() & board.white());
        let bp = squares(board.pawns() & board.black());
        return format!("s:{wp}/{bp}");
    }
    let (w, b) = counts(board);
    let material = format!("{}-{}", joined(&w), joined(&b));
    match rung {
        Rung::Structure => unreachable!(),
        Rung::Material => format!("m:{material}"),
        Rung::Pawns => {
            let squares = |set: Bitboard| {
                set.into_iter()
                    .map(|sq| (sq as u32).to_string())
                    .collect::<Vec<_>>()
                    .join(".")
            };
            let wp = squares(board.pawns() & board.white());
            let bp = squares(board.pawns() & board.black());
            format!("p:{material}:{wp}/{bp}")
        }
        Rung::Files => {
            let per_file = |set: Bitboard| {
                let mut files = [0u32; 8];
                for sq in set {
                    files[u32::from(sq.file()) as usize] += 1;
                }
                files.iter().map(u32::to_string).collect::<String>()
            };
            let wf = per_file(board.pawns() & board.white());
            let bf = per_file(board.pawns() & board.black());
            format!("f:{material}:{wf}/{bf}")
        }
    }
}

/// The canonical material spec, exactly as `canonicalMaterial` writes
/// it: every field present, ranges as two-element arrays.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MaterialSpec {
    pub white: BTreeMap<String, (i64, i64)>,
    pub black: BTreeMap<String, (i64, i64)>,
    pub diff: BTreeMap<String, (i64, i64)>,
    pub stable: u32,
}

/// Does this position's material satisfy the spec (stability aside)?
pub fn material_satisfied(board: &Board, spec: &MaterialSpec) -> bool {
    let (w, b) = counts(board);
    let ok = |value: i64, range: Option<&(i64, i64)>| {
        range.is_none_or(|(lo, hi)| value >= *lo && value <= *hi)
    };
    for (at, letter) in LETTERS.iter().enumerate() {
        if !ok(w[at], spec.white.get(*letter)) {
            return false;
        }
        if !ok(b[at], spec.black.get(*letter)) {
            return false;
        }
        if !ok(w[at] - b[at], spec.diff.get(*letter)) {
            return false;
        }
    }
    ok(w[1] + w[2] - b[1] - b[2], spec.diff.get("minor"))
        && ok(w[3] + w[4] - b[3] - b[4], spec.diff.get("major"))
}

/// Total-men bounds per side implied by the spec, king included — the
/// mirror of `materialMenBounds`. Returned as (loW, hiW, loB, hiB).
pub fn material_men_bounds(spec: &MaterialSpec) -> (i64, i64, i64, i64) {
    let ceiling = |letter: &str| match letter {
        "p" => 8,
        "n" | "b" | "r" => 10,
        "q" => 9,
        _ => unreachable!(),
    };
    let bounds = |from: &BTreeMap<String, (i64, i64)>| {
        let mut lo = 1i64;
        let mut hi = 1i64;
        for letter in LETTERS {
            match from.get(letter) {
                Some((min, max)) => {
                    lo += min;
                    hi += max;
                }
                None => hi += ceiling(letter),
            }
        }
        (lo, hi.min(16))
    };
    let (lo_w, hi_w) = bounds(&spec.white);
    let (lo_b, hi_b) = bounds(&spec.black);
    (lo_w, hi_w, lo_b, hi_b)
}
