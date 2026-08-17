# The prepared databases

*English · [한국어](databases.ko.md)*

Two of the app's features read databases that are **built once**, rather
than growing with your vault the way everything else does:

| File | What reads it | Size | Built by |
| --- | --- | --- | --- |
| `data/puzzles.sqlite` | the puzzle trainer | ~2.6 GB | the app, on the Puzzles page |
| `data/refgames/*.sqlite` | the elite-games browser, the local explorer, the repertoire trainer and the opening map | ~160 MB per month indexed | the app, on the Databases page (or `npm run build:refgames`); the desktop installer seeds a 25 MB starter set |

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

Almost never. A deploy keeps their indexes, count tables and per-move
sums current (`scripts/deploy.sh` runs `tune-dbs.ts`), and the files
themselves do not change on their own.

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

**More reference games.** They are plural:
`data/refgames/<name>.sqlite`, each an independent database, listed and
switched in the elite browser. The Databases page uploads PGN collections
(the same `vault/sources/` uploads), indexes any selection of them under a
name, and deletes either kind — the built database or the upload it was
built from. So unlike puzzles there is no
replace-wrinkle here: build the same name again to replace it, or a new
name beside it. The same indexer runs from a terminal:

```
npm run build:refgames                    # every PGN in vault/sources/
npm run build:refgames -- elite-2025-11.pgn --name elite
```

A machine still carrying the single-file era's `data/refgames.sqlite`
migrates on the server's next start: the file is renamed into the
directory, named after its source when the meta records one.

## How reference games stopped needing the shell

The standing rule is that every user action must be possible in the app.
This page used to argue that these two databases were a considered
exception — big public archives, minutes of CPU, part of standing a server
up like installing the engine binaries.

That argument only ever held for a server. The desktop app has no
repository, no npm and no shell, and on Windows and macOS no `zstd`
either, so for the people the app is actually installed by, "run the
script" was not an exception to the rule: it was the puzzle trainer being
unavailable. The puzzle build became a server-side job, offered by the
page that needs it.

`refgames.sqlite` followed, and its input being different in kind — not
one public dump, but whatever PGN collections you happen to have — is
what dictated the shape of the fix: uploading collections already worked
(the pattern every database build here uses), so the build offer
indexes those same uploads rather than inventing a second way to get
files in.

The desktop installer softens the empty start besides: it carries a
starter set — the strongest games of every ECO code from one Lichess
Elite month, ~39 k games in 25 MB, built by `build-bundled-refgames.ts`
at release time — seeded into `data/refgames/` on first run, the same
way the bundled starter is. It is an ordinary database from then
on, one name among however many are built beside it, and deleting it
works like deleting any other. A server install gets no seed; it takes
the commit, not the release artefacts.

## The manager

Managing lives on the **Databases page** and nowhere else. The elite
browser and the explorer each have a database icon; both navigate here.
They used to open the manager in a window of their own, which put uploads
and deletes one press from a search or a position you were in the middle
of — managing is a place you go, not a layer over what you were doing.

The page does not scroll. One panel takes the height that is left, and
inside it:

- a **segmented control** between Databases and PGN collections, with the
  count on each. They are the same shelf at two stages, and showing both
  at once meant two columns growing independently: at 18 databases beside
  24 collections the page ran to 1202px with Build 1074px down it. One
  list at a time is as tall as one list, and it scrolls itself.
- a **search** that narrows whichever list is showing.
- an **upload** icon, opening a window that is one large drop target.
- a **Build bar** that appears with the first ticked collection, naming
  its own count, pinned to the panel's bottom edge so it stays in view
  however long the list is. It opens a window that takes the new
  database's name.

Uploading and naming were permanent furniture below the list they applied
to, which is what pushed everything else down. Both are momentary — a
file chooser and a text field — so both are windows now.

Ticks are counted over every collection, not the filtered view: a search
that hides three of five ticked files must not make Build say two.
Starting a build clears the search and switches to Databases, or the
thing just built would be hidden behind the query used to pick its
sources.

## Deleting

Both deletes ask first through `ConfirmSheet` — a centred window on a
desktop, a bottom sheet on a phone. Nothing keeps a copy:
there is no trash directory behind either route, so the question is the
only thing in the way. Each question says what is *not* affected, because
that is the part that gets guessed at — deleting a database keeps the
collections it was built from, and deleting a collection leaves every
database already built from it alone.

A deleted collection loses its build tick with it, so the next build
cannot name a file that is no longer there. A refused delete keeps both,
and says why.

The server refuses a collection delete outright while a build is running
(409): the indexer was handed those paths and is still reading them. The
app disables the trigger for the same reason, but the server is the one
that decides — a second client cannot be relied on to.
