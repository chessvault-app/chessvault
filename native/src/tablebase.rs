//! Syzygy probing, as a resident mode of this binary.
//!
//! The app can already answer endgames by asking a tablebase server over
//! HTTP (`server/tablebase.ts`). This is the same answer without the
//! server: a vault that has the `.rtbw`/`.rtbz` files points at them and
//! this process reads them directly, so nothing has to be installed
//! beside the app and nothing leaves the machine.
//!
//! Resident, not spawned per question. The tables are memory-mapped, and
//! a probe from a warm mapping is microseconds where starting a process
//! to make one is tens of milliseconds — so this reads FENs from stdin
//! for as long as it is wanted and answers one JSON object per line. It
//! is therefore the opposite shape to this binary's other jobs, which
//! start, burn CPU and exit; see `server/tablebaseNative.ts` for the
//! half that owns the lifetime.
//!
//! What it deliberately does NOT do is reshape the answer. The point of
//! view flipping and the move ordering live once, in TypeScript, where
//! the HTTP source's answers are already normalised — so this emits the
//! same raw shape lila-tablebase does (each move judged from the REPLY's
//! side, distances signed) and the one normaliser handles both. A second
//! copy of that logic here is exactly the drift this repo keeps warning
//! about.

use std::io::{BufRead, Write};
use std::path::Path;

use shakmaty::fen::Fen;
use shakmaty::san::San;
use shakmaty::{CastlingMode, Chess, Position};
use shakmaty_syzygy::{AmbiguousWdl, Tablebase};

/// Syzygy stops here, and asking about more pieces than the tables hold
/// is a file miss per query — so it is refused before it becomes one.
const MAX_PIECES: usize = 7;

/// What a verdict is called, in the vocabulary the app already speaks.
///
/// A straight renaming, deliberately: `AmbiguousWdl` has exactly these
/// seven cases and has already done the reasoning behind them — the
/// fifty-move counter's effect on whether a win can still be converted,
/// and whether the DTZ saying so was rounded (in which case the honest
/// answer is "probably", which the app declines to judge a move by).
/// Deriving that here from the raw WDL was the first draft and was a
/// second implementation of somebody else's fifty-move arithmetic; the
/// crate and lila-tablebase share an author, so taking the crate's own
/// answer is also what keeps the two sources agreeing.
fn category(wdl: AmbiguousWdl) -> &'static str {
    match wdl {
        AmbiguousWdl::Win => "win",
        AmbiguousWdl::MaybeWin => "maybe-win",
        AmbiguousWdl::CursedWin => "cursed-win",
        AmbiguousWdl::Draw => "draw",
        AmbiguousWdl::BlessedLoss => "blessed-loss",
        AmbiguousWdl::MaybeLoss => "maybe-loss",
        AmbiguousWdl::Loss => "loss",
    }
}

/// The verdict and distance for one position, or None where the tables
/// do not reach it (too many pieces, or a file this set does not have).
fn look_up(tables: &Tablebase<Chess>, pos: &Chess) -> Option<(&'static str, Option<i32>)> {
    let dtz = tables.probe_dtz(pos).ok();
    let wdl = tables.probe_wdl(pos).ok()?;
    Some((
        category(wdl),
        dtz.map(|d| i32::from(d.ignore_rounding())),
    ))
}

/// One position's answer, in lila-tablebase's shape.
fn answer(tables: &Tablebase<Chess>, pos: &Chess) -> serde_json::Value {
    let Some((category, dtz)) = look_up(tables, pos) else {
        return serde_json::json!({ "category": "unknown", "moves": [] });
    };

    let mut moves = Vec::new();
    for m in pos.legal_moves() {
        let san = San::from_move(pos, m).to_string();
        let uci = m.to_uci(CastlingMode::Standard).to_string();
        let mut child = pos.clone();
        child.play_unchecked(m);
        // The child's verdict belongs to the side to move THERE, which is
        // the opponent — left that way on purpose (see the module note).
        let (child_category, child_dtz) = look_up(tables, &child)
            .unwrap_or(("unknown", None));
        moves.push(serde_json::json!({
            "uci": uci,
            "san": san,
            "category": child_category,
            "dtz": child_dtz,
            "dtm": serde_json::Value::Null, // Syzygy holds no distance to mate.
            "zeroing": m.is_zeroing(),
            "checkmate": child.is_checkmate(),
            "stalemate": child.is_stalemate(),
        }));
    }

    serde_json::json!({
        "category": category,
        "dtz": dtz,
        "dtm": serde_json::Value::Null,
        "checkmate": pos.is_checkmate(),
        "stalemate": pos.is_stalemate(),
        "moves": moves,
    })
}

/// Read FENs, write answers, one line each, until stdin closes.
///
/// A line that is not a position gets `category: unknown` rather than an
/// error: the caller is a queue of questions, and one bad question must
/// not end the conversation or lose the answers behind it.
pub fn run_tablebase(dir: &Path, input: impl BufRead, mut output: impl Write) -> Result<(), String> {
    let mut tables: Tablebase<Chess> = Tablebase::new();
    tables
        .add_directory(dir)
        .map_err(|e| format!("cannot read tables in {}: {e}", dir.display()))?;
    // Said once, so the owner can tell "no tables" from "no answer for
    // this position" — the two look identical from the outside and mean
    // completely different things to whoever is waiting.
    writeln!(
        output,
        "{}",
        serde_json::json!({ "ready": true, "tables": tables.max_pieces() })
    )
    .map_err(|e| e.to_string())?;
    output.flush().map_err(|e| e.to_string())?;

    let unknown = serde_json::json!({ "category": "unknown", "moves": [] });
    for line in input.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let fen = line.trim();
        if fen.is_empty() {
            continue;
        }
        let parsed = fen
            .parse::<Fen>()
            .ok()
            .and_then(|f| f.into_position::<Chess>(CastlingMode::Standard).ok())
            .filter(|pos: &Chess| {
                pos.board().occupied().count() <= MAX_PIECES
                    && pos.castles().castling_rights().is_empty()
            });
        let body = match parsed {
            Some(pos) => answer(&tables, &pos),
            None => unknown.clone(),
        };
        writeln!(output, "{body}").map_err(|e| e.to_string())?;
        output.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Exported for the parity test, which replays positions through both
/// this and the HTTP source and diffs the two.
pub fn answer_for(tables: &Tablebase<Chess>, pos: &Chess) -> serde_json::Value {
    answer(tables, pos)
}

/// Open a table directory once, for callers that probe in a batch.
pub fn open(dir: &Path) -> Result<Tablebase<Chess>, String> {
    let mut tables: Tablebase<Chess> = Tablebase::new();
    tables
        .add_directory(dir)
        .map_err(|e| format!("cannot read tables in {}: {e}", dir.display()))?;
    Ok(tables)
}
