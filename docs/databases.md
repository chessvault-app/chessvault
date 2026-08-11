# The prepared databases

*English · [한국어](databases.ko.md)*

Two of the app's features read databases that are **built once and copied
to the server**, rather than being produced by anything the app does:

| File | What reads it | Size |
| --- | --- | --- |
| `data/puzzles.sqlite` | the puzzle trainer | ~2.5 GB |
| `data/refgames.sqlite` | the elite-games browser in Games | ~160 MB per month indexed |

Everything else — books, studies, notes, imported puzzle books — is made
inside the app. These two are the exception, and deliberately: their
inputs are multi-hundred-megabyte public dumps that nobody wants to upload
through a browser, and the build is a one-off that pins a snapshot rather
than something a user does.

## When you need to do anything

Almost never. A deploy keeps their indexes and count tables current
(`scripts/deploy.sh` runs `tune-dbs.ts`), and the files themselves do not
change on their own.

There are exactly two reasons to rebuild:

**A newer puzzle set.** Lichess publishes an updated dump periodically. To
take it:

```
# 1. download the dump (CC0, ~304 MB, ~3.1 M puzzles)
curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
mv lichess_db_puzzle.csv.zst data/
# 2. build (writes to a temp file, then renames — a running server keeps
#    serving the old database until it finishes)
npm run build:puzzles
# 3. copy the result to the server's data directory and restart
```

Attempt history lives in the vault and is keyed by puzzle id, so it
survives a rebuild.

**More reference games.** Drop PGN files into `vault/sources/` and:

```
npm run build:refgames                    # every PGN in vault/sources/
npm run build:refgames -- elite-2025-11.pgn
```

## Why they are not built in the app

The standing rule is that every user action must be possible in the app,
and this is the one place that does not hold. It is a considered
exception rather than an oversight: the inputs are public archives
measured in hundreds of megabytes, the build is CPU-bound for minutes, and
the result is a snapshot shared by every user of a deployment rather than
anybody's own data. Treat it as part of standing a server up, like
installing the engine binaries.

If that ever stops being true — a small enough dump, or a server-side job
worth exposing — the honest fix is a build job in the app, not a script
somebody has to know about.
