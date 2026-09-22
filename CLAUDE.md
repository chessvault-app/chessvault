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

**The native core is a second implementation, and second implementations
drift.** `native/` mirrors four jobs that also exist in TypeScript, and the
app runs whichever is present — so the two must answer identically or the
explorer quietly reports on positions nobody asked about. There is no
error for that: a Zobrist key wrong by one bit simply returns the wrong
rows. Both sides are therefore pinned to fixtures exported from the JS
implementation (`native/tests/goldens.json`). Change anything either side
computes — the hash scheme, the schema, the per-game codes, the replay
loop's stopping rules — and you regenerate them AND re-run the whole-file
diff: `npm run build:native-goldens && npm run test:native`. Regenerating
alone proves nothing, since it records the new behaviour on both sides.
Never migrate the key scheme at all (`shared/zobrist.ts` says why). And
never let a binary be older than the code beside it: `native/target/` is
gitignored, so nothing in git will stop you, which is why `deploy.sh`
rebuilds it every deploy. `CHESS_NATIVE=0` runs the JS path, which is how
the two are compared. See `native/README.md`.

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
is labelled as such. For anything visible, the diff is `npm run
shots:grid`: record a baseline from the demo build, rebuild, run it
again with `BASE_DIR` set, and quote which pictures changed and where.

**Commit each verified change on its own**, with a message saying why it
was needed and what it cost, not just what changed. Behaviour-neutral
refactors and behaviour changes go in separate commits so the neutral one
stays provable.

**UI text is sentence case**, and nothing hands the solver a rating (a
game's own header Elo is the record of the game and stays).
Difficulty is a word — see `web/src/puzzles/bands.ts`. A rating is how the
trainer picks a puzzle, not a verdict to hand back to whoever solved it.

**UI copy has no em-dash, and says what a control does before why.** The
dash was doing three jobs in the app's sentences (a consequence, an aside,
a separator) that a full stop, a comma or a colon do in every other app,
and Korean has no use for the character at all; `check:repo` rejects it in
the dictionary, in any `t()` literal and in a server error string. The
lone dash a table shows for "no value" is not a sentence and is fine. A
description under a control leads with its effect and leaves the reasoning
to the manual: two short sentences is the ceiling for a new one, and a
number stays only when it changes the decision (a 300 MB download does).

## UI components

**The component layer is shadcn/ui, and the registry files are ours.**
`web/src/components/ui/` holds the files `npx shadcn add` writes (Base UI,
`cva`, `data-slot`), in the registry's own face (nova) and carrying the
app's measured behaviour on top — the phone sheet, the page/layer chevron,
the keyboard band, the sole-field focus, Android Back, the coarse-pointer
hit areas, `title` as a tooltip. Add a primitive with `npx shadcn add
<name>` and start from its look. The older rule, "add only behaviour, never
restructure", is retired (lanph3re, 2026-09-14): these files are app code
and take the same refactors every other file does, the React Compiler's
shapes included, so `npx shadcn add` over an existing file is a diff to
read, never a rewrite to accept.

**And the look is the starting point, not the standing order** (lanph3re,
2026-09-22). The rule was "what stays is the look, with two standing
exceptions", and the exceptions were the tell: each one was a measurement
that beat the registry's drawing, and a rule that has to be excepted every
time somebody measures is costing more than it holds. The last straw was a
third: the segmented control's thumb sat 3px inside a track of its own
radius, where concentric asks for 3px less, and the rule's only answer was
that 3px of splay is not enough to earn an exception. That is not a
judgement about the control, it is a judgement about the paperwork. So the
rule is retired, and what governs these files is what governs every other
file here: MEASURE, DO NOT ASSERT. The registry's drawing is what you start
from, and what you go back to when nothing has been measured; a departure
from it is earned by a number and recorded beside the code with the number
in it, and the pixel grid still has to show the diff confined to what meant
to move. The bar is the measurement, not permission. "It looks better to
me" is still a rewrite to reject, and so is a restyling that arrives with
no reading attached.

