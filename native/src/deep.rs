//! Port of the `/refgames/deep-search` route's scan loop
//! (`server/refgames.ts`): search the whole database for a position, any
//! depth. Spawned per request by the server, which reads the ndjson on
//! stdout — `hit` frames (game id and ply), `progress` and `done` — and
//! composes the game frames the client sees itself, after replaying
//! each hit through its own reference scanner. So this binary answers
//! WHICH games, never what a frame looks like: the frame's shape exists
//! once, on the JS side, and a wrong hit here is overruled and logged
//! rather than streamed. The `capabilities` command declares this as
//! `"deep": "hits"`; the server spawns nothing that does not. A closed
//! pipe (client gone, child killed) ends the scan by construction.

use std::io::Write;
use std::path::Path;

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension};
use serde_json::json;
use shakmaty::{
    fen::Fen, san::SanPlus, CastlingMode, CastlingSide, Chess, Color, FromSetup, Position, Role,
    Square,
};

use crate::filters::games_where;
use crate::scan_match::{
    material_men_bounds, material_satisfied, match_signature, MaterialSpec, Rung,
};
use crate::scan_motif::{board_motif_satisfied, MotifId, MotifKind, MotifSide, MotifSpec};
use crate::zobrist::{hash_position, to_db_key};

pub const DEEP_SEARCH_CAP: u64 = 200;

/// What one position must equal for the game to count: the exact rung
/// compares the Zobrist key, a relaxed rung its signature (see
/// scan_match). Both sit behind the same cheap gates.
enum Target {
    Exact(i64),
    Relaxed(Rung, String),
}

/// The ply at which the game reaches the target position, or None. The
/// exact gates of the JS loop (`findPositionHit`): turn parity and men
/// counts before the expensive test, SAN's own capture mark for the men
/// (a board check would miss en passant), early exit once a side dips
/// below the target, and the final position checked too.
fn find_position_hit(
    moves: &str,
    target: &Target,
    target_w: i64,
    target_b: i64,
    want_black_to_move: bool,
) -> Option<u32> {
    let mut pos = Chess::default();
    let mut w = 16i64;
    let mut b = 16i64;
    let mut ply: u32 = 0;
    let at_target = |pos: &Chess, w: i64, b: i64, ply: u32| {
        ((ply % 2 == 1) == want_black_to_move)
            && w == target_w
            && b == target_b
            && match target {
                Target::Exact(key) => to_db_key(hash_position(pos)) == *key,
                Target::Relaxed(rung, sig) => match_signature(pos.board(), *rung) == *sig,
            }
    };
    for token in moves.split(' ') {
        if at_target(&pos, w, b, ply) {
            return Some(ply);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            break;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            break;
        };
        if token.contains('x') {
            if ply % 2 == 0 {
                b -= 1;
            } else {
                w -= 1;
            }
            if w < target_w || b < target_b {
                break;
            }
        }
        pos.play_unchecked(m);
        ply += 1;
    }
    if at_target(&pos, w, b, ply) {
        return Some(ply);
    }
    None
}

/// The structure rung's own loop, the exact shape of the JS
/// `replayStructureHit`: no parity gate (a structure is a fact about a
/// phase, not a turn), no men gates (the pieces are free); the cheap
/// gate is the PAWN counts, read from the board itself so en-passant
/// captures and promotions are counted exactly. Pawns only ever leave
/// (a promotion is a leaving too), so below the target's counts the
/// game is done.
fn find_structure_hit(moves: &str, sig: &str, target_wp: i64, target_bp: i64) -> Option<u32> {
    let mut pos = Chess::default();
    let mut ply: u32 = 0;
    let pawn_counts = |pos: &Chess| {
        (
            (pos.board().pawns() & pos.board().white()).count() as i64,
            (pos.board().pawns() & pos.board().black()).count() as i64,
        )
    };
    let at_target = |pos: &Chess| {
        let (wp, bp) = pawn_counts(pos);
        wp == target_wp && bp == target_bp && match_signature(pos.board(), Rung::Structure) == *sig
    };
    for token in moves.split(' ') {
        if at_target(&pos) {
            return Some(ply);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            break;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            break;
        };
        pos.play_unchecked(m);
        ply += 1;
        let (wp, bp) = pawn_counts(&pos);
        if wp < target_wp || bp < target_bp {
            return None;
        }
    }
    if at_target(&pos) {
        return Some(ply);
    }
    None
}

