# Working on this repo

Standing rules. They are not style preferences — each one exists because
ignoring it produced something that had to be undone.

## What belongs in the repo

**Nothing personal.** No absolute paths, no hostnames, no keys, no one
person's deployment or operations flow. A config names a *file*, not where
that file sits on somebody's disk (`CHESS_BOOK_PDFS` points at the folder).
Deployment targets live in `scripts/deploy.env`, which is gitignored.
Before publishing, grep every tracked file for absolute paths, hosts,
addresses and tokens.

**Everything committed is useful to anyone running the app.** A script that
only makes sense for one machine, one server or one person's habits does
not go in — it gets run ad hoc instead.

**The vault is user data and is never committed** (`vault/*` is ignored):
games, notes, studies, imported books, and `config.json`, which holds
tokens. Book content extracted from commercial PDFs must not be
redistributed.

## Where behaviour belongs

**Every user action must be possible in the app.** Nothing may require a
shell, a script or file access. A missing UI for something a user needs to
do is a bug, not a documentation gap.

**The app is HTTP-API-only.** The desktop shell and any phone client are
clients of the same API; no behaviour may assume local disk.

**Import belongs in the app.** The offline pipeline under `scripts/ml/` is
a backup path, not the primary one. Anything built there should be shared
code the browser can run (`shared/`, `web/src/puzzles/ocr/`), so the two
never drift. Growing the offline pipeline instead of the app is going the
wrong way.

## Book imports

**Every book-specific fact is data, never code.** Page ranges, notation
styles, label geometry, a scan's own character confusions — all of it lives
in `scripts/ml/books/*.json`. There are no per-book scripts, and a book
that fits no existing style must not need a code change: supply a pattern.

**A book's notation is worked out, not configured.** The importer searches
the candidates and keeps whichever validates the most printed solutions.
Users upload a PDF; they never specify a config.

**Every book puzzle carries evidence** — the page it was printed on, where
on that page it sits, and the page its answer is on. This applies to
verified puzzles exactly as much as to drafts.

**Import everything that was read.** A puzzle whose solution could not be
parsed still becomes a draft with its evidence attached; a low yield is
reported, not a reason to withhold. Re-importing an existing book offers
both updating in place (progress survives, ids are `n<number>`) and
clearing and rebuilding.

**Nothing is imported on trust.** A position, a side to move and a solution
are accepted together only when replaying that solution in that position is
legal. What fails degrades to a lower tier or a draft; it is never guessed
at.

## How to work

**Measure, do not assert.** A refactor that should change nothing is proved
by diffing the output before and after. A claimed improvement is quoted
with the number that was measured, and a number that has not been checked
is labelled as such.

**Commit each verified change on its own**, with a message saying why it
was needed and what it cost, not just what changed. Behaviour-neutral
refactors and behaviour changes go in separate commits so the neutral one
stays provable.

**UI text is sentence case**, and nothing user-facing exposes a rating.
Difficulty is a word — see `web/src/puzzles/bands.ts`. A rating is how the
trainer picks a puzzle, not a verdict to hand back to whoever solved it.

## Before cutting a release

Both of these, every time, before the version is bumped:

**Audit the repo against this file.** Grep every tracked file for absolute
paths, hostnames, addresses and tokens. Check that nothing new is
per-book code, one-machine tooling, or a user action that needs a shell.
Check no UI has started showing a rating. The point is to catch drift
while it is one line, not at the moment of publishing.

**Read the docs and fix what has gone stale.** `README.md`, everything in
`docs/`, `scripts/ml/README.md`, `desktop/README.md`. Docs rot silently —
a number that was true, a file that has been renamed, a limitation that
has been fixed — and a wrong doc is worse than a missing one because it
is believed. Add the release's entry to `docs/update-log.md` while you
are there.
