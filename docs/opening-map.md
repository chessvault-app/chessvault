# The opening map

*English · [한국어](opening-map.ko.md)*

The Opening map (under Tools) shows your opening preparation as a tree:
one map for White, one for Black. You place the moves that define your
repertoire — the root's children are your first moves, each node's
children the replies you intend to meet — and tag your studies and
notes onto the nodes. Everything below a node that a tagged study
actually covers is **derived live from the study**, never stored, so
the map cannot drift from the preparation it describes.

## What a node is

A node is a move, identified by its move path from the starting
position. It can carry:

- **Tags** — any number of studies (optionally scoped to one chapter,
  which also covers its sub-chapters) and notes. Studies feed the
  derived coverage; notes are references for the reader and never do.
- A **name** — set by hand, or taken from the opening catalogue when
  the node's own position has a named row (the same ~3,800-line
  catalogue the explorer uses, matched by position, so transpositions
  name themselves correctly).
- An **intended depth** in full moves — what you mean to prepare, kept
  for the planned target-versus-actual comparison.
- A free-text **note**.

A node with no study tags is a *plan* — drawn dashed — which is how the
map shows the difference between "I intend to meet 1...c6" and "I have
something prepared against it".

## Coverage

All of a map's study tags are pooled into one position index, matched
by position (FEN without the move counters). That one decision buys
three things: several studies tagged on one node merge into a union, a
study can never claim a branch its tree does not contain (tag it
anywhere — matching is positional), and a line reached by transposition
counts once. Each covered node shows how deep the union runs and how
many distinct lines it holds, and the panel offers continuations the
studies prepare that the map does not chart yet — one tap adds them.

## Following a node out

- **Open a tagged study** — it opens *on the node's position*, in the
  first chapter the tag's scope holds it in, not at the top of the
  file.
- **Analyse** — hands the map's own tree to the analysis board, cursor
  on the node, facing the map's colour.
- **Drill** — hands the whole map to the repertoire trainer: every
  scoped chapter of every tagged study becomes one drill scope,
  starting from the node (see [the repertoire trainer](repertoire.md)).
  Attempts are recorded under the real study and chapter each position
  belongs to, so per-study summaries stay truthful.

## What is stored

One file, `vault/repertoire/map.json` — beside the drill history,
because they are two views of the same subject. Only the skeleton is in
it: moves, ids, tags, names, depths, notes. Positions and coverage are
derived at load by replaying the moves. Renaming or moving a tagged
study (or a whole collection) follows through to the tags, the same way
bookmarks follow; deleting one deliberately does **not** remove its
tags — a tag whose study vanished means "this line lost its prep", and
the panel shows it as a broken reference until you re-point or remove
it.
