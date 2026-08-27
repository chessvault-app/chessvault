//! Golden parity against the JS pipeline. The fixture is the JS side's
//! own output (`scripts/export-native-goldens.ts`); every assertion here
//! is "the Rust port answers byte-for-byte what the JS implementation
//! answered". A failure is a silent-wrong-answers bug, never a nit.

use serde::Deserialize;
use shakmaty::{fen::Fen, CastlingMode, Chess, Position};

use chessvault_core::index::{elo_bucket, final_men, replay_plies, result_code};
use chessvault_core::scan_match::{
    material_men_bounds, material_satisfied, match_signature, MaterialSpec, Rung,
};
use chessvault_core::zobrist::{hash_position, to_db_key};

#[derive(Deserialize)]
struct Goldens {
    schema: u32,
    #[serde(rename = "refMaxPly")]
    ref_max_ply: u32,
    fens: Vec<FenGolden>,
    results: Vec<ResultGolden>,
    elos: Vec<EloGolden>,
    #[serde(rename = "finalMen")]
    final_men: Vec<MenGolden>,
    games: Vec<GameGolden>,
    signatures: Vec<SignatureGolden>,
    #[serde(rename = "materialSpecs")]
    material_specs: Vec<MaterialSpecGolden>,
}

#[derive(Deserialize)]
struct SignatureGolden {
    fen: String,
    why: String,
    pawns: String,
    files: String,
    material: String,
}

#[derive(Deserialize)]
struct MaterialSpecGolden {
    why: String,
    canonical: String,
    bounds: BoundsGolden,
    cases: Vec<MaterialCaseGolden>,
}

#[derive(Deserialize)]
struct BoundsGolden {
    #[serde(rename = "loW")]
    lo_w: i64,
    #[serde(rename = "hiW")]
    hi_w: i64,
    #[serde(rename = "loB")]
    lo_b: i64,
    #[serde(rename = "hiB")]
    hi_b: i64,
}

#[derive(Deserialize)]
struct MaterialCaseGolden {
    fen: String,
    satisfied: bool,
}

#[derive(Deserialize)]
struct FenGolden {
    fen: String,
    why: String,
    key: String,
    db: String,
}

#[derive(Deserialize)]
struct ResultGolden {
    result: String,
    r: i64,
}

#[derive(Deserialize)]
struct EloGolden {
    #[serde(rename = "whiteElo")]
    white_elo: i64,
    #[serde(rename = "blackElo")]
    black_elo: i64,
    eb: i64,
}

#[derive(Deserialize)]
struct MenGolden {
    moves: String,
    w: i64,
    b: i64,
}

#[derive(Deserialize)]
struct GameGolden {
    why: String,
    moves: String,
    result: String,
    #[serde(rename = "whiteElo")]
    white_elo: i64,
    #[serde(rename = "blackElo")]
    black_elo: i64,
    r: i64,
    eb: i64,
    #[serde(rename = "plyCount")]
    ply_count: usize,
    #[serde(rename = "finalWmen")]
    final_wmen: i64,
    #[serde(rename = "finalBmen")]
    final_bmen: i64,
    plies: Vec<PlyGolden>,
}

#[derive(Deserialize)]
struct PlyGolden {
    ply: u32,
    pos: String,
    uci: String,
}

fn load() -> Goldens {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/goldens.json");
    let text = std::fs::read_to_string(path)
        .expect("goldens.json exists — run scripts/export-native-goldens.ts");
    let goldens: Goldens = serde_json::from_str(&text).expect("goldens.json parses");
    assert_eq!(goldens.schema, 1, "unknown goldens schema");
    goldens
}

