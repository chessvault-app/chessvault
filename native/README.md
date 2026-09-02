# The native core

`chessvault-core` — a Rust binary that does the four heavy
reference-database jobs, and is **optional by construction**. Everything
here has a JavaScript twin under `scripts/` and `server/`; if this crate
is never built, the app runs those instead and behaves identically, only
slower.

There is a fifth command, and it breaks two of those sentences on
purpose. `chessvault-core tablebase --tables <dir>` reads Syzygy endgame
files and answers positions from them; it has no JavaScript twin (the
app asks a tablebase server instead when this is not available), and it
does not start, work and exit like a job — it STAYS, holding its tables
memory-mapped and answering questions on stdin until the server is done
with it. Probing wants a warm mapping: a process per lookup would spend
tens of milliseconds starting up to read a few hundred bytes. So its
shape is `server/scanWorker.ts`'s — one owner of one structure, with
requests queued into it — not this binary's spawn-per-job shape, and
`server/tablebaseNative.ts` is the half that owns its lifetime.

```bash
npm run build:native      # cargo build --release, from the repo root
npm run test:native       # the parity fixtures below
```

You need a Rust toolchain — [rustup.rs](https://rustup.rs) — and nothing
else; `cargo` fetches the rest. Once built, the server finds the binary
by itself: the lookup happens per job, so a build finished while the
server is running is picked up by the next one, with no restart.

Measured on a 280,059-game Lichess Elite month:

| Job | JavaScript | Native |
| --- | --- | --- |
| Build a database from PGN | ~180 s | 71.8 s |
| Search every game for a position | 12.7 s | 1.3 s |
| Peak memory | 458 MB | 105 MB |

## The one rule: the two implementations must agree

Not "should" — a disagreement is silent wrong answers, not a crash. Both
sides compute Zobrist keys for the same positions, and a key that differs
by one bit means the explorer quietly answers about a position nobody
asked for. Nothing surfaces that; there is no error to see.

So the crate is pinned to the JavaScript pipeline's own output:

- `tests/goldens.json` holds keys, per-game codes and full replay rows
  **exported from the JS side**, and `npm run test:native` fails if this
  crate answers anything else.
- `tests/parity.pgn` and `parity-extra.pgn` are corpora for whole-file
  diffing: build them with both pipelines and every table must match row
  for row, fresh and appended.
- The same fixture carries the TS side's own SQL — every string
  `src/sql.rs` mirrors by hand — and the literals both sides keep (the
  pack and key-index versions and meta keys, the deep-search cap), and
  `tests/goldens.rs` holds each Rust constant to its source, whitespace
  aside. A diff of the data tables cannot see an index or a lookup
  table that one side lacks, which is how `sql.rs` sat two commits
  behind `scripts/lib/db-tuning.ts`; this check exists for exactly
  that shape.
- `npm run fuzz:parity` compares the two live implementations on a
  seeded random corpus — tables, schema, and deep hunts three ways —
  with no fixture in between, so it cannot be blessed by regenerating.

All of it runs in CI: the `native` job of `.github/workflows/verify.yml`
builds the crate, runs the fixtures and fuzzes two seeds on every push
and pull request, one seed fixed so a failure reproduces anywhere and
one that moves with the run.

**If you change anything either side computes** — the hash scheme, the
schema, `finalMen`, the result or level codes, the replay loop's stopping
rules — regenerate the fixtures and re-run the diff:

```bash
npm run build:native-goldens   # re-export from the JS implementation
npm run test:native
```

Regenerating without re-running the diff proves nothing: the fixtures
would simply record the new behaviour on both sides. `shared/zobrist.ts`
says it in its own header — the key scheme is deliberately not Polyglot
and must never be migrated, because a book or index built by any earlier
version has to stay readable.

`CHESS_NATIVE=0` makes the server ignore the binary and spawn the
JavaScript children. That is how the two are compared on the same
machine and the same data.

The tablebase command has no JS twin to be pinned to, so it is pinned to
the reference implementation instead — the same rule, a different
yardstick. Note what is actually being checked: `shakmaty-syzygy` does
the decoding, and lila-tablebase is built on the same crate, so the part
that is ours is the wrapper — the piece-count gate, the walk over legal
moves, and reporting each from the right side of the board:

```bash
npm run check:tablebase -- --tables <dir> --positions 200
```

It walks random legal endgames, asks this binary and
tablebase.lichess.ovh about each, and compares the verdict for the
position and for every legal move. The failure it exists to catch is the
same one: not a crash, but a confident wrong answer — an inverted point
of view would report every winning move as losing and say nothing. 120
positions agreed when the command was written.

It cannot catch a bug in the decoder, since both sides share it and
would be wrong together. That trust is the crate's, and is the trade
taken when it was chosen over writing a Syzygy reader here.

## Deep search answers WHICH games, not what a frame looks like

`deep-search` writes `{"type":"hit","id":…,"ply":…}` lines, plus
`progress` and `done`. The server composes the game frame the client
sees from its own header row, with the same lines its other three scan
paths use, so the frame's shape exists in one place. And before it
streams a hit it replays that one game through its reference scanner
and streams what THAT says: a hit the two disagree on is logged and
overruled, never shown. That is the runtime tether the replay pair
lacked — a confident wrong hit becomes a log line naming the game and
both plies, at the cost of at most 200 replays per request, each a
fraction of a millisecond beside a scan measured in seconds. What it
cannot see is a game this binary MISSED; `npm run fuzz:parity` compares
whole answers for that. The `capabilities` line declares the contract
as `"deep":"hits"`, and a build that declares no `deep`, or another
one, is not spawned for deep search at all — it streamed whole game
frames the server no longer composes from.

## Filters are negotiated, not assumed

The deep-search request keys are the one place the two sides are
allowed to differ — by declaration, never silently. `chessvault-core
capabilities` prints what this build understands (one JSON line,
`{"filters":[...],"scan":[...],"deep":"hits"}`): the `games_where`
filter keys, the scan modes — `match` (the relaxation rung) and
`material` (the material-spec hunt), both in `src/scan_match.rs` — and
the deep-search output contract above. The server asks once
per build of the binary (cached by path and mtime, so a rebuild is
re-asked). A request using any key the binary did not declare runs on
the server's JS scan instead — slower, never wrong — which is how the
TypeScript side ships a new filter or scan mode before this crate
learns it. A binary that cannot answer `capabilities` at all is not
used for deep search, full stop: too old to negotiate must not mean
trusted anyway.

Both sides pin the declaration to the code rather than to memory: a test
here records which keys `games_where` actually consults and fails if
`SUPPORTED_FILTERS` says anything else, and `server/refgames.test.ts`
does the same for `gamesWhere` against `GAMES_WHERE_KEYS`.

## What ships, and what does not

The desktop installer carries a binary built for its own platform: each
packaging job in `.github/workflows/desktop.yml` runs `cargo build` on
its own runner (no cross-compilation — an installer carries one
architecture anyway, and cargo's host target is that same one), and
`desktop/build-server.mjs` copies the result next to the bundled `.mjs`
children, which is the first place the server looks.

A server compiles its own: `scripts/deploy.sh` runs the build on every
deploy when it finds a toolchain. That is correctness, not tidiness —
`target/` is gitignored, so `git reset --hard` leaves an old binary in
place, and a binary from an older commit answering beside newer
JavaScript is exactly the failure the fixtures above exist to prevent. A
build that fails deletes the stale binary rather than keeping it.

The crate's 55 dependencies are conveyed with the installer, so their
notices are too — generated from `Cargo.lock` into
`licenses/rust-crates.txt` by `scripts/collect-crate-licenses.ts`, and
`npm run check:repo` fails if the two disagree. No npm dependency walk
can see a cargo dependency, which is the whole reason that check exists.

## Layout

```
src/zobrist.rs   the hash scheme, ported from shared/zobrist.ts
src/index.rs     per-game codes and the replay loop (server/refgamesIndex.ts)
src/build.rs     PGN → database (scripts/build-refgames.ts)
src/deep.rs      search every game for a position (the /deep-search route)
src/optimize.rs  the housekeeping pass (scripts/optimize-refgames.ts)
src/filters.rs   the reference filters as SQL (gamesWhere in server/refgames.ts)
src/scan_match.rs  the relaxation ladder and material search (shared/scanMatch.ts)
src/scan_pack.rs   the packed scan-index blob (shared/scanPack.ts)
src/key_index.rs   the inverted key index exact search answers from (shared/keyIndex.ts)
src/sql.rs       SQL mirrored from the TS side, each constant naming its source
src/phases.rs    the index pass's progress phases and lines (server/refgamesIndex.ts)
src/tablebase.rs Syzygy probing (no TS mirror — server/tablebaseNative.ts owns it)
```

Every file that mirrors something names it. Keep that pairing — it is
what makes a disagreement findable — and add the row when a file is
added, or this list becomes a claim about coverage that is not true.
(`lib.rs`, `main.rs` and `util.rs` are the crate's own plumbing and
mirror nothing.)
