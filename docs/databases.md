# The prepared databases

*English · [한국어](databases.ko.md)*

Two of the app's features read databases that are **built once**, rather
than growing with your vault the way everything else does:

| File | What reads it | Size | Built by |
| --- | --- | --- | --- |
| `data/puzzles.sqlite` | the puzzle trainer | ~2.6 GB | the app, on the Puzzles page |
| `data/refgames.sqlite` | the elite-games browser in Games | ~160 MB per month indexed | `npm run build:refgames`; the desktop installer seeds a 25 MB starter set |

Everything else — books, studies, notes, imported puzzle books — is made
inside the app, and `data/mygames.sqlite` is not even that: the explorer's
My games index builds and maintains itself from the vault's PGN files, so
there is no step for it at all.

**The puzzle database is no longer one of the exceptions.** Open Puzzles
without one and the app offers to fetch it: the server downloads the CC0
Lichess dump and builds the database in a child process, reporting
progress the page draws as a bar. Measured here: 304 MB down, then 115 s
to write 6,100,960 puzzles and index them. The job survives leaving the
page, and the trainer picks the new file up with no restart.

## When you need to do anything

Almost never. A deploy keeps their indexes and count tables current
(`scripts/deploy.sh` runs `tune-dbs.ts`), and the files themselves do not
change on their own.

There are exactly two reasons to rebuild:

**A newer puzzle set.** Lichess publishes an updated dump periodically.
`npm run build:puzzles` takes it: the dump is downloaded if it is not
already in `data/`, and the database is written to a temp file and renamed,
so a running server keeps serving the old one until it finishes. A dump the
script downloaded itself is deleted afterwards; one you put there is left
alone.

There is no button for this yet — the app's build offer appears only when
there is no database at all, so replacing a working one still means the
command (or deleting the file first). That is a missing UI, not a
deliberate limit.

Attempt history lives in the vault and is keyed by puzzle id, so it
survives a rebuild.

**More reference games.** Drop PGN files into `vault/sources/` and:

```
npm run build:refgames                    # every PGN in vault/sources/
npm run build:refgames -- elite-2025-11.pgn
```

## Why reference games still need the shell

The standing rule is that every user action must be possible in the app.
This page used to argue that these two databases were a considered
exception — big public archives, minutes of CPU, part of standing a server
up like installing the engine binaries.

That argument only ever held for a server. The desktop app has no
repository, no npm and no shell, and on Windows and macOS no `zstd`
either, so for the people the app is actually installed by, "run the
script" was not an exception to the rule: it was the puzzle trainer being
unavailable. The build is a server-side job now, offered by the page that
needs it.

What is left is `refgames.sqlite`, and its input is different in kind:
not one public dump, but whatever PGN collections you happen to have.
Uploading those already works — it is how opening books are built — so
the honest fix here is to point the reference-game index at the same
uploads, not to invent a second way to get files in.

Until then, the desktop installer takes the edge off: it carries a
starter set — the strongest games of every ECO code from one Lichess
Elite month, ~39 k games in 25 MB, built by `build-bundled-refgames.ts`
at release time — seeded to `data/refgames.sqlite` on first run, the same
way the bundled opening book is. It is an ordinary database from then on:
`build:refgames` replaces it, and deleting it is final. A server install
gets no seed; it takes the commit, not the release artefacts.
