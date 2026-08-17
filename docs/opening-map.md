# The opening map

*English · [한국어](opening-map.ko.md)*

The Opening map (a tile on the home page, a top-level entry in the
sidebar; on a phone it is also under More) shows your opening
preparation as a tree:
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
source is chosen — from the map's own controls, which also switch the
colour: icon buttons in the page's top-right corner on a pointer
device, the floating button on a phone — and the choice is device-local; answers are cached per
session, and a source that fails (a rate limit, a network blip) is
retried after a pause rather than remembered as empty. The whole map is
asked in a handful of batched requests, not one per dot: a reference
database or your own games answer every charted position at once, and
the Lichess source answers whatever the server's explorer cache already
holds the same way — so only positions it has never seen (or not seen
within a day) cost a request each, and a map you have visited before
colours in about one round trip. Those one-at-a-time requests are taken
in the order the picture needs them rather than top to bottom: select a
dot and the line lit down from it is asked for first, an edge a round
trip, while the rest of the map colours in behind it.

## Games that left the book

The map asks the games index where each of your recent games of its
colour first stepped off prepared ground — the charted nodes plus
everything the linked studies hold — and delivers the answer to the
node it happened at: the selected node's panel lists the games that
left *here*, each with the move that did it and who played it. A reply
*they* keep playing is a gap to prepare; a move *you* played past your
own book is a line to extend — and either way the move charts in one
tap, right where the evidence for it stands, with each game openable
on the analysis board at the exact deviation.

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
sidelines.

The accent colour is spent on the mainline and nothing else, and the
mainline answers what you are looking at. Select a dot and the line the
field walks on from there — its most-played continuation, all the way
down — lights up in the accent, thicker as well as brighter, while its
own lineage back to the root answers in bright foreground: where you
came from, and where the crowd goes next. (Highlighting every node's
most-played child sounds like the same idea and is not: an only child
is trivially the most played, so on a 63-node map that rule lit 54 of
63 edges and the emphasis read as noise.)

Search, and every hit gets that same treatment at once, each line in
its own colour, so "which defences do I actually face and where do they
go" is one query rather than five. A colour belongs to a *line*, not to
a hit: searching "Ruy" over six Ruy variations matches 18 nodes,
because the catalogue says "Ruy Lopez" on nearly every square of that
subtree, and all but eight of those stand on another hit's line and
draw nothing of their own. Past twelve lines the wheel stops telling
colours apart and they all fall back to the accent; the fading is doing
the work by then. Focus on nothing and the map is calm — no selection,
no search, no accent, just the neutral constellation.

The page holds the canvas behind a brief spinner until its colours are
known — coverage, names and the field all answered — then shows the
finished picture at once, so the overture plays in colour rather than
the map colouring in patches as answers land; a source too slow to wait
for (the online database warming its cache, a dead link) falls back to
colouring in place after a moment.

The layout is a deterministic force relaxation, so the same map always
settles into the same shape and an edit nudges the picture instead of
reshuffling it — and the page load opens with an overture: the dots
scatter at random and tumble into place, chaos first, order last. The
journey is different on every load; the destination never is, because
the map's shape is a thing people remember. And once settled, the dots
keep breathing — a slow, few-pixel wander around their homes, threads
following — so the constellation floats instead of freezing. (All of
it skipped when the OS asks for reduced motion.)

Wheel zooms to the cursor, dragging the ground pans, two fingers pinch
— from anywhere, including from two dots, because on a dense map there
is barely any bare canvas to find and "don't touch the dots" is not an
instruction anybody can follow. Pressing a dot selects it and pressing
it again lets it go, and dragging a dot pulls the web — mouse or touch.
The held dot follows the finger, its neighbours follow their springs,
crowding pushes back, and the whole thing coasts to a stop after the
release instead of freezing mid-swing. Where you leave things is where
they stay, for the session; the stored layout stays deterministic
either way. (Reduced motion gets the plain version: the held dot moves
and nothing else.)

Labels keep their screen size and fade out as the view pulls back — far
out you read the shape, close in you read the names. The search field
in the top-right corner fades the map back to just its hits — matching
a move, a name you gave a node, or the catalogue's name for its
position — and a hit keeps its label whatever the zoom, so the answer
is *where these sit in the constellation* rather than a list that takes
you to one and loses the map.

Covered nodes are filled, plans are hollow and dashed, and the badges
(field gaps, drill health, the depth arc) ride on the dots. Beneath it
all, each node wears a faint halo tinted by its opening family — the
family of its nearest catalogue-named ancestor, so the catalogue, not
configuration, says where the Ruy ends and the Italian begins. The
colour is hierarchical the way the names are: the family sets the hue,
the second tier shifts it within a band — every Sicilian stays visibly
kin while the Najdorf, the Sveshnikov and the Kan glow as sub-nebulae
of their own, sidelines keeping their second tier's exact shade. The
layout keeps subtrees together, so same-family halos merge into soft
regions; hues are hashed from the names and stable forever, and
because the halos live behind everything, none of the marks above
give up their meaning.

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
