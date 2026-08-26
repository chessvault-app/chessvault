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

**Union-seek for the search's no-match worst case.** The Databases
browser's search box seeks through the small `players`/`openings` lookup
tables, so a query that matches something answers in microseconds
regardless of database size. A query that matches *nothing* still walks
the whole probe — the one linear scan left on the request path, measured
at ~124 ms per 280k games and scaling to roughly 1.3 s at 3M. The fix is
known: resolve the matching player names first (LIMIT ~200) and drive
the games probes through an indexed UNION when the set is small, falling
back to the walk otherwise. Worth doing when databases get big enough
that an empty search visibly lags; below that it is complexity spent on
a fast path nobody waits on.

**Virtualized game lists.** Every game list renders one `<li>` per
loaded game and keeps it: the archive caps at 1,000 rows, the collection
is only kept games, but the Databases browser's 50-row pages accumulate
— scroll far enough and thousands of rows are live in the DOM.
`GameListShell` owns the single list band, so a windowed renderer
(render only the visible rows plus overscan inside a height spacer)
would be a one-slot swap inherited by all three lists at once — that is
what the shell bought. It still is not free: the zebra stripe is
`nth-child` CSS and would have to move to per-row parity, the
infinite-scroll sentinel would be replaced by fetching from the
virtualizer's visible range, and browser find-in-page only sees rendered
rows. Worth doing when the archive's row cap starts to pinch, deep
scrolling through big databases becomes a habit, or list scrolling janks
on a phone; until then the caps contain the problem.

**Absorbing the Databases manager into the games-page browser.** One
surface for browsing and managing instead of two. Deliberately deferred:
the current split is an argued position — managing is a place you go,
not a layer over what you were doing (see "The manager" in
[databases.md](databases.md)) — so collapsing it is a UX decision to
make on purpose, not a cleanup to fold into other work.

**Shipping the native pipeline binary.** `native/` builds
`chessvault-core`, and a server that finds the binary uses it for
builds, indexing, optimizing and the deep scan (the update log has the
measured speedups). Nothing ships it yet: distribution means
per-platform CI builds attached to releases through the same channel the
engine binaries use, a fetch-or-bundle step, and the licence inventory
for the crate set — shakmaty is GPL-3.0, compatible with the app's
licence but exactly the kind of compiled-in dependency the npm walk
never sees. Until then the fast path is one `cargo build --release`
away for anyone with a Rust toolchain, and everything works without it.

## Kept for a real use case

From the Games-menu research (SCID vs PC, ChessBase, En Croissant,
Lichess): features every serious database tool grows eventually, kept
off until a use case actually asks for them —

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

## Not planned

Considered and rejected as wrong-scale infrastructure for this app,
recorded so nobody re-derives the rejection: curated opening key trees
(a permanent editorial burden), geography and cohort vanity statistics,
engine analysis farms, memory-mapped sidecar formats or a storage-engine
swap, worker pools on the request path, and extending the position index
past ply 30 — the precomputed sums answer the shallow question and the
deep scan answers the rest, each cheaper than one index trying to do
both.
