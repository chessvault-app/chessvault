# The repertoire trainer

*English · [한국어](repertoire.ko.md)*

The Repertoire page (under Tools) plays the opening against you in two
modes. **Sparring** is open play: you move, and the reply is drawn from
what real games actually played in the position. **Drilling** holds you
to one of your own studies: your moves are checked against it, the
replies stay inside what it covers, and what you fumble is remembered.
This page explains both, drill in particular, precisely enough to
predict what the trainer will do in any position.

## Sparring

You pick a side, a source, and an opening to start from (the curated
list, or any of the ~3,800 ECO openings by name or code). After each of
your moves the trainer fetches every reply real games made in the
position, with game counts, and plays one at random **in proportion to
those counts** — the field's move, not the best move.

Two kinds of source answer that question:

- **The Lichess database** (online, through your API token), filtered
  to a rating band you choose. The bands are the groups the Lichess
  explorer itself aggregates by — they cannot be refined further, which
  is why the list is what it is.
- **Any local reference database** — the bundled starter set or one you
  built on the Databases page. A database offers no band: its
  population was fixed when it was built, so the choice of database *is*
  the choice of field. This is also what works offline, with no token.

When the line runs past the source — no games left in the position —
the session ends: the engine evaluates the final position, and the line
can be handed to the analysis board or saved into a study.

## Drilling a study

Drill mode replaces the opening picker with a study picker. The study's
chapters are parsed with the same codec the study editor uses, so
everything you wrote — mainlines, variations, chapters — is what you
are drilled on. You still choose your side and the field that answers.

**Scope** is the chapter select's first decision:

- **One chapter** (the default): only that chapter's tree counts.
- **Whole study**: every chapter counts as one repertoire. Chapters
  written one-variation-each compose — and a transposition into a
  position that another chapter (or another move order) reached its own
  way is recognised, not called a miss.

### What "in book" means

The drill's position is not one study node but a **set of candidate
nodes**: every node in scope that holds the current position. At the
start of a whole-study drill that is each chapter's root; after 2...Nc6
3.Bb5 in a study with Cozio, Steinitz and Berlin chapters, it is one
node in each of them.

Positions are identified by their FEN without the move counters, so the
identity survives move-order differences. A move is **in book** if any
candidate has it as a child, or if the position it produces exists
anywhere in scope (a transposition). The **expected moves** at any
position are the union of every candidate's children.

### Your moves: hit and miss

When you play a move, the drill advances the candidate set: each
candidate's matching child survives, plus every node in scope already
holding the new position.

- **Hit** — the set is non-empty. The move commits, and a `hit` is
  recorded for the position.
- **Miss** — the set is empty. The move is *refused*: the book move is
  named ("Your study plays e4 here — try it again"), the piece stands
  for a beat and snaps back — the puzzle trainer's wrong-move rhythm —
  and the position waits to be answered right. A `miss` is recorded.

Each position records at most once per session, and a miss claims the
slot: the retry that follows the reveal is practice, not evidence. A
clean recall in a *later* session is what clears the miss.

### The field's replies: steering

The field's reply is where drill differs most from sparring. The full
move list is fetched as usual, then split against the candidate set:

1. **Covered** replies — in book by the definition above.
2. **Uncovered** replies — everything else.

If anything is covered, the weighted-random sample runs **over the
covered set only**. Relative frequencies are preserved: it is the
field's distribution *conditioned on staying inside your repertoire*.
Concretely, with the bundled elite database after 1.e4 (132,971
games: c5 35%, e5 26%, e6 12%, …) and a study preparing only 1...e5,
the field plays e5 every time. If the study also prepared a Sicilian
line, the pool would be e5 and c5 at 26 : 35 — the Sicilian slightly
more often, as in life.

The uncovered replies are not discarded. The most common one, if it
accounts for **at least 5% of games** in the position, produces a quiet
note under the status — "Gap noted — the field also plays c5 (35% of
games), and your study has no answer to it" — and one `gap` record per
position per session. The move itself is never played; the drill keeps
testing memory. (Steering ending sessions on every rare sideline was
the original design, and it made drills unfinishable — the field found
the same hole every time instead of exercising the lines that exist.)

Only when **nothing** is covered does the sampler fall back to the
honest full-field distribution: it plays whatever it draws, records the
gap, and ends the drill naming the move and its share of games. At that
point there is no conditional distribution left to draw from, and the
most useful thing the trainer can say is what actually beat the prep.

### How a session ends

- **End of your prepared line** — the candidate set has no children
  left anywhere: every move matched, and the study goes no further.
- **A gap** — the study covered none of the field's replies (above).
- **Past the database** — the field itself has no games left, same as
  sparring.

All three hand off the same way sparring does: engine verdict, analyse
on the board, save the line to a study.

### The record and the review pool

Every drilled position appends one line to
`vault/repertoire/history.jsonl` — the puzzle trainer's shape, because
it obeys the puzzle trainer's rule:

```json
{"study":"Ruy Lopez","chapter":"Main line","key":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -","result":"miss","path":[],"expected":["e4"],"played":"d4","at":"…"}
{"study":"Ruy Lopez","chapter":"Main line","key":"…","result":"hit","path":["e4","e5"],"expected":["Nf3"],"played":"Nf3","at":"…"}
{"study":"Ruy Lopez","chapter":"Main line","key":"…","result":"gap","path":["e4","c5"],"played":"c5","at":"…"}
```

The **latest** entry per position decides its state. Misses form the
review pool; a later clean recall removes them. Gaps are reported
*beside* the pool, never inside it — a gap is fixed by editing the
study, not by drilling harder. The idle panel shows both counts, and
**Drill a missed position** replays a recorded path to start a session
at a position the record says was fumbled (falling back to the start if
the study no longer contains the line). In a whole-study drill the
record still files under the chapter the position belongs to, so
chapter-scoped counts stay meaningful.

The file is damage-tolerant (a torn last line loses one attempt, never
the trainer) and lives in the vault: it travels with backups, and the
studies themselves are never touched by any of this.

### What the drill does not promise

- The field plays the intersection of your study and its own games. A
  prepared line the field never plays at that level will not be visited
  by the field's side — reach it from the review pool, or switch to a
  database where the line occurs.
- Steered replies are not a statistically faithful simulation of
  opponents: a study covering a quarter of the field feels fully
  covered while you drill it. That is the intended trade — drill tests
  recall, spar tests reality — and the gap notes and panel counts are
  what keep the coverage truth visible.
- Difficulty of the *moves* is the study's own: the drill never judges
  move quality, only agreement with what you prepared.