#[test]
fn fen_keys_match() {
    let goldens = load();
    for golden in &goldens.fens {
        let fen: Fen = golden
            .fen
            .parse()
            .unwrap_or_else(|e| panic!("{}: {e}", golden.fen));
        let pos: Chess = fen
            .into_position(CastlingMode::Chess960)
            .unwrap_or_else(|e| panic!("{}: {e}", golden.fen));
        let hash = hash_position(&pos);
        assert_eq!(
            format!("{hash:x}"),
            golden.key,
            "key of {} ({})",
            golden.fen,
            golden.why
        );
        assert_eq!(
            to_db_key(hash).to_string(),
            golden.db,
            "db key of {} ({})",
            golden.fen,
            golden.why
        );
    }
}

#[test]
fn result_codes_match() {
    for golden in &load().results {
        assert_eq!(
            result_code(&golden.result),
            golden.r,
            "result {:?}",
            golden.result
        );
    }
}

#[test]
fn elo_buckets_match() {
    for golden in &load().elos {
        assert_eq!(
            elo_bucket(golden.white_elo, golden.black_elo),
            golden.eb,
            "elos {} / {}",
            golden.white_elo,
            golden.black_elo
        );
    }
}

#[test]
fn final_men_matches() {
    for golden in &load().final_men {
        assert_eq!(
            final_men(&golden.moves),
            (golden.w, golden.b),
            "finalMen of {:?}",
            golden.moves
        );
    }
}

#[test]
fn ladder_signatures_match() {
    for golden in &load().signatures {
        let fen: Fen = golden.fen.parse().expect("golden fen parses");
        let pos: Chess = fen
            .into_position(CastlingMode::Chess960)
            .expect("golden fen is a position");
        for (rung, wanted) in [
            (Rung::Pawns, &golden.pawns),
            (Rung::Files, &golden.files),
            (Rung::Material, &golden.material),
        ] {
            assert_eq!(
                &match_signature(pos.board(), rung),
                wanted,
                "signature of {} ({})",
                golden.fen,
                golden.why
            );
        }
    }
}

#[test]
fn material_specs_match() {
    // The canonical string is the exact argv the server sends: parsing
    // it, the bounds and every per-position verdict must agree with the
    // JS side that wrote the fixture.
    for golden in &load().material_specs {
        let spec: MaterialSpec = serde_json::from_str(&golden.canonical)
            .unwrap_or_else(|e| panic!("{} did not parse: {e}", golden.why));
        assert_eq!(
            material_men_bounds(&spec),
            (
                golden.bounds.lo_w,
                golden.bounds.hi_w,
                golden.bounds.lo_b,
                golden.bounds.hi_b
            ),
            "bounds of {}",
            golden.why
        );
        for case in &golden.cases {
            let fen: Fen = case.fen.parse().expect("golden fen parses");
            let pos: Chess = fen
                .into_position(CastlingMode::Chess960)
                .expect("golden fen is a position");
            assert_eq!(
                material_satisfied(pos.board(), &spec),
                case.satisfied,
                "{} on {}",
                golden.why,
                case.fen
            );
        }
    }
}

#[test]
fn game_replays_match() {
    let goldens = load();
    assert_eq!(goldens.ref_max_ply, chessvault_core::index::REF_MAX_PLY);
    for game in &goldens.games {
        assert_eq!(result_code(&game.result), game.r, "{}", game.why);
        assert_eq!(
            elo_bucket(game.white_elo, game.black_elo),
            game.eb,
            "{}",
            game.why
        );
        assert_eq!(
            game.moves.split(' ').count(),
            game.ply_count,
            "{}",
            game.why
        );
        assert_eq!(
            final_men(&game.moves),
            (game.final_wmen, game.final_bmen),
            "{}",
            game.why
        );

        let rows = replay_plies(&game.moves, goldens.ref_max_ply);
        assert_eq!(rows.len(), game.plies.len(), "ply count of: {}", game.why);
        for (row, golden) in rows.iter().zip(&game.plies) {
            assert_eq!(row.ply, golden.ply, "{}", game.why);
            assert_eq!(
                row.pos.to_string(),
                golden.pos,
                "{} ply {}",
                game.why,
                golden.ply
            );
            assert_eq!(row.uci, golden.uci, "{} ply {}", game.why, golden.ply);
        }
    }
}
