# Explaining the engine

*English · [한국어](explaining.ko.md)*

Stockfish answers *what* — the best move and a number — and never *why*.
The number is not even an opinion about the position on the screen: it is
the evaluation of the position at the end of the principal variation,
propagated back on the assumption both sides play those moves. Since
NNUE replaced the handcrafted evaluation there is no material/king-safety/
mobility breakdown left to read out of it, so "why" cannot be paraphrased
out of the engine at all.

What survives that constraint is the one answer that is **read out of
the engine** rather than inferred: the network's own per-piece values.
Everything softer — heuristic readings of lines,
counter-factual probes — was tried and removed: however carefully gated,
a heuristic explanation is sometimes wrong, and a wrong explanation
under an engine line is worse than none. No feature here guesses, and
none uses a language model.

## Where each answer lives

| Surface | What it says |
|---|---|
| Header thermometer | Toggles the piece-value overlay |
| The board | Piece values, when the overlay is on |

## The feature

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

Eval traces run on one lazy worker (`web/src/engine/probe.ts`),
deliberately separate from the interactive engine: a trace must never
steal the search being watched, and the interactive engine must never
abort a trace mid-answer. It is small on purpose — two threads, 32 MB
hash — because a trace is a single forward pass; the interactive engine
is the one that owns the machine. Calls are serialised on a promise
queue, and the worker is released (it is real WASM memory) once the
overlay is off.

## Determinism, said precisely

This is in the strongest tier there is: a **single evaluation**. An
`eval` trace is one forward pass — same position, same build, same
numbers.

What deliberately does not exist: any model-generated prose, anything
trained, anything heuristic, anything that could assert a chess claim no
proof or evaluation backs. If a natural-language layer is ever added,
its leash is already designed — it may verbalise these outputs and
nothing else.

## Verification

- `web/src/engine/evalTrace.test.ts` — the parser against the shipped
  build's verbatim trace output.
- Verified against the shipped WASM binary by running it under Node:
  the `eval` command answers with the piece grid.
- Verified live in the app: the overlay, on the dev server through the
  real UI.

Every user-facing string goes through `t()`.