Three departures are on the record, and reading them is how to judge a
fourth. The first: where the tonal rule ("The component layer" in
`docs/design-principles.md`) and a registry stroke disagree, the rule wins.
A surface whose fill already separates it draws the card-ring colour and
never the bare border colour, and *how* it draws it follows the box, not
taste: a card resting on the page takes `ring-1 ring-card-ring`, as the
registry's own Card does, because a ring costs no layout; a stroke that
is one side (a divider, a sticky header's underline), or that belongs to
a filled well or a thumbnail, takes `border-card-ring`. A window takes
`ring-window-ring`. Cards drawn both ways is a 2px difference nothing
looks wrong about, and every placeholder standing in for one then has to
rediscover it by measuring: three comments in `skeletons.tsx` recorded
the same 2px separately before the rule said this. The second
is the focus ring's STRENGTH, and only its strength: the registry draws
`ring-ring/50`, a 50% wash, which measured 1.35 to 1.88:1 against what
it lay on over 1,636 tabbed stops here, and WCAG 1.4.11 asks 3:1 of a
focus indicator under PRODUCT.md's yardstick. So the app draws
`ring-ring` at full alpha, in the registry's own shape (3px, the same
colour, the border taking it too), and `--ring` is placed by
measurement, with `check:contrast` holding it to 3:1 at any alpha the
ring is drawn at, which is the regression that would otherwise come back
silently the next time `npx shadcn add` rewrites one of these files. The
text fields are the one control whose ring is not the indicator: their
opaque `focus-visible:border-ring` marks the box and carries the 3:1,
and the 3px halo beside it is decoration, drawn at the registry's 50%
in `--field-halo`, a token at the registry's own ring lightness rather
than the lifted `--ring`, which made the halo read as a thickened
stroke (lanph3re's call, 2026-09-13). The checker scores that halo as
an ordinary stroke and the border as the focus ring, which is the
division of labour the registry's own look implies.
Where the registry hangs another state on that same class the departure
reaches it too, and saying so is part of taking it: the slider thumb
draws `border-ring` at rest and `ring-ring` for its hover and active
halos, so all three are stronger now, and its FOCUS halo is new rather
than stronger, because the registry's `focus-visible:ring-3` painted
nothing on this control at all. The element that takes focus is Base
UI's own `input[type=range]` inside the thumb, and it is clipped to
nothing, so neither it nor the thumb around it could show a ring: tabbing
to the slider changed zero pixels. It hangs on `has-[:focus-visible]`
instead (`slider.tsx` carries every number, and no pixel grid can show
them, because no grid route has a thumb inside its viewport). The third
is CONCENTRICITY, and it is the one the retired rule would have refused.
A shape nested in a rounded container takes the container's radius less
the inset, so the gap between the two arcs is even round a corner
(iOS 26 asks this of every nested box; `ConcentricRectangle` is the API).
Every nested pair the demo draws was measured on 2026-09-22, across
eleven routes on a phone as iOS and on a desktop, and the app was
concentric everywhere the two arcs are close enough to be read as a
pair, with one exception: the segmented control's thumb sat 3px inside
a track of its own radius, where concentric asks for 3px less, and
splayed at every corner. It was the registry's drawing and 3px is
small, which is exactly why the old rule kept it. So `ui/toggle-group.tsx`
now states the track's radius and the radius a shape nested in it must
take as ONE expression (`--tg-r`, `--tg-r-inner`), which is also what
stops them drifting: the thumb was `rounded-md` next to a track at
`min(--radius-md, 10px)`, two unrelated classes that happened to agree
at one setting of the Corners knob and not at the others. A departure
that replaces two numbers with one is the shape to aim for. A
hand-rolled popover, menu,
dialog or tooltip beside a Base UI one is two focus stacks on one page. The
theme at rest is shadcn's neutral; Settings → Appearance tints it. Composites go in `web/src/components`,
shared hooks in `web/src/hooks`. See "The component layer" in
`docs/design-principles.md` for the token mapping and the focus-ring rule.
An agent working here should have shadcn's own skill loaded — `npx
skills add shadcn/ui -a claude-code --copy` puts it in `.claude/skills/`,
which is not committed; it reads `components.json` and `npx shadcn info`
and enforces the registry's composition rules (Field for forms,
ToggleGroup for option sets, `data-icon` on button icons, no `dark:`
colour overrides). The skill is guidance, written for any shadcn project;
where it disagrees with this file or with behaviour that was measured here,
this file wins. Three places it will point at are deliberate: the registry's
own `dark:` classes inside `web/src/components/ui/` (its rule is aimed at
app code), the row icons on `glyph` (14px, where a 16px icon was
measured too large for a desktop row; 16 on a phone), and the phone's pane strip
(`components/pane-tabs.tsx`) held at 32px, pill or header, under the
36px coarse-pointer floor. That strip is out of scope for every audit and critique: it is
not to be raised, and not to be reported.

**Class names speak the registry's vocabulary** (`bg-card`,
`text-muted-foreground`, `border-input`, `bg-destructive`), with the
app's colour grammar beside them (`good`/`warn`/`info`, the board and
eval colours). Old names (`text-fg`, `text-subtle`, `bg-surface-3`,
`bg-surface`, `border-line`, `text-bad`) are gone and must not return.

**A placeholder is a second drawing of its page, and it is kept from
drifting two ways.** By construction first: an outline
(`<Page>.skeleton.tsx`, drawn while the page's chunk is on the wire and
again by the page for its own wait) is composed from what the page
itself draws, never from a copy of it. A frame, a class string, a list
of labels or a sentence that both need is stated once, in the outline's
module or a light one beside it (`components/layout.ts`,
`insights/copy.ts`, `workspace/board-budget.ts`), and the page imports
it back; the outline cannot import the page, whose chunk is what it is
waiting for. A number copied into a placeholder is a measurement of one
moment and says so. Then by measurement: `npm run check:skeletons` holds
every route's outline, wait and loaded page to each other on the demo
and fails when anything drawn in two of them has moved. Its first run
found six routes adrift that six hand audits had not, because the
harness they used had never once held a data wait. A drift that is
found and not fixed goes in that script's `KNOWN` list as OWED, with the
reason; a new route goes in `scripts/lib/placeholders.ts`, which the
check insists on.

**The phone chrome may be platform-specific since 2026-09-18.** One
attribute on the root, `data-platform` from `web/src/lib/platform.ts`,
and two variants, `ios:` and `android:`, stacked on the registry's files
like `md:`; no second component tree, and nothing inside a card differs
by platform. Which platform owns which idiom, what a glass surface is,
and what a platform variant has to prove (a diff confined to the grid's
`phone-ios` pictures, and for glass the phone's frame time and a
sampled contrast) are in "Platform-specific design" in
`docs/design-principles.md`. The pane strip's exception above holds on
every platform.

## Before cutting a release

All three of these, every time, before the version is bumped:

**Audit the repo against this file.** `npm run verify` now does the
mechanical parts on every push and pull request (`check:compiler` among
them: every component must compile under the React Compiler, since a
refusal is silent), and `check:contrast`, `check:page-turn` and
`check:skeletons` run beside it as their own CI job — not in `verify` because they are the checks that
need a browser and a built demo, and the first was a script nobody ran
until that job existed. `check:repo` documents
its own list at the top of `scripts/check-repo.ts` — currently absolute
paths and credentials, a rating rendered without `bandOf()`, the lockfile
agreeing with package.json, the Rust crate notice matching Cargo.lock, the
retired colour names in either the class or the `var()` form, every
UI string the manual "quotes" still existing in the app's source, no
em-dash in a UI string, no `title` attribute on a raw element (the app's
tooltip is the themed one, through a primitive's prop or `TitleTip`), and
one Korean word per concept in the dictionary
(the glossary at the top of `web/src/lib/ko.ts` is the canon; 보관함 is
the vault and nothing else). Add to
that list whenever a mistake turns out to have a shape a grep can catch;
keep the header in step with what the file does, or this paragraph starts
lying about it.

They are tripwires, not proofs, so the reading still matters: check that
nothing new is per-book code, one-machine tooling, or a user action that
needs a shell, that no UI has started showing a rating by a route the grep
cannot see, and that the native core and its TypeScript twin still agree.
The point is to catch drift while it is one line, not at the moment of
publishing.

**Read the docs and fix what has gone stale.** `README.md`, everything in
`docs/`, `scripts/ml/README.md`, `desktop/README.md`, and the published
site's user-facing pages — `web/landing/index.html` and
`web/landing/docs.html`, both languages.

**Audit the manual against the app.** The manual is a control-by-control
reference, which makes it the doc most able to rot: `check:repo` proves
its quoted strings still exist somewhere in the source, but not that a
control still sits on the page the manual puts it on, that a described
workflow still runs that way, or that the Korean still says what the
English does. Walk it page by page with the app open beside it, in both
languages. Its screenshots come from `npm run shots` against the built
demo — if the release changed anything visible, recapture and commit
what actually differs. When quoting a new UI string, curly double quotes
mean "the screen says this" and are what the check enforces; use straight
quotes or guillemets for anything looser. Docs rot silently —
a number that was true, a file that has been renamed, a limitation that
has been fixed — and a wrong doc is worse than a missing one because it
is believed. Settle the release's entry in `docs/update-log.md` while you
are there, in both languages. It is usually not written from nothing: an
`Unreleased` heading collects whatever landed after the last tag, and
cutting a version renames that heading, gives it a lede, and adds
whatever went in without being written up. A release that finds no such
heading starts one the same way. Anything left under `Unreleased` after
a release is a claim that it is in no installer, so it has to be true.
That heading and its lede are also what the GitHub release's body is
written from — `docs/release-notes.md` has the shape, what survives the
tightening, and the order the draft is filled and published in. The body
is never left empty.

**Check the licence inventory.** The npm side is generated at build time
(`web/vite.licenses.ts` walks `node_modules` into `licenses/index.html` and
`dependencies.txt`) and cannot go stale; two things are by hand and can.
After `npm run build`, compare `dist/licenses/dependencies.txt` — its
licence set and its package count — against the rows in `THIRD-PARTY.md`,
and ask whether anything since the last release arrived by *copying*
rather than installing: a registry's component sources, a vendored file,
artwork. The dependency walk never sees those, and MIT and ISC want their
notice in every copy, so each needs an `ASSETS` entry in
`web/vite.licenses.ts` and its licence text under `licenses/`. The shadcn/ui
sources in `web/src/components/ui/` were missed this way for one release.
