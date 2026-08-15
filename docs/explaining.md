# Explaining the engine

*English · [한국어](explaining.ko.md)*

Stockfish answers *what* — the best move and a number — and never *why*.
The number is not even an opinion about the position on the screen: it is
the evaluation of the position at the end of the principal variation,
propagated back on the assumption both sides play those moves. Since
NNUE replaced the handcrafted evaluation there is no material/king-safety/
mobility breakdown left to read out of it, so "why" cannot be paraphrased
out of the engine at all.

It can, however, be **interrogated**. Everything in this document works
one of three ways, and nothing works any other way:

- **Replaying the line it already gave.** What gets traded, which pawn
  breaks, where the knight ends up — facts a pure function can read off
  the moves. No search, no model.
- **Asking a counter-factual.** What happens if the mover passes? What is
  the honest reply to *this* move at the same depth as the best one?
  These are ordinary searches with the question built into the position.
- **Looking something up that is proven.** A ≤7-man tablebase verdict,
  or the network's own per-piece values.

No feature here guesses, and none uses a language model. Every claim
traces to a line that can be replayed, a search that was actually run, or
a table that is simply correct — the same rule the book importer lives
by. When a detector cannot be sure, it stays silent; a wrong chip is
worse than a missing one.

## Where each answer lives

Everything hangs off the engine block (docked above the Moves panel) and
the board:

| Surface | What it says |
|---|---|
| Header, after the depth | Win/draw/loss, e.g. `34·61·5` |
| Header chip | `Critical` / `Only move` when the position is sharp |
| Header buttons | `?` opens the Why card; the thermometer toggles the piece-value overlay |
| Above the lines | The tablebase verdict, in small endgames |
| On each line | A motif chip when the line contains a tactic, with the side's colour swatch |
| Under the lines | `White's plan:` / `Black's plan:` — what the top line is trying to do |
| The Why card | The threat, and the verdict on the last move |
| The board | Piece values, when the overlay is on |

Everything ambient is either free or already paid for; everything that
costs a search hides behind the `?` button and runs only when asked.

## The features

### Win/draw/loss (header)

`+1.8` answers a different question than "how often does this win", and
for fortress-shaped positions the two answers disagree. Stockfish
already carries its own conversion — `UCI_ShowWDL` — so the driver
switches it on and the parser keeps one more field. Displayed White-POV
like the score (`34·61·5` = White wins 34%, draw 61%, Black wins 5%), at
the engine's own playing strength, which the tooltip says out loud.
Cost: none; the search is unchanged.

### Critical positions (header chip)

The winning-chances gap between the best and second-best line is a
direct measure of how precise the mover must be. Gap ≥ 0.15 shows
`Critical`; ≥ 0.30 shows `Only move`; the tooltip carries both
percentages. Lost positions get no chip — every road goes downhill, so
none of them is "the" move.

It exists exactly when MultiPV ≥ 2 is already searching (the default is
3) and is pure arithmetic on lines already paid for. It never raises
MultiPV itself: with one line it simply doesn't exist. Depth-gated at 10
so it doesn't flicker through the shallow iterations. The thresholds are
heuristics in the open (`EnginePane.tsx`), cheap to retune.

### Tablebase verdicts (above the lines)

In a 7-man ending the engine's `+2.1` can be a proven draw, and no depth
setting fixes that — the eval is an estimate and the tablebase is a
proof. With 7 men or fewer and no castling rights (Syzygy does not model
castling), the pane asks the server, which proxies
`tablebase.lichess.ovh` and caches every answer **forever** — verdicts
cannot go stale. The row reads like `Tablebase: White wins, mate in 8`
(DTM plies halved into moves); cursed wins and blessed losses read as
the 50-move draws they are; `maybe-*` rounding collapses to its base
category with the nuance left to the tooltip.

Failures are silent by design: offline, the row is simply absent (and
any position ever seen keeps answering from the cache). The static demo
declares this route deliberately absent — the proxy is a disk cache and
the demo has no disk.

### The plan line (under the lines)