/// The FIRST ply of the earliest streak satisfying the material spec
/// for its stability length, or None — the exact shape of the JS
/// `findMaterialHit`: no parity gate, the spec's own floor as the early
/// exit, and breaks return None directly rather than falling through
/// to a final test, because the streak is stateful and re-testing a
/// counted position would count it twice.
fn find_material_hit(moves: &str, spec: &MaterialSpec, lo_w: i64, lo_b: i64) -> Option<u32> {
    let mut pos = Chess::default();
    let mut w = 16i64;
    let mut b = 16i64;
    let mut ply: u32 = 0;
    let mut streak: u32 = 0;
    let step = |pos: &Chess, ply: u32, streak: &mut u32| -> Option<u32> {
        if material_satisfied(pos.board(), spec) {
            *streak += 1;
            if *streak >= spec.stable {
                // ply + 1 first: u32, and ply - stable alone underflows
                // on the very first ply of a stable-1 spec.
                return Some(ply + 1 - spec.stable);
            }
        } else {
            *streak = 0;
        }
        None
    };
    for token in moves.split(' ') {
        if let Some(hit) = step(&pos, ply, &mut streak) {
            return Some(hit);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            return None;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            return None;
        };
        if token.contains('x') {
            if ply % 2 == 0 {
                b -= 1;
            } else {
                w -= 1;
            }
            if w < lo_w || b < lo_b {
                return None;
            }
        }
        pos.play_unchecked(m);
        ply += 1;
    }
    step(&pos, ply, &mut streak)
}

/// Does the position hold the motif — a board motif off the board, the
/// castling motifs off the wings noted as the castling moves were
/// played, the move motifs off whether a side has played the move.
fn motif_holds(
    pos: &Chess,
    spec: &MotifSpec,
    white_wing: Option<CastlingSide>,
    black_wing: Option<CastlingSide>,
    white_played: bool,
    black_played: bool,
) -> bool {
    match spec.id.kind() {
        MotifKind::Board => board_motif_satisfied(pos.board(), spec.id, spec.side),
        MotifKind::Castling => match (white_wing, black_wing) {
            (Some(w), Some(b)) => {
                if spec.id == MotifId::OppositeCastling {
                    w != b
                } else {
                    w == b
                }
            }
            _ => false,
        },
        MotifKind::Move => match spec.side {
            MotifSide::White => white_played,
            MotifSide::Black => black_played,
            MotifSide::Either => white_played || black_played,
        },
    }
}

/// The FIRST ply of the earliest streak holding the motif for its
/// stability length, or None — the exact shape of the JS
/// `replayMotifHit` (server/refgamesScan.ts): the material hunt's
/// streak without its men gates, a board motif read before each move,
/// each side's castling wing and each side's motif move noted as the
/// move is played (so the position after the move is the first that
/// holds), and a side still uncastled once its rights are gone ending
/// a castling hunt early. Public for the golden test, which holds it to
/// the JS answers per game.
pub fn find_motif_hit(moves: &str, spec: &MotifSpec) -> Option<u32> {
    let kind = spec.id.kind();
    let mut pos = Chess::default();
    let mut ply: u32 = 0;
    let mut streak: u32 = 0;
    let mut white_wing: Option<CastlingSide> = None;
    let mut black_wing: Option<CastlingSide> = None;
    let mut white_played = false;
    let mut black_played = false;
    let step = |pos: &Chess,
                white_wing: Option<CastlingSide>,
                black_wing: Option<CastlingSide>,
                white_played: bool,
                black_played: bool,
                ply: u32,
                streak: &mut u32|
     -> Option<u32> {
        if motif_holds(pos, spec, white_wing, black_wing, white_played, black_played) {
            *streak += 1;
            if *streak >= spec.stable {
                // ply + 1 first: u32, and ply - stable alone underflows
                // on the very first ply of a stable-1 spec.
                return Some(ply + 1 - spec.stable);
            }
        } else {
            *streak = 0;
        }
        None
    };
    for token in moves.split(' ') {
        if let Some(hit) = step(
            &pos, white_wing, black_wing, white_played, black_played, ply, &mut streak,
        ) {
            return Some(hit);
        }
        let Ok(san) = token.parse::<SanPlus>() else {
            return None;
        };
        let Ok(m) = san.san.to_move(&pos) else {
            return None;
        };
        let white = pos.turn() == Color::White;
        if kind == MotifKind::Castling {
            if let Some(wing) = m.castling_side() {
                if white {
                    white_wing = Some(wing);
                } else {
                    black_wing = Some(wing);
                }
            }
        }
        let mut played = false;
        if kind == MotifKind::Move {
            played = match spec.id {
                MotifId::Underpromotion => m.promotion().is_some_and(|role| role != Role::Queen),
                MotifId::EnPassant => m.is_en_passant(),
                // A bishop takes the pawn on h7 (h2) beside a king on
                // g8 (g1), and it is check: the sacrifice, whether or
                // not it is taken.
                MotifId::GreekGift => {
                    m.role() == Role::Bishop
                        && m.to() == if white { Square::H7 } else { Square::H2 }
                        && m.capture() == Some(Role::Pawn)
                        && pos.board().king_of(if white { Color::Black } else { Color::White })
                            == Some(if white { Square::G8 } else { Square::G1 })
                }
                _ => false,
            };
        }
        pos.play_unchecked(m);
        ply += 1;
        if played && spec.id == MotifId::GreekGift {
            played = pos.is_check();
        }
        if played {
            if white {
                white_played = true;
            } else {
                black_played = true;
            }
        }
        if kind == MotifKind::Castling
            && ((white_wing.is_none() && !pos.castles().has_color(Color::White))
                || (black_wing.is_none() && !pos.castles().has_color(Color::Black)))
        {
            return None;
        }
    }
    step(&pos, white_wing, black_wing, white_played, black_played, ply, &mut streak)
}

