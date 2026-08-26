# The native core

`chessvault-core` — a Rust binary that does the four heavy
reference-database jobs, and is **optional by construction**. Everything
here has a JavaScript twin under `scripts/` and `server/`; if this crate
is never built, the app runs those instead and behaves identically, only
slower.

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

The crate's 47 dependencies are conveyed with the installer, so their
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
src/sql.rs       SQL mirrored from the TS side, each constant naming its source
```

Every file names the JavaScript it mirrors. Keep that pairing: it is
what makes a disagreement findable.
