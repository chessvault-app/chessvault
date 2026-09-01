# Deferred work

*English · [한국어](deferred.ko.md)*

What was considered and deliberately not built, with the trigger that
would make each piece worth building. The update log records what
shipped; this records what did not, so the reasoning survives instead of
being re-derived — or worse, re-litigated — every time someone rereads
the code. Like every doc, it gets a staleness pass before each release:
a trigger that has since fired should move its item out of here and into
the work.

## Waiting on a trigger

**Absorbing the Databases manager into the games-page browser.** One
surface for browsing and managing instead of two. Deliberately deferred:
the current split is an argued position — managing is a place you go,
not a layer over what you were doing (see "The manager" in
[databases.md](databases.md)) — so collapsing it is a UX decision to
make on purpose, not a cleanup to fold into other work.

**Editing a collection game inside the workspace.** The workspace's
games band shows the whole browser, Collection included (the
GamesBrowser extraction); a click previews any game on the board, and
opening one goes to its document page. What stays deliberately out is
editing the document IN the workspace: the band loads rows onto the
board freely only because the board is throwaway, and a board that can
hold unsaved annotations puts a leave-guard question under every row
click. If previewing-then-jumping ever grates, the document's chrome
(title, history, Done, Saved) would arrive as a mode of the moves
panel's header — the title slot is already the panel's identity, and
the analysis-only verbs retreat into the ⋯ menu the way MovesOverflow
already absorbs actions — not as a new bar.

**Several independent boards in the workspace.** The workspace is
deliberately one analysis context shown many ways: every pane reads
the one global analysis store, which is also what makes a game follow
you between the Board page and the workspace. True multi-context —
tabs of independent boards, each with its own tree — needs the store
to become a factory behind a React context whose default is the
current global instance (so every existing page is untouched), with
the engine worker following whichever context has focus. A
well-bounded refactor, deferred until one-context-many-panes proves
insufficient in practice; it may never need to.

**A prebuilt native binary for servers.** Shipping it to the *desktop*
is done (0.5.0: each platform's packaging job builds the crate on its
own runner and `build-server.mjs` drops it beside the bundled JS
children). A server *compiles* its own instead: `deploy.sh` runs
`cargo build --release` on every deploy when it finds a toolchain, so
the binary can never drift from the commit it sits beside — and skips
it silently when it does not, leaving the JavaScript jobs in charge.

What is still deferred is removing the toolchain requirement, by
publishing per-platform binaries as release assets and fetching the one
matching the version, the way the engine is fetched at setup. The
Linux packaging job already produces exactly that artefact, so it is
mostly plumbing. It buys little while `deploy.sh` targets machines
their operators already control and where installing rustup is a
one-off (measured: a 2 GB Lightsail box builds the whole crate
graph — peak well under its RAM, with swap never touched). Worth doing
if toolchain-free servers become a real case.

## Kept for a real use case

From the Games-menu research (SCID vs PC, ChessBase, En Croissant,
Lichess) and the search-capability survey (ChessBase 17/18, Scid vs PC,
ChessTempo, Lichess, chess.com): features every serious database tool
grows eventually, kept off until a use case actually asks for them —

- **Opponent dossiers / player reports** — once OTB or league play
  makes preparing against a named person a recurring need.
- **Theory tables and opening reports** — generated documents in the
  SCID tradition; worthwhile if reading a printed line ever beats
  reading the map and the explorer.
- **Cross-database dedup and merge tooling** — when overlapping corpora
  are a practice rather than an accident (Optimize already sweeps
  duplicates within one database).
- **Multi-database federated search** — one query across every
  database at once; wanted only if keeping many small databases becomes
  the norm.
- **Saved named filters** — SCID's best structural idea; earns its keep
  when lists and reports multiply enough that re-tapping filter chips
  grates.
- **Novelty detection** ("first played in…") — needs a big canonical
  corpus to mean anything.
- **Canned motif filters** — a few curated pattern searches (isolated
  queen's pawn, opposite-side castling), never a CQL-style query
  language.
- **Move-sequence / manoeuvre search** — Scid's `Rh8 ? R1h7`, ChessBase's
  wildcard manoeuvre patterns. The most complex search gap left, for a
  niche ask; a specific manoeuvre (Greek gift, rook lift) ships as a
  canned motif first, and the general syntax waits until someone asks
  for a manoeuvre no motif covers.
- **Fragment-position search boards** — ChessBase's partial-position
  boards with OR, exclude and mirroring. Kept off in favour of fixed
  relaxation levels on the deep scan (exact / pawns / pawns per file /
  material — Scid's ladder), which answer most of the same questions at
  a fraction of the UI; revisit only when the ladder plus motifs fail a
  question someone actually asked.
- **Tablebase-graded endgame review** — the engine review judging
  endgame moves against the table rather than against Stockfish's
  eval. This is the half of the old "tablebase support" entry that has
  not fired: the verdicts themselves shipped (the explorer probes any
  position of seven pieces or fewer through the server, which caches
  every answer for good — `server/tablebase.ts`), which settles the
  drawn-or-won question that entry's second trigger named. Grading play
  against perfection is a different job: a probe for every position of
  a walked mainline, and a mistake rule that is not the eval-swing one
  — under a tablebase a move is a blunder when it changes the RESULT,
  by any distance. Worth building when reviewing an ending against the
  engine's numbers is what stops being good enough.
- **Probing `.rtbz` files in process** — reading the tables directly
  rather than over HTTP. Note what this is NOT waiting for any more:
  answering from your own tables is supported, because lila-tablebase
  is open source and Settings takes its address (`tablebaseUrl`), so
  anybody with the files can already keep every lookup on their own
  machine. What is left is doing it without a second process — one
  fewer thing to run and to keep running, at the cost of a Syzygy
  reader in this codebase and the tables in a place the app owns
  (a gigabyte for five pieces, far more past that: a downloader,
  somewhere to put them, and a check that what arrived is what was
  asked for). Worth doing only when running one small server beside
  the app is the thing people will not do.
- **Multi-engine support** — installing and switching between engines
  beyond the bundled one; worth adding when someone actually wants a
  second opinion, or needs an engine the app does not ship.
- **Server-side engine computation** — running the engine on the
  server instead of in the client; worth adding when a client too weak
  to run it well (a phone) needs real analysis, or when a long
  analysis job should outlive the tab that asked for it. One engine
  serving requests, not the analysis farm rejected below.
- **Similarity and strategic-theme search** — ChessBase's similar
  endgames/structures/moves and CB18's theme search. Like novelty
  detection they only mean anything over a big canonical corpus, and
  the theme search needs engine-adjacent analysis infrastructure
  besides.

## Not planned

Considered and rejected as wrong-scale infrastructure for this app,
recorded so nobody re-derives the rejection: curated opening key trees
(a permanent editorial burden), geography and cohort vanity statistics,
engine analysis farms, memory-mapped sidecar formats or a storage-engine
swap, worker pools on the request path, and extending the position index
past ply 30 — the precomputed sums answer the shallow question and the
deep scan answers the rest, each cheaper than one index trying to do
both. The fast-search worker (`server/scanWorker.ts`) is not the
rejected pool: it is one long-lived thread owning one opted-in
database's packed index, a resident data structure with a thread
around it — requests queue into it, it does not scale with them.
