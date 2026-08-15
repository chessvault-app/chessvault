# The opening map

*English · [한국어](opening-map.ko.md)*

The Opening map (under Tools) shows your opening preparation as a tree:
one map for White, one for Black. You place the moves that define your
repertoire — the root's children are your first moves, each node's
children the replies you intend to meet — and link your studies and
notes to the nodes. Everything below a node that a linked study
actually covers is **derived live from the study**, never stored, so
the map cannot drift from the preparation it describes.

## What a node is

A node is a move, identified by its move path from the starting
position. It can carry:

- **Links** — any number of studies (optionally scoped to one chapter,
  which also covers its sub-chapters) and notes. Studies feed the
  derived coverage; notes are references for the reader and never do.
- A **name** — set by hand, or taken from the opening catalogue when
  the node's own position has a named row (the same ~3,800-line
  catalogue the explorer uses, matched by position, so transpositions
  name themselves correctly).
- An **intended depth** in full moves — what you mean to prepare. The
  node compares it against what the linked studies actually reach and
  wears the difference as an arc filling around the dot toward the
  target (amber while short, green once met), with the panel saying it
  in words: "Prepared to move 7 — target 12".
- A free-text **note**.

A node with no linked studies is a *plan* — drawn dashed — which is how the
map shows the difference between "I intend to meet 1...c6" and "I have
something prepared against it".

## Coverage

All of a map's linked studies are pooled into one position index,
matched by position (FEN without the move counters). That one decision
buys three things: several studies linked on one node merge into a
union, a study can never claim a branch its tree does not contain
(link it anywhere — matching is positional), and a line reached by transposition
counts once. Each covered node shows how deep the union runs and how
many distinct lines it holds, and the panel offers continuations the
studies prepare that the map does not chart yet — one tap adds them.

## Growing the map

Moves arrive three ways. **Tap** — the add sheet lists every reply the
chosen field plays at the position, ordered by share, with what the
studies prepare and what the map charts marked on the rows. **Type** —
plain SAN, for the move nobody has played yet. **Grow from my games** —
from any node (an empty map's root included), the walk charts the move
you actually play most on your turns and every reply you keep meeting
on theirs, over a games floor you choose, with a preview before
anything is written. That is how a blank map becomes your played
repertoire in one press; studies then hang on it.

## Gaps against the field

Coverage says what *you* prepared; the gap check says what *they*
play. Choose a field — the Lichess database at a rating band, any
local reference database, or **your own games** (filtered to the map's
colour: the field you have actually been facing) — and at every
position where the opponent
moves, the map fetches what real games played there and flags popular
replies (5% of games or more, the drill's own threshold) that neither
the map charts nor any linked study prepares. The node wears the count
as a badge; the panel shows the full statistics table — every
continuation with its share of games and the W/D/L split as a bar,
charted rows jumping to their node, unmet ones charting in a tap,
popular unmet ones framed in warning — and reports how much of the
field the node meets ("62% of games met"). The check is off until a
source is chosen — in the map's floating menu, which also switches the
colour and opens My games — and the choice is device-local; answers
are cached per session.

## Games that left the book

**My games**, in the map's floating menu, asks the games index where each of your recent
games of the map's colour first stepped off prepared ground — the
charted nodes plus everything the linked studies hold. Results are
grouped by the position it happened in, because that is the actionable
unit: five games leaving at one node is one hole, not five incidents.
Each group names the moves that left and who played them — a reply
*they* keep playing is a gap to prepare; a move *you* played past your
own book is a line to extend — and offers a jump to the map node when
one stands there, plus each game opened on the analysis board at the
exact deviation.

## Drill health

The drill record (`vault/repertoire/history.jsonl`) already knows
which prepared positions were fumbled last and where a drill walked
into a hole the studies cannot answer. The map reads each linked
study's summary and counts both over the same walk coverage makes, so
a parent inherits everything beneath it: an amber dot means fumbled
positions below, a red dot means recorded drill gaps, and the panel
says the numbers. The Drill button starts the trainer exactly at the
node, which is how a shaky line gets fixed.

## Following a node out

- **Open a linked study** — it opens *on the node's position*, in the
  first chapter the link's scope holds it in, not at the top of the
  file.
- **Analyse** — hands the map's own tree to the analysis board, cursor
  on the node, facing the map's colour.
- **Drill** — hands the whole map to the repertoire trainer: every
  scoped chapter of every linked study becomes one drill scope,
  starting from the node (see [the repertoire trainer](repertoire.md)).
  Attempts are recorded under the real study and chapter each position
  belongs to, so per-study summaries stay truthful.

## The picture

The map draws as a graph view — the constellation the vault's Obsidian
ancestry promises. Circles are sized by what hangs beneath them — and,
while a field source is on, by how often the move actually gets played
at its parent, so the fat dots are the crowd and the small ones the
sidelines. Edges to each node's most-played child draw heavier, so the
mainlines read as a spine — follow the thick edges from the root and
you are walking the line the field walks. The
layout is a deterministic force relaxation, so the same map always
settles into the same shape and an edit nudges the picture instead of
reshuffling it — and the page load *plays* that relaxation: the
constellation blooms out of its seed and settles before your eyes
(skipped when the OS asks for reduced motion). Wheel zooms to the
cursor, dragging the ground pans, two fingers pinch, and dragging a
dot moves the dot — mouse or touch — pinning it there for the session
while the stored layout stays deterministic. Labels keep their screen
size and fade out as the view pulls
back — far out you read the shape, close in you read the names.
Covered nodes are filled, plans are hollow and dashed, and the badges
(field gaps, drill health, the depth arc) ride on the dots.

## What is stored

One file, `vault/repertoire/map.json` — beside the drill history,
because they are two views of the same subject. Only the skeleton is in
it: moves, ids, links (stored under the field name `tags`), names,
depths, notes. Positions and coverage are derived at load by replaying
the moves. Renaming or moving a linked study (or a whole collection)
follows through to the links, the same way bookmarks follow; deleting
one deliberately does **not** remove its links — a link whose study
vanished means "this line lost its prep", and the panel shows it as a
broken reference until you re-point or remove it.
