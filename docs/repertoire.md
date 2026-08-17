# The repertoire trainer

*English · [한국어](repertoire.ko.md)*

The Repertoire page (under Tools) plays the opening against you in two
modes. **Free play** is exactly that: you move, and the reply is drawn from
what real games actually played in the position. **Drilling** holds you
to one of your own studies: your moves are checked against it, the
replies stay inside what it covers, and what you fumble is remembered.
This page explains both, drill in particular, precisely enough to
predict what the trainer will do in any position.

## Free play

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

A third scope arrives from outside: the [opening map](opening-map.md)'s
Drill button hands over **every scoped chapter of every study the map
links**, as one repertoire, starting from the chosen node. The rules
below apply unchanged — the candidate set is just larger — and each
attempt is recorded under the study and chapter the position actually
belongs to, so per-study summaries stay truthful.

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

The field's reply is where drill differs most from free play. The full
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
accounts for **at least 5% of games** in the position *and is relevant
to the study's subject*, produces a quiet note under the status — "Gap
noted — the field also plays a6 (24% of games), and your study has no
answer to it" — and one `gap` record per position per session. The move
itself is never played; the drill keeps testing memory. (Steering
ending sessions on every rare sideline was the original design, and it
made drills unfinishable — the field found the same hole every time
instead of exercising the lines that exist.)

**Relevance** is what keeps 1...c5 from being reported as a hole in a
Ruy Lopez study. The scope's **trunk** is the shared single-line
lead-in every line plays before the study first branches — for a study
of the Ruy sidelines, 1.e4 e5 2.Nf3 Nc6 3.Bb5. A deviation at or past
the trunk's end is study territory and always counts (3...a6, or
anything deep in a chapter). A deviation *before* the trunk ends counts
only if the position it produces stays in the same opening family as
the trunk's end — the ECO name's part before the colon. 3...Nf6 gives
"Ruy Lopez: Berlin Defense", same family, reported; 1...c5 gives
"Sicilian Defense", a different opening altogether, suppressed. A broad
repertoire study that branches at once (a whole-1.e4 study) has a
one-ply trunk, so every reply deviation is study territory and nothing
is suppressed. Positions the catalogue does not name fall back to
reporting everything, as before.

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
  free play.

All three hand off almost the same way free play does: engine verdict,
analyse on the board. Where free play offers to save the line — it exists
nowhere else — a drill offers the way back to the study it came from,
since filing the line again would only write the same moves twice.

### The record and the review pool

Every drilled position appends one line to
`vault/repertoire/history.jsonl` — the puzzle trainer's shape, because
it obeys the puzzle trainer's rule:

```json
{"study":"Ruy Lopez","chapter":"Main line","key":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -","result":"miss","path":[],"expected":["e4"],"played":"d4","at":"…"}
{"study":"Ruy Lopez","chapter":"Main line","key":"…","result":"hit","path":["e4","e5"],"expected":["Nf3"],"played":"Nf3","at":"…"}
{"study":"Ruy Lopez","chapter":"Main line","key":"…","result":"gap","path":["e4","e5","Nf3","Nc6","Bb5","a6"],"played":"a6","at":"…"}
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

### Where this converges

The pieces above form a loop with a deliberate fixed point. Drilling
surfaces gaps; you answer them by editing the study; the next drill
probes deeper and surfaces the next layer. Left running, the loop does
NOT converge on "every line in the database" — it converges on the
study's **5%-closure**: every position reachable by playing your
prepared moves against replies that each clear a 5% share of games
locally, within the study's own opening family, out to the depth where
the source still has games. The database's tail of one-game oddities
stays invisible by design — never reported, and never played, since
steering keeps the field inside your coverage.

Meanwhile the review pool converges on the other half: recalling
everything the study contains. Together the two limits say what the
trainer is for — mastering the opening *as the field actually plays
it*, not the database.

Two properties of the loop are worth knowing. It is paced: only the
single most common uncovered reply is noted per position per session,
so three sidelines surface across three sessions, not as an audit
dump. And it has a human in it: the trainer reports gaps but never
writes a line into a study — the closure grows exactly as fast as you
edit, and if you broaden the study's subject (answering a gap with a
new opening's chapter), the trunk shortens and the frontier widens to
match your new definition of the subject.

### What the drill does not promise

- The field plays the intersection of your study and its own games. A
  prepared line the field never plays at that level will not be visited
  by the field's side — reach it from the review pool, or switch to a
  database where the line occurs.
- Steered replies are not a statistically faithful simulation of
  opponents: a study covering a quarter of the field feels fully
  covered while you drill it. That is the intended trade — drill tests
  recall, free play tests reality — and the gap notes and panel counts are
  what keep the coverage truth visible.
- Difficulty of the *moves* is the study's own: the drill never judges
  move quality, only agreement with what you prepared.