/// One hunt per invocation: a position (fen, optionally relaxed by
/// `rung`), a material situation (`material`, the server's canonical
/// spec JSON) or a motif (`motif`, likewise canonical). The server
/// enforces exclusivity; more than one here is a usage error.
pub fn run_deep_search(
    db_path: &Path,
    fen: Option<&str>,
    rung: Option<&str>,
    material: Option<&str>,
    motif: Option<&str>,
    filters: &dyn Fn(&str) -> Option<String>,
) -> Result<(), Box<dyn std::error::Error>> {
    // The men-column prefilter, one shape for every hunt — see the JS
    // route for why final counts against a ceiling are sufficient.
    let spec: Option<MaterialSpec> = material
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "bad material spec")?;
    let motif_spec: Option<MotifSpec> = motif
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| "bad motif spec")?;
    if motif_spec.is_some() && (spec.is_some() || fen.is_some() || rung.is_some()) {
        return Err("--motif excludes --fen, --match and --material".into());
    }
    let mut target = Target::Exact(0);
    let mut target_w = 0i64;
    let mut target_b = 0i64;
    let mut target_wp = 0i64;
    let mut target_bp = 0i64;
    let mut want_black_to_move = false;
    let (men_ceil_w, men_ceil_b, min_ply, material_floor) = if let Some(motif) = &motif_spec {
        // Mirror of the JS route: a motif bounds no counts, so only the
        // game's length gates, as for the structure rung.
        (16, 16, i64::from(motif.stable) - 1, None)
    } else if let Some(spec) = &spec {
        let (lo_w, hi_w, lo_b, hi_b) = material_men_bounds(spec);
        (hi_w, hi_b, i64::from(spec.stable) - 1, Some((lo_w, lo_b)))
    } else {
        let fen = fen.ok_or("--fen or --material is required")?;
        let parsed: Fen = fen.trim().parse().map_err(|_| "bad fen")?;
        let setup = parsed.into_setup();
        // Mirror of the JS route (server/refgames.ts): the relaxed rungs
        // compare pawn squares, files or counts and the side to move —
        // none of the facts legality guards — so a kingless sketch (a
        // pawn-structure query) builds its target from the raw setup.
        // Exact stays strict: its key comes from the legal, normalised
        // position. The two paths must refuse and accept the same inputs.
        let (board, turn) = match rung {
            None => {
                let pos: Chess = Chess::from_setup(setup, CastlingMode::Chess960)
                    .map_err(|_| "bad position")?;
                target = Target::Exact(to_db_key(hash_position(&pos)));
                (pos.board().clone(), pos.turn())
            }
            Some(raw) => {
                let rung = Rung::parse(raw).ok_or("bad match mode")?;
                target = Target::Relaxed(rung, match_signature(&setup.board, rung));
                (setup.board.clone(), setup.turn)
            }
        };
        // The men gates count a missing king as present, as the JS side
        // does: every position a game passes through has both kings, so
        // a kingless sketch means "this structure, kings wherever they
        // stand". A legal target is unchanged.
        let kingless = |side: shakmaty::Bitboard| i64::from((board.kings() & side).is_empty());
        target_w = i64::from(board.white().count() as u32) + kingless(board.white());
        target_b = i64::from(board.black().count() as u32) + kingless(board.black());
        want_black_to_move = turn == Color::Black;
        target_wp = (board.pawns() & board.white()).count() as i64;
        target_bp = (board.pawns() & board.black()).count() as i64;
        if matches!(target, Target::Relaxed(Rung::Structure, _)) {
            // Mirror of the JS route: the pieces are free, so the men
            // columns say nothing and any game long enough to have
            // moved a pawn qualifies.
            (16, 16, 0, None)
        } else {
            (target_w, target_b, 32 - target_w - target_b, None)
        }
    };

    let conn = Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let has_table = |name: &str| {
        conn.query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            [name],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some()
    };
    let seek_players = has_table("players");
    let gw = games_where(filters, "", seek_players);
    let sql_and = if gw.clauses.is_empty() {
        String::new()
    } else {
        format!(" AND {}", gw.clauses.join(" AND "))
    };
    // A database indexed before the reachability columns scans without
    // the prefilter — slower, never wrong.
    let has_men = conn
        .query_row(
            "SELECT 1 FROM pragma_table_info('games') WHERE name = 'final_wmen'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let men_where = if has_men {
        " AND (final_wmen IS NULL OR final_wmen <= ?)
          AND (final_bmen IS NULL OR final_bmen <= ?)
          AND (ply_count IS NULL OR ply_count >= ?)"
    } else {
        ""
    };
    let men_binds: Vec<Value> = if has_men {
        vec![
            Value::Integer(men_ceil_w),
            Value::Integer(men_ceil_b),
            Value::Integer(min_ply),
        ]
    } else {
        Vec::new()
    };

    let count_binds: Vec<&dyn rusqlite::ToSql> = men_binds
        .iter()
        .chain(gw.binds.iter())
        .map(|v| v as &dyn rusqlite::ToSql)
        .collect();
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) AS n FROM games WHERE 1{men_where}{sql_and}"),
        count_binds.as_slice(),
        |r| r.get(0),
    )?;

    // Only what the scan tests. The route composes the frame the client
    // sees from the header row itself, so no header column is read here
    // and nothing here can disagree with the JS side about a frame.
    let mut page = conn.prepare(&format!(
        "SELECT id, moves FROM games
         WHERE id > ?{men_where}{sql_and}
         ORDER BY id LIMIT 1000"
    ))?;

    struct Row {
        id: i64,
        moves: String,
    }

    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    // The parent closing the pipe is the cancel signal — stop quietly.
    macro_rules! emit {
        ($value:expr) => {
            if writeln!(out, "{}", $value)
                .and_then(|()| out.flush())
                .is_err()
            {
                return Ok(());
            }
        };
    }

    let mut last_id: i64 = 0;
    let mut scanned: u64 = 0;
    let mut matched: u64 = 0;
    loop {
        let batch: Vec<Row> = {
            let last = Value::Integer(last_id);
            let binds: Vec<&dyn rusqlite::ToSql> = std::iter::once(&last as &dyn rusqlite::ToSql)
                .chain(men_binds.iter().map(|v| v as &dyn rusqlite::ToSql))
                .chain(gw.binds.iter().map(|v| v as &dyn rusqlite::ToSql))
                .collect();
            let rows = page.query_map(binds.as_slice(), |r| {
                Ok(Row {
                    id: r.get(0)?,
                    moves: r.get(1)?,
                })
            })?;
            rows.collect::<Result<_, _>>()?
        };
        if batch.is_empty() {
            break;
        }
        for row in &batch {
            scanned += 1;
            let hit = match (&motif_spec, &spec, material_floor, &target) {
                (Some(motif), _, _, _) => find_motif_hit(&row.moves, motif),
                (None, Some(spec), Some((lo_w, lo_b)), _) => {
                    find_material_hit(&row.moves, spec, lo_w, lo_b)
                }
                (_, _, _, Target::Relaxed(Rung::Structure, sig)) => {
                    find_structure_hit(&row.moves, sig, target_wp, target_bp)
                }
                _ => find_position_hit(&row.moves, &target, target_w, target_b, want_black_to_move),
            };
            if let Some(hit_ply) = hit {
                matched += 1;
                emit!(json!({ "type": "hit", "id": row.id, "ply": hit_ply }));
            }
            if matched >= DEEP_SEARCH_CAP {
                break;
            }
        }
        last_id = batch.last().expect("non-empty batch").id;
        emit!(
            json!({ "type": "progress", "scanned": scanned, "total": total, "matched": matched })
        );
        if matched >= DEEP_SEARCH_CAP {
            break;
        }
    }
    emit!(json!({
        "type": "done",
        "scanned": scanned,
        "total": total,
        "matched": matched,
        "exhaustive": matched < DEEP_SEARCH_CAP,
    }));
    Ok(())
}