A fifteen-move PV is unreadable; what it *does* is usually three things.
`shared/explain.ts` replays the top line and reads **gestures** out of
the diff: pawn breaks, minors planted on real outposts, files opened
(with the rook's arrival merged in), passed pawns created or pushed,
maneuvers (`Nf3–e1–d3` collapses to one journey), trades (down to the
colour complex when both bishops die on the same colour), pawn storms,
castling, king walks, and "trade down to convert" when already ahead.

Each gesture type has a weight, decayed toward the tail of the PV — the
head of a line is the verified part, the tail barely is. The top three
by weight are told in **line order**, because plans read as sequences,
and the label names whose plan it is (a plan always belongs to the side
to move): `White's plan: play the f5 break, plant the knight on d5`.
The one exception is the nobody's-plan reading — "neither side can make
progress" — which stays unattributed because that is the point of it.

Two deliberate refusals. A line that wins heavy material or mates
returns no plan at all — that is a combination, and the motif chip's
story. And a line in which nothing happens — no captures, no pawn moves,
pieces shuffling — reports exactly that ("neither side can make
progress"), because at 0.00 that *is* the explanation.

Cost: microseconds per line, recomputed inside the pane's existing
90 ms coalescing. Pure function, fixture-tested.

### Motif chips (on the lines)

When a line actually contains a tactic, the line says which: fork, pin,
skewer, discovered attack, back-rank mate, trapped piece, promotion —
plus a sacrifice tag with the one distinction humans need: **temporary**
(the material comes back inside the line, or it mates — a combination)
versus **real** (it never comes back; the compensation is positional and
you should not expect the material returned). Detection is board
geometry over the replayed line, mover's moves only, first twelve plies.
Every chip carries the side's colour swatch — a motif always belongs to
the side to move in that line, and the swatch says so without spending
a word on it.

The detectors are deliberately strict, and four of their rules exist
because the first live run got them wrong (each is now a regression
test):

- A pin or skewer requires that the front piece cannot simply capture an
  undefended slider — `Qxd8+ Kxd8` is a trade, not a skewer.
- A sacrifice requires the material dip to *persist* across two
  consecutive measurements (taken after the opponent's replies, the same
  rule the review's brilliancy check uses), over the whole replay — an
  opponent merely capturing first in a trade sacrifices nothing, and
  cutting the ledger mid-exchange manufactures phantom sacrifices. A dip
  straight into mate keeps its tag.
- A pawn storm exists only against a king committed to a wing, on that
  wing's three files, once a pawn crosses the middle — `1.e4` is not an
  attack on e8.
- A trapped piece requires the hunter itself to be uncapturable at a
  profit — `Nxc6` does not trap the queen that `...dxc6` rescues.

Most lines get no chip. That is correct behaviour, not a gap.

### The Why card (`?` in the header)

The two questions that cost a search, behind one click. Rows stream in
as their probes finish; finished cards are cached per position, so
stepping away and back reopens instantly.

**Threat.** The position with the side to move flipped (en passant
cleared) is searched at depth 12: the opponent's best plan *if the mover
passes*. This is the single fact behind most mysterious quiet engine
moves — `a4` stops `...b5`, `h3` forestalls the pin. Refused when the
mover is in check, where passing is not a meaningful question. The line
is shown but not clickable: a pass cannot land on the board.

**The last move.** For the move that reached the current position, two
searches of the parent position at equal depth 14 — one free, one
restricted to the played move (`go searchmoves`) — give an honest
comparison the interactive engine's shifting depths cannot. The verdict:

- the engine's own choice;
- fine — nearly as good as the best move (chances drop < 5%);
- refuted, and *how*: the reply forces mate, or wins a named amount of
  material (the reply line replayed, the ledger read at its end), or —
  when nothing concrete shows — the honest "no tactic, the engine simply
  prefers X". The winning-chances pair sits in the tooltip, and the
  refutation line is playable: it continues from the position on screen.

To ask "why not my move?", play the move and press `?` — the card
answers for whatever move produced the position it is looking at.

### The piece-value overlay (thermometer in the header)

The honest answer to "equal material, so why +2?" is usually two or
three pieces. Stockfish's `eval` trace computes what every piece is
worth to the network — remove it, re-run the eval — and the overlay
paints those values on the board, White-POV pawns, kings excluded
(removing a king is not a position). Colour follows **surplus** over the
piece's nominal value, not magnitude: a queen "worth 9" is furniture, a
bishop "worth 5" is the story.

It is a static forward pass — no search — so it is effectively instant,
and it re-traces automatically as you step through moves while the
toggle is on. Off by default: an overlay this loud must be asked for. An
engine build without the `eval` command marks the feature unsupported
after one silent failure and the toggle disappears. The parser is locked
to the shipped build's verbatim output by a fixture test, so an engine
upgrade that reshapes the trace fails loudly instead of blanking the
overlay. Static means tactically blind — the trace values a piece's
placement, not the combination it is about to fall to — which is why the
overlay is a lens, not a verdict.

## The probe worker

Threat searches, why-not searches and eval traces run on one lazy
worker (`web/src/engine/probe.ts`), deliberately separate from the
interactive engine: a probe must never steal the search being watched,
and the interactive engine must never abort a probe mid-answer. It is
small on purpose — two threads, 32 MB hash — because probes answer
qualitative questions at modest depth; each costs about one
review-position search. Calls are serialised on a promise queue, and the
worker is released (it is real WASM memory) once the card and the
overlay are both off.

The depths (12 for threats, 14 for verdicts) are constants in
`web/src/store/explain.ts` with the reasoning attached. They are
heuristics; a phone that finds them slow should lower them there.

## Determinism, said precisely

Three tiers, weakest to strongest:

1. **Deterministic logic around a search** — threat, why-not, sharpness,
   WDL. The classification and arithmetic are fixed functions, but a
   multi-threaded search is not bit-reproducible, so the *inputs* can
   vary between runs. These features answer qualitative questions where
   that variance does not change the verdict — and when it someday
   matters (persisting explanations into a study), the recipe is fixed
   depth, one thread, fresh hash.
2. **Pure functions** — the plan and motif readers. Same line in, same
   reading out, forever. This is why they live in `shared/` and carry
   fixture tests.
3. **Proofs and single evaluations** — tablebase verdicts (exact,
   eternal, cached accordingly) and the `eval` trace (one forward pass:
   same position, same build, same numbers).

What deliberately does not exist: any model-generated prose, anything
trained, anything that could assert a chess claim no probe measured. If
a natural-language layer is ever added, its leash is already designed —
it may verbalise probe output and nothing else.

## Verification

- `shared/explain.test.ts` — fixture positions for every motif and plan
  gesture, plus one regression test per false positive found by driving
  the live app (the four rules above).
- `web/src/engine/evalTrace.test.ts` — the parser against the shipped
  build's verbatim trace output.
- `web/src/engine/uci.test.ts`, `tablebase.test.ts` — WDL parsing and
  POV, verdict wording, eligibility.
- Verified against the shipped WASM binary by running it under Node:
  the `eval` command answers with the piece grid, and `wdl` fields
  arrive once `UCI_ShowWDL` is set.
- Verified live in the app: probes, card, overlay, WDL, plan, chips and
  the tablebase proxy, on the dev server through the real UI.

Every user-facing string goes through `t()`; the Korean entries reuse
the puzzle themes' existing motif vocabulary rather than coining second
translations.
