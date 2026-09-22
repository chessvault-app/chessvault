# Design principles

*English · [한국어](design-principles.ko.md)*

Decisions that recur across the app, with the reasoning that produced
them. When in doubt, these win over novelty.

## Language and tone

- **Sentence case everywhere** ("Add puzzle", "Book solution"). No
  Title Case labels.
- **Plain words over jargon**: fidelity tiers are "Book solution /
  Engine + book / Engine solution / Engine guess / Draft", not
  "book-parsed/engine-corroborated". A stranger should understand a
  label without the tooltip; the tooltip carries the precision.
- **No rating for the solver.** Puzzle ratings exist only as curation
  data; the UI shows bands (Easy/Medium/Hard/Expert) as text labels.
  Difficulty is ordinal, so if it ever needs more visual weight it gets
  a strength meter, not colours. The rule is about the person using the
  app: nothing hands them a number about themselves. A game's own header
  Elo is the record of the game, two players' published ratings on the
  day it was played, and the Games table shows it as it shows the date.
- **No scores either.** The same rule, one step out: a rating is not the
  only number that hands back a verdict. The dashboard carried a "Win
  rate" percentage in 24px bold and the trainer a "Run" of consecutive
  correct answers, and both were the app grading you. A run is the worse
  of the two — a count that survives only while you do not fail is a
  reason to pick puzzles you will get right, and the useful session is
  the one you fail in. Counts of work done ("Solved today", "Attempts",
  "Solved") are facts and stay; anything that reads as a score does not.
- **Report the result, do not celebrate it.** "Solved", "Solved with
  help", "Solved after a wrong try", "Not solved" — labels, not a tutor.
  The trainers said "Solved!" and "Not this time." and "Not quite —",
  which is a game's voice, and the app had already decided everywhere
  else that a solve is a fact to state.

## The colour grammar

Colour carries meaning, and each hue has exactly one job:

| Hue | Meaning | Examples |
| --- | --- | --- |
| green / red | outcome: solved/failed, won/lost | dashboard ✓/✗, book tiles, winner digit in game lists |
| amber (warn) | caution | Engine guess tier, offline notices |
| blue (info) | trusted/informational | Book solution tier, annotated-game pen |
| teal / purple | fidelity ladder middle rungs | Engine + book, Engine solution |
| primary | interactive/active | active nav, chips, buttons — neutral (near-black / near-white) in the default scheme; the accent knob tints it |

Corollaries that were learned the hard way: a green dot on a tile grid
reads as "solved" no matter what you meant (the fidelity marks became
shape-coded icons for this reason), and the difficulty ramp
(green→red) is forbidden because it would collide with outcome colours
in the same rows. Signals should never be colour-only — the winning
digit also carries more weight, tier marks also differ by icon shape.


Contrast is measured against every background a token can land on —
`--background`, `--card`, `--muted`, `--surface-3` — and not against
the page and the white surface alone. The quiet tiers passed on those
two and failed on the raised and inset panels, which is where the gap
is smallest: the then third text tier, `--text-subtle`, was 4.12:1 in light and 3.16:1 in dark
before anyone measured the third and fourth. Small text needs 4.5:1 on
all of them. When a tier darkens to reach it, the tier above darkens
too — two quiet greys that meet at the same lightness are one grey.

A tint a row can shine through is not one background but two. The result
chip was `bg-good/15 text-good`, and the games rows it sits in fill with
`--accent` under the pointer: the wash let that fill through, so the chip
was measured at 3.58:1 in light and 3.02:1 in dark on hover. Moving the
token does not reach it — light needs 43% before hover clears the floor,
and dark never clears it at all, because what moved was the fill and not
the text. Outcome tints are opaque tokens now (`--good-tint`,
`--destructive-tint`, mixed at the 10% every other tint in the app already
used), so a chip measures the same at rest as under the pointer.

The dark ladder is placed on Linear's own, and it is derived by ratio.
It took two readings on 2026-09-22 to get there. The first read Linear's
dark desktop as a window ground of about 14, a sidebar at 20 and content
at 23, and lifted the app's ladder off the floor to meet it: the frame
19%, the page 20.5%, the card 24.5%. Before that the page was 14.5% and
measured 10 — near black, a hole with the app drawn on it — with the
frame and the sidebar ten points above it.

The second reading, the same day, sampled lanph3re's own screenshot of
that window (1718x975, sRGB on blank rows) and found the first had been
of some other one. Linear's window ground and its sidebar are a single
`#09090a`, which is 9 — the sidebar is not a rung of its own, it is the
ground, one fill from the window's edge to the panel's — its content
panel is `#121213`, 18, and the band a section header fills to is
`#1b1c1d`, 27. What the first reading got right is the DIRECTION, and
that is the part worth keeping: the reading surface is the lightest of
the three and the frame is a step back from it, as light's 95% under 97%
already was. What it got wrong is every number.

So the anchors are 14% for the frame, 18.25% for the page and 22.25% for
the card, which draw 9, 18 and 27 on the green channel the comparison is
made on. Frame and page then sit 1.06:1 apart, which is what Linear's own
two measure and what light has been at all along, so the two themes are
separated by the same amount at last.

Everything else is derived, and the rule is the ratio and not the
lightness. WCAG compresses near black, so a point of OKLCH lightness at
14% and two points at 22% are the same separation to the eye on an
emissive screen. Every rung keeps the ratio to its anchor it was tuned
at, with one exception: the card, which takes Linear's own 1.09:1 over
the page rather than the 1.10 it had, because copying Linear's lightness
and keeping our separation cannot both be done.

| rung | was | is | measured |
| --- | --- | --- | --- |
| `--app-ground-base`, the window frame and the sidebar | 19% | 14% | 1.06:1 under the page (was 1.03) |
| `--background-accent` | 19.25% | 16.7% | 1.026:1 under the page (1.026) |
| `--background`, the page | 20.5% | 18.25% | the anchor |
| `--surface`, the card | 24.5% | 22.25% | 1.09:1 over the page (1.10) |
| `--surface-inset` | 26.5% | 24.5% | 1.06:1 over the card (1.06) |
| `--surface-2`, muted and secondary | 29.9% | 28.2% | 1.19:1 over the card (1.19) |
| `--surface-3` | 34.6% | 33.1% | 1.42:1 over the card (1.42) |
| `--accent`, hover and selected | 39.4% | 38% | 1.20:1 over `--surface-3` (1.21) |

The far end of the contrast knob is untouched: at knob 1 the dark ladder
is the one that shipped, and only the frame moved there, from the card's
rung to black with the page, which is the trade light already makes at
that point.

Beside the rungs, only the neutral strokes and fills that are scored
against one of them moved with the second reading: `--border` to 30.4%
and `--border-strong` to 41.1%, which keeps a hairline on a card at the
1.285:1 and 1.97:1 it was already drawing; `--primary-soft` to 31.4%,
the `::selection` fill, at its 1.32; `--board-frame` to 25%. Every ink
stayed exactly where the first reading had put it and gained, because
the surfaces under them all came down. Measured on the demo at the
default knobs: `--muted-foreground` 5.83:1 on `--surface-3` where it read
5.54, `--text-subtle` 4.96 (4.72), `--good` 5.20 (4.94), `--destructive`
4.80 (4.54), `--info` 4.88 on the `--accent` fill (4.58), `--ring` 3.67
on the same fill (3.44). `check:contrast` passes with nothing below the
floor. `--glass-fill` keeps the dark value of its own it was given, 72%
against the shared 70%, because glass is tinted with `--surface-3` and a
lighter glass hides white content less: the ink on a glass band scrolled
over white fell from 4.75:1 to 4.44 when that rung rose, 72% took it back
to 4.69, and the rung's fall to 33.1% now reads 4.90. 70% would read
4.61 and would also clear the floor; the override stays because a number
placed by measurement is not worth unplacing to save a line. That one is analytic and `check:contrast` cannot hold it, because
the check composites a glass surface over the DOM under it and not over
what is scrolled behind it. A ladder is not the rungs alone.

## Icons

A glyph names the thing, not what it evokes. Games wore crossed swords,
the explorer a compass, the repertoire a swatch book and "index this
database" a hammer — a games console, an expedition, a paint shop and a
building site, for a folder of recorded games, a table of continuations,
a drill and a scan of games already on disk. They are a folder, a table,
a stack and `ScanSearch` now. An icon that has to be decoded is worse
than no icon, and crossed swords in particular is the glyph a chess app
reaches for when it wants to be a game.

Naming the thing is half of it; the glyph also has to separate its item
from the ones beside it. Games was `ScrollText` for two days, which a
game score literally is — but a scoresheet is paper, and Studies, Notes,
Books and Puzzle books are paper too, so the sidebar carried five sheets
of stationery distinguished by their line spacing. `Folder` is the one
container of files in that list, which is what the collection is, and
what `FolderInput` and `FolderPlus` already call it on the analysis
board. The repertoire's repeat sign went for a third fault again — one
glyph meaning three things: the section, "switch to the black map" in the
map menu, and "start the next cycle" on a puzzle book, of which only the
last is repetition. It is `Layers` now, a stack of prepared lines.

A glyph is also chosen at the size it is used, not in the source. Both of
the last two changes were picked on a rendered sheet of candidates drawn
at 18.4px in the sidebar's own colours, which was the sidebar's icon
size then and is 14px now (the bullet on its metrics below), and both
times the reading
changed: `Shapes` was withdrawn on sight for clustering under Network's
three dots, and half the repertoire candidates — a handshake, two theatre
masks, a metronome — turned to porridge at the size they would be used.
Draw them before choosing.

This is also why nothing in the nav is a chess piece, quite apart
from the mark's own reason below: in a list where every entry is chess,
a pawn names the application, not the entry. Pieces keep the two jobs
they hold elsewhere — `KnightIcon` for *this is chess*, `KingIcon` for
*this side* — and a third job would make a piece mean nothing until you
noticed where it was sitting.

Nothing is magic, so nothing wears sparkles. `Sparkles` sat on the
opening map's "Grow from my games" and on a reference database's
Optimise; it is the magic-wand glyph, and it advertises a result the
reader is not expected to inspect. Both are the opposite — growing reads
the games already in the vault, and optimising states its three steps in
the confirmation before it runs. `GitBranch` and `Hammer` say what they
do.

Where a glyph has a meaning in chess, use that one. The puzzle trainer
marked the move you played with ✓ or ✗ — marks a player meets on a
worksheet and nowhere on a board — while the analysis board two files
over was already drawing the same disc, in the same two colours, with `!`
and `??` on it. The book trainer settles it: it marks a wrong move with
`nags: [4]`, which is `??`. Two trainers were saying the same thing in
two alphabets and one of them was not chess. The ✓/✗ on the puzzle-book
tiles stay: those record past outcomes in a grid and are deliberately
redundant with the tint, because a state carried by colour alone is
unreadable to one reader in twelve — a different job from telling
somebody what they just played.

## The type scale

Tailwind supplies the rungs. Which rung carries body text is this app's
decision, and for a long time it was the wrong one: body copy sat on
`text-xs` at 284 call sites — 12px, the size Material, Fluent and GitHub
all reserve for captions — with an unnamed 11px tier below it. On a
phone that is 70% of the size every other app on the device uses.

The scale itself was never at fault, so the fix was not to redefine
`--text-xs`. A token whose name means one thing here and another
everywhere else buys a one-file diff and keeps a permanent lie. The
usage moved up a rung instead:

| Tier | Class | Size |
| --- | --- | --- |
| the last rung, below type | `text-micro` | 10px |
| captions | `text-xs` | 12px |
| a small control's label (the registry's) | `text-[0.8rem]` | 12.8px |
| body, list rows, panel text | `text-sm` | 14px |
| a list row and the panel heading over it | `type-row` | 14px; 16 on a phone |
| the tail beside a row's text (a date, a count) | `type-row-sub` | 12px; 14 on a phone |
| titles, setting rows, an empty state's title | `text-base` | 16px |
| page titles (`PageHeader`, desktop) | `text-xl` | 20px |
| the one display figure, and a phone's page title | `text-2xl` | 24px |

Weight is a shorter ladder than size, and it has to be: regular for body,
medium for a title or a label, semibold for a headline or a state. Three,
which is what Primer, Fluent and Material all land on, and one of them
per role. An audit on 2026-09-15 found the 16px title split 26 sites to
12 between medium and semibold, with two files drawing one shape both
ways, and resolved it downward onto medium, the weight this table's
`text-base` row has always implied and the one the registry's own
`CardTitle` draws.

There is no bold. Primer does not define a 700 token, Apple's guidance
is not to use it for standard UI text, and neither Material's scale nor
Fluent's ramp hands a role one; the six places that had it are 600 now.
The two exceptions that survive are not weights but marks: the current
row goes semibold whether or not it also takes a fill, because in the
Neutral scheme `--primary` and `--foreground` are nearly the same ink
and a colour change says nothing there, while a weight step reads at
every contrast knob. A weight that changes on HOVER is not allowed, as
it reflows the text under the pointer.

The two `type-row` rungs are the same class at both widths and a
different size: a list row's line is 16 or 17 on both phone platforms
(iOS Body, Material Body Large) with its supporting line at 14 or 15,
and the app's rows sat one rung under each on every screen. Desktop
conventions (macOS 13pt, Windows 14px, dense tables) are the 14 over
12, so the rows keep it there and step up under `md`. Named in
`index.css` rather than written as `text-sm max-md:text-base` at each
site, for the reason the 10px rung was named.

"The ONE display figure" is load-bearing and was not true for a while:
the puzzle dashboard spent that rung four times in a single row, on four
raised tiles of Solved / Attempts / Win rate / Failed. Four numbers at
the top size is not emphasis, it is a scoreboard — and one of them was a
percentage, which the tone rules above have their own objection to. They
are a figure list now, labels and values in columns at `text-sm`, in the
`dl` idiom the trainer's finished-puzzle panel already used. If a rung
this loud appears more than once on a page, the page has stopped ranking
its own content.

A magic `text-[…]` literal means a tier exists that nobody named: 81 of
the 89 in the app were the same value, retyped at every call site. That
is where `text-micro` came from — the 10px rung the table opens with,
named once and used by the eval bar, the PV peek and the puzzle-book
tiles, none of which are type in the sense the other rungs mean. Two
literals remain in app code — the tile-corner glyph and the result bar's
digits — each sized to the thing it sits on and
not to type, which is the only excuse a literal has, and each says so in
a comment above it; `check:repo` refuses a new one without that
sentence. (The 11px variation text is not a literal but the bottom rung
of the annotation-size setting, kept in `store/prefs.ts`.)
`web/src/components/ui/` has its own, which are the registry's and not
ours to name — with one exception, now in the table above, because a
rung a reader meets on every page is a rung whatever directory it is
declared in. shadcn's `sm` size sets `text-[0.8rem]` on Button, Toggle
and the calendar's cells: 12.8px, between captions and body. It reaches
further than the word "exception" suggests, since `size="sm"` is what a
toolbar uses — measured on the editor's FEN panel, three text sizes on
one screen and the middle one is this. It keeps the registry's value,
for the reason the component section gives: what this app adds to a
registry file is behaviour, not geometry. What changed is only that the
table stopped saying the ladder has six rungs where the app renders
seven. Note that `check:repo` cannot hold this one, since the literal
lives in the directory the check exempts — the table is the only record
of it there is.

Placeholders are what a scale change breaks. A skeleton line box must
equal the real line-height, and line-heights do not all move together —
an explicit `leading-` pins one where the token would have moved it. Re-
derive each box from the component it stands in; never shift them along
with the text. Rhythm copied out of the note editor belongs in `em`
against the editor's own font size, not in the px it resolved to once.

The mono role goes on the figure, not the sentence. "30 games" was one
`font-mono` span, so the word wore the mono face beside the digits, and
in Korean the same span read "게임 30개" with the hangul falling through
to Pretendard inside it: two typefaces in one word. Mono is for what is
scanned as a column or copied as a literal; a count's noun is neither.
`components/figures.tsx` wraps only the digit runs of a translated
sentence in the role (tabular, so a column of them still lines up) and
leaves the words in the sentence's own face. Where the whole cell IS a
number (an Elo, a date, an eval) the cell stays mono as before.

## Density

How much of a vault fits on the screen is a setting, not a constant. It
is the knob a tool has and this app did not: it could recolour itself
thirteen ways and round its corners four, and had nothing to say about a
page that is four hundred games.

Five numbers in `styles/tokens.css`, one per kind of repeating row, and
`Settings → Appearance → Density` moves all of them by putting
`data-density="compact"` on the root. Comfortable carries no attribute —
it is what `:root` already says, so nobody's app moves until they ask.
Per-device like the rest of `store/prefs.ts`, because the same vault
wants compact on a monitor and comfortable under a thumb.

| Token | Rung | Comfortable → compact | Read by |
| --- | --- | --- | --- |
| `--row-py` | cards, list rows | 8px → 5px | `games/shared.tsx`, `components/list-row.tsx` |
| `--row-py-dense` | one-line rows | 6px → 3px | `list-row` (`dense`), move-list comments |
| `--row-py-tight` | tabular rows | 4px → 2px | `MoveTreePane`, `ExplorerPane` |
| `--row-h` | rows sized, not padded | 32px → 28px | the studies chapter list |
| `--card-pad` | the panel around them | 16px → 12px | `components/ui/card.tsx` |

Three things this shape is deliberately not:

- **Not Tailwind's `--spacing`.** That is one line and the wrong one: 401
  rules in the built stylesheet derive from it, every `size-*` included,
  so squeezing it shrinks the icons along with the padding. A density
  control is about whitespace; a glyph is not whitespace, and 14px icons
  measured right for their row do not become 12px ones because a list got
  tighter.
- **Not one rung.** The tabular rows were already the tightest rhythm in
  the app before a density existed — a move, a continuation, a game under
  either, read in columns rather than scanned as cards. Folding them into
  the dense rung would have made them taller at comfortable in order to
  make them shorter at compact.
- **Not the book reader.** It is the one surface worth naming as absent,
  because "why is the reader not here" is the question this table invites.
  It has no list — no `<ul>`, no `<li>`, no `<tr>` — it is a PDF canvas
  beside an analysis board, and its `h-9` and `h-7` are toolbar bands.
  Shrinking a control strip is not what this knob promises, and it would
  fight the coarse-pointer hit areas besides.

Anything derived from a rung must be derived, not restated. The move
tree's branch elbow has to end on the middle of the first line of the row
it points at, which is that row's top padding plus half a `text-sm` line;
it was written `h-3.5`, exactly that sum at the comfortable rung. A
density that moved the padding and left the elbow behind would have put
every branch guide in the app slightly off its own move, silently. It is
`--move-elbow-h: calc(var(--row-py-tight) + 0.625rem)` now, so there is
still one number per rung.

Where a density lands is measured, never guessed: 44 dashboard rows go
1575px → 1307px, an explorer row 28px → 24px, a chapter row 32px → 28px.

## Layout rules

- **A page belongs to one of four families**, listed in `components/layout.ts`:
  the scrolling column, the board page, the canvas and the workspace.
  The family says what the page *is*; only the first has widths to pick
  from. A page that fits none of the four is a fifth family to be
  named there, not markup written inline — the opening map spent its
  first release off-template that way.
- **Scrolling pages sit in `PageShell`, on one of four named
  widths**: `xwide` (96rem) for a data table beside a details column
  (the games collection), `wide` (72rem) for pages that split into
  columns or card grids (Studies, Notes), `medium` (48rem) for one
  column read top to bottom (Puzzles, Databases), `narrow` (42rem) for
  forms (Settings). A width is a statement about the kind of content, so
  pages of the same kind must agree — a page picks a tier, never a
  number. One gutter scale (1rem, 1.5rem from `md`, where the sidebar
  appears) and one safe-area-aware bottom inset come with it.
- **A page's chrome stands on the page; a `Panel` frames a surface that
  stands beside or among others.** Studies, Notes, Books and Games open
  the same way: the title line with the page's own Import, the count,
  the search row, then the content, all on the page's background. What
  the content is (cards on a shelf, a table of games) picks the width;
  it never earns a box. The box is for a second surface: the details
  column beside the games table, the workspace's bands, a dashboard's
  stacked panels. The Games page stood its whole body in a `Panel` for a
  while, and beside three shelves whose cards are the items it read as
  a different app; `GamesBrowser` takes a `frame` for that, `page` on
  its page and `panel` in the workspace, and `GameListShell`'s `page`
  shape drops the bands' side padding so the search field starts where
  the title does.
- Board-family pages (Board, studies/games viewer, trainers,
  repertoire, editor) fit the viewport rather than scrolling, by the
  shared shells in `components/layout.ts` — one place, not eight copies. The
  row is 76rem up to about 1350px and then follows the window to a
  96rem ceiling, so a large monitor draws a large board. Two shells,
  because "fit the viewport" has two readings when stacked:
  `BOARD_SCROLL_SHELL` lets the page itself scroll (board, repertoire,
  editor), `BOARD_HELD_SHELL` holds the page still and gives its side
  column the scrolling (analysis, study, both trainers). A held page
  scrolls only where the column can no longer be squeezed — a short
  landscape window, where a floor on the column binds and the shell is
  what gives.
- Two pages are **workbenches**: a pane beside a board-family body —
  the puzzle corrector (the book's scan beside the editor) and the book
  reader (the PDF beside the analysis board). The pane is
  `components/resizable-pane` — a drag grip, a width remembered per use,
  a cap so a width dragged out on a big monitor cannot squeeze the board
  off a small one — and at `stacked` the two become `PaneTabs`, the
  board kept mounted behind the other tab. What sits beside the board
  is the board family's own shell, so the board is the size it is
  everywhere else. The reader's hotspots follow the same rule as every
  hover-revealed thing: a small button in the diagram's corner, always
  visible, larger under a coarse pointer, and the app's action menu —
  never a guess — where the page did not say who is to move, the same
  menu every row opens.
- Canvas pages (the opening map) sit in `components/canvas-shell`: the ordinary
  `PageHeader` on `PageShell`'s own gutters, an optional search row
  under it, and then one surface filling everything below, edge to
  edge. Inside that surface — not over the page — float the page's own
  controls, a detail panel that becomes a bottom sheet on a phone, and
  `CanvasOverlay` for the centred empty and error states. A canvas
  page's Fab is phone-only, and its actions are one array the corner
  draws as icons and the Fab opens as the action sheet, the same
  two-presentations-one-list shape `CreateControl` uses. It is the one
  floating disc left in the app: a canvas pans under the finger, so a
  header is out of reach the moment the map is in use. A shelf's create
  button is in its header at every width, one word beside a phone's
  large title, and the several things a shelf can make open as the
  action sheet its rows already use. The disc fanned them as pills over
  the last rows for a while, which is the stacked FAB every current
  phone platform has stepped back from, and it stood on whichever row a
  scroll or Tab ended on; the cost of the header, a scroll back after a
  long list, was judged smaller.
  An open panel stands on those corner icons at every width it appears
  at, so while it is up they go `inert`: chrome nobody can see is chrome
  the keyboard must not stop on, and the panel's own X is how it comes
  back. The surface is told how wide the covered strip is
  (`useCanvasInset`) so it can keep what the reader just asked about out
  from under it — the map slides its viewport the least distance that
  uncovers the selected dot. Neither is a z-index fight: lifting the
  selection over the panel would only hand the same problem to whatever
  came second.
  The header is IN THE FLOW, above the surface. It floated briefly, and
  that put dots and labels behind the page's own title and panned them
  through it on every drag; it also meant the surface could swallow a
  press meant for the header, which took a pointer-events dance to
  arrange around. Chrome that belongs to the SURFACE floats; chrome that
  names the PAGE does not. A canvas still cannot be a fourth width: a
  width answers how long a line of text should be, and a canvas wants
  every pixel it is given at any size.
- **One page title**: `PageHeader` — one name, two rungs. On a desktop
  it is `text-xl font-semibold tracking-tight` with the actions pushed
  right. On a phone the name is a `text-2xl` large title in a 44px row
  that scrolls away with the page. For two releases that row was a
  sticky bar that shrank the name to two thirds and took the bars'
  white once the page had scrolled under it (the iOS large title,
  Material 3's medium app bar); it came out because it cost 44px of
  every scrolled list to keep a name on screen that the tab bar already
  gives, and the shrink was one more thing moving while a list was
  being read. The phone-only back chevron sits where a page is
  reached through More. `subtitle` (what the page has: 12 studies; while a filter
  narrows a shelf, how many of those it shows, "3 of 12 studies", as a
  status so the result is spoken),
  `description` (what it is for) and `search` (its find-or-filter
  field, full width on a phone and `max-w-sm` on a desktop) are slots
  of the header, rendered as SIBLINGS spaced by the column's gap, a
  shape the bar forced and every page is now written against.
  `ShelfToolbar`, Books, the puzzle shelf, Themes, Licences and
  `CanvasShell` are built on it. (Four title sizes had accumulated; a
  page's name is one voice.)
  A canvas page uses it too, on the same gutters, with its surface
  starting below. It briefly had a `text-base` title of its own, on the
  theory that a heading competing with the canvas is a heading in the
  way; what that actually produced was one page whose name was a
  different size at a different distance from the edge than every other
  page, which reads as a mistake rather than as restraint.
- A page that scrolls scrolls its **outer** wrapper — the scrollbar
  belongs at the viewport edge, and it is shown: hiding it is a
  mobile idiom, and panels' internal bars were already visible.
- List rows stripe with a **full-bleed** `nth-child(even)` tint, the
  same alpha family everywhere. Inset rounded pills are forbidden for
  striping: with few rows, one tinted pill reads as a selection, not
  as alternation (the engine PVs learned this).
- A list's **count row** leads with the tally in the section-label
  voice — the registry's `text-sm font-medium text-muted-foreground`, the
  same voice a panel's title and a group of settings are named in — and
  keeps its controls on the right; the databases and archive panels share
  this shape because they take turns in one column. (The small-caps
  `label-caps` voice is gone with the old look.)
- A panel's header is the registry's card header as a row (`PanelHeader`:
  title, actions). It pads itself across only, from the card's own
  `--card-spacing`. It has one floor — 44px, 52px on a coarse pointer, the
  height an icon button gives it — so a header holding only a switch, or
  nothing, is as tall as its neighbours and the title does not jump when a
  phone's pane tabs switch; nothing else is sized against it.
- **A panel's bands sit flush; only its footer takes the card's spacing.**
  `Panel` sets `gap-0 pt-0` on its card and gives back exactly one piece
  of it, `[&>[data-slot=card-footer]]:mt-(--card-spacing)`. The registry's
  vertical model assumes slots are content needing air put around them; a
  panel's slots are full-bleed bands — a header, an engine block, a tab
  bar, a scrolling body, a controls row — each bringing its own height and
  its own rule, so the padding had nothing to space and the gap left those
  rules floating. Measured on the header, the worst case: 16px above a
  52px band and 16px below it, 84px before a word of body where the old
  header took 52. What is kept is the card's floor and the space above a
  footer, which is what the adoption was for. Stated once in `Panel`, not
  at each call site — that was the mistake being undone — and the `>`
  matters, because the two trainers keep their footer inside the scrolling
  body where that body's own gap already spaces it.
- **Do not reach for `:first-child` to decide whether a band needs its
  spacing cancelled.** An earlier version of the above guarded a negative
  margin with `[&:not(:first-child)]`, which is not a guard: a
  `display:none` sibling still counts for `:first-child` while
  contributing no flex gap. The board page hides its engine block, so the
  guard passed with no gap to cancel and the header was dragged 16px above
  the card's own box — under `overflow-hidden`, out of sight rather than
  merely tight. Turn the spacing off and add it back where it is wanted.
- **A panel's spacing is the card's, not the call site's.** `Panel` is a
  `Card`, and the registry's Card owns the vertical: `py-(--card-spacing)`
  on the root, `gap-(--card-spacing)` between its slots, and
  `has-data-[slot=card-footer]:pb-0` so a footer's muted band reaches the
  bottom edge on its own. A panel body therefore sets **horizontal padding
  only** — `px-(--card-spacing)`, or a tighter `px-` where rows are meant
  to sit near the edge — and never its own `p-`, `mt-auto` spacer or
  negative margin to fake what the root already does. The root's VERTICAL
  half is the part `Panel` turns off for its bands — see the bullet below
  — but what it hands out is still the card's to hand out, and a body that
  starts padding itself again is the thing this rule exists to stop.

  This is worth stating because the app spent a release doing the
  opposite. The root had been stripped of its padding and gap on the
  grounds that panels own their scroll area, so every call site
  re-implemented the two rules by hand — `-mx-3 -mb-3` in the trainers, a
  conditional `pb-0` in the repertoire — and the one that implemented only
  half of them had its footer sitting flush against the text above it.
  There is no `flush` prop any more: all 30 panels passed it, so the
  padding it switched off was never once switched on. If a panel needs
  different spacing, it sets `size="sm"` (12px) or overrides one class —
  it does not go back to owning the model.
- `wide` / `stacked` are orientation-based custom variants: side-by-side
  when the viewport is wide, single column otherwise. Stacked layouts
  lead with a page header (convention: header at top), wide layouts put
  the header in the side column where it aligns with the board.
- Phones (`md:hidden` world): the bottom bar holds five tabs — Home,
  Games, Studies, Puzzles, More — the count where Material 3's guidance
  stops and the one lichess ships; Notes, Books, the opening map and
  Insights are reached through More and the Home tiles. The current tab wears the
  sidebar's current-row pill (`bg-nav-pill`, 12% of primary over the
  card behind the icon, a semibold label), so both navigations say "you are
  here" the same way. The bar stays docked and pinned: the floating
  capsule is iOS 26's idiom alone, and hiding on scroll would resize
  every page, since the bar is a flex sibling of `main`. It is the
  navigation on hub pages, but a **leaf page claims it** — board, study, puzzle and
  repertoire replace the global tabs with their own controls (move
  navigation, puzzle actions) via `MobileActionBar`, and you leave by the
  back chevron, Chess.com/Lichess-style. Desktop navigates by sidebar, no
  back arrows on top-level pages.
- **The desktop sidebar is measured off Linear's, not composed.** 240px
  across, 28px rows on a 30px pitch, an 8px corner and a 14px glyph whose
  centre sits 24px in from the window's edge, each of them sampled off a
  screenshot of Linear's dark desktop (2026-09-22) rather than chosen.
  The label is the exception and is `text-sm`: theirs measures 13, and 14
  is this app's regular text, so a 13 here would have been the only one
  in the window and would have set the nav one step under the list it
  navigates to. The one number
  that is ours is the folded rail's 48px: the icon's centre has to be the
  same distance in whether the sidebar is folded or not, or it slides on
  every fold, and 48 is the rail width whose centreline is Linear's 24. A
  coarse pointer takes the 36px floor back on every row. The sidebar has
  no fill of its own in any of this; it is the window's ground, which is
  the ladder's point above and Linear's arrangement too. What is NOT
  Linear's is the current row's RAIL, which is gone: the 3px bar of
  primary down the left edge of the selected row was a second marker
  beside the pill it sits in, and Linear marks its own with the fill
  alone (lanph3re, at the deployed build, 2026-09-22). The tonal pill
  stays (`bg-nav-pill`, below), because it is the same "you are here"
  the phone's tab bar draws and the two navigations have to say it the
  same way; the phone never had the rail, so this is one fewer thing
  the two disagree about.
- **The desktop shell's band is one strip, and the search sits on it.**
  The title bar the shell draws (`components/title-bar`) is filled edge
  to edge in the sidebar's colour, with the way into the quick switcher
  centred on the window and the two keycaps of its shortcut beside the
  words. It was two fills, the sidebar's over the sidebar and the page's
  over the page, which read as two columns that started at the top; one
  band with a control in its middle reads as a top bar over two columns,
  the shape Windows 11 draws (a title bar over a navigation view) and
  the one VS Code and Slack settled on, and the band is the one strip
  that exists on every page at every width. Centred on the window, not
  the page, so it stays put when the sidebar folds. It is a button, not
  a field: typing happens in the window it opens. No rule under it, and
  no glass or Mica behind it: the band and the sidebar are one L of card
  around the toned page, and a material that samples the wallpaper would
  put a second ground behind the cards (the tonal rule). A browser build
  has no band and, by decision, no search control anywhere in its chrome;
  Ctrl/⌘ K and the Home button reach the same window.
- **A phone's hub is a launcher, not a dashboard.** The Puzzles tab lands
  on `#/puzzles/hub` (`puzzles/HubPage.tsx`), which is its destinations
  and nothing else. It landed on the dashboard until that page — stats
  and a 200-row attempt log — had to carry a row of shortcuts at its top
  to get anyone anywhere, which is the corner of a phone a thumb cannot
  reach. Two rules came out of building it, and they generalise:
  a launcher's targets sit at the BOTTOM of the viewport (`min-h-full`
  on `PageShell` and `mt-auto` on the block, so it still scrolls rather
  than hiding a target if the screen is tiny); and anything that arrives
  from the network goes ABOVE the primary button, so a late answer grows
  the block upward instead of shoving a target out from under a thumb
  already moving towards it. Above `md` the route renders the dashboard
  instead — the sidebar lists those destinations already — rendered, not
  redirected, because a redirect leaves a history entry Back bounces off.
- Board and piece appearance are user-chosen (Settings → Appearance):
  board-colour presets ride the same OKLCH tokens, and piece sets are
  vendored from lila. This is orthogonal to the semantic colour grammar
  above — the hues there dress the UI, not the board.
- Filter rows inside a panel are single-line and scroll sideways at
  every width (`ChipRow`): touch pans, fine pointers get chevron nudges
  and wheel-to-horizontal scrolling. Chips are `shrink-0` — a chip that
  shrinks inside a scroller collapses to an ellipsis. A filter WINDOW is
  the exception: given the width, it groups its chips under labels and
  wraps them, because a chip half off the edge of a scroller is a filter
  nobody finds.
- Touch has no hover: anything hover-revealed must also work by tap
  (preview eyes toggle on tap; `pointer-coarse:` sizes tap targets up).
  The floor it sizes up to is 36px for any control, 44px for icon buttons
  and the bottom bar (DESIGN.md, Buttons).

## Waiting

- **Show the shape of what is coming**, not a spinner and not a blank
  page. Each surface sketches its own layout — cards where cards will be,
  the square tile grid where the grid will be, prose where a note will be
  — so nothing moves when the real thing lands. A generic stack of grey
  bars is its own kind of flicker.
- **Say nothing at all if the wait is short.** `useSlowLoad` holds every
  skeleton back 180 ms and then keeps it for 400 ms once shown. A
  placeholder that appears and vanishes reads as a glitch, and it makes a
  fast load feel slower than showing nothing would.
- **Unless holding it back is what moves the page.** That threshold is
  for content appearing INSIDE a block already on screen: nothing moves,
  so a wait too short to notice is best not mentioned. Where the
  placeholder IS the block — a whole panel, or a list that decides its
  panel's height — the choice is not flash-or-nothing, it is
  flash-or-shove, and those draw immediately. A placeholder replaced in
  30 ms moves nothing; a panel that appears after 180 ms pushes
  everything under it down.
- **A placeholder is the size of what replaces it, and the size is
  measured.** Not guessed from the class names: a list shelf card is
  88–90 px because the 64 px board is what governs, a grid one 135 px
  because its text column reserves two title lines and a two-line
  excerpt whatever the words do, a game row 72 px because its three
  lines are 20 + 20 + 16. Compose the
  real thing's own layout constants where they exist — `SkeletonBoard`
  builds from `BOARD_WIDE_SHELL`, `BOARD_MAX_W` and `BOARD_WIDE_SIDE`
  rather than from something that looks like them, because a copy drifts
  the first time one of them moves.

  And a measurement is itself a copy. The grid card's excerpt was
  reserved at one line on the strength of the 88–90 px above, which was
  taken when the excerpt WAS one line; the clamp went to two and the
  number stayed, so every card row in the grid stood 21.5 px short until
  it was measured again. A figure in a comment is only true of the
  element it was taken from on the day it was taken. Re-measure when the
  element changes, and say in the comment what was measured and where —
  the reservation modules do, which is how this one was caught.
- **A block with nothing in it yet is not a block with nothing to show.**
  An empty array reads the same whether the answer said "none" or has not
  arrived, and a panel that announces "nothing solved yet" to somebody
  with a hundred solves is worse than one that waits. Track the ANSWER
  arriving, per block, and hold each one's own placeholder until it does.
- **A panel that a fetch has to finish before it exists must not own a
  second fetch.** Whatever it asks for on mount cannot start until the
  first answer is back, so two independent questions are asked one after
  the other. The page that owns the first one owns them both, side by
  side. The Databases page had its PGN files listed by the panel the
  databases list mounts: on an emulated 200 ms link they landed 242 ms
  apart, and asked together they land together.
- **Cover the wait that actually exists.** Data arriving is not the same
  as content appearing: a big book's list answers in 48 ms and then takes
  most of a second to build, so the skeleton is keyed on the grid being on
  screen, not on the fetch being done.
- **Arrive whole.** The shelf decodes its covers before drawing, rather
  than laying out cards and filling them in one at a time — bounded, and
  skipped once cached, because a cover is a nicety and must never be
  something a page waits on.
- Route chunks are not loaded through Suspense, and data never is. A
  boundary that has committed a fallback cannot reveal what replaces it
  for 300 ms — React's reveal throttle, there to stop a spinner flashing
  past — and `React.lazy` always commits one, because it calls its loader
  during the render it is being drawn in. Measured on a cold launch, that
  was 285 ms in which the page was fully rendered, its chunk long since
  arrived, and it could not so much as ask for its own contents. So
  `lib/lazyRoute` fetches the chunk itself and holds the same blank box as
  ordinary state, replaced the moment the module lands. Holding the FIRST
  RENDER for the chunk instead was tried and rejected: on a throttled
  1.6 Mbps link the extra download pushed the webfonts behind it and first
  contentful paint went from 3.1 s to 4.5 s. Draw the app's own frame on
  time; fill it as soon as there is something to fill it with.
- **A page has one outline, and it is not in the chunk it stands in
  for.** A page can be waiting on two things — its code, then its data —
  and for a while those drew different pictures: a table in the shell
  guessed each page's shape for the first wait, and the page drew its own
  for the second, so a cold tap on a slow link rearranged the column
  twice. No router works that way. Next's `loading`, TanStack's
  `pendingComponent` and React Router's `HydrateFallback` are each ONE
  loading component per route covering both waits, and each keeps it out
  of the route's own chunk — TanStack leaves `pendingComponent` out of
  the default split groups on exactly that argument, and React Router
  splits `Component` and `HydrateFallback` into separate files fetched in
  parallel. So every route here names an `outline` (`lib/lazyRoute`): its
  own module beside the page as `<Name>.skeleton`, fetched at the same
  moment and a fraction of the size, so it lands first — and imported by
  the page for the page's own wait. One picture over both. It costs the
  launch nothing, which is the point of the parallel chunk: measured on
  the Settings outline, drawing it is 6 chunks and 6,730 gzipped bytes
  against the page's 14 and 61,737. `check:repo`'s build-time sibling
  refuses an outline that has drifted into the launch payload, because
  that failure is invisible — the bytes move, the placeholder stops
  appearing, and the app looks the same.
- **What an outline may not do is guess. What it may not do either is
  refuse to look.** It draws what the page draws, out of the same
  components and the page's own reservations. "Or it draws the shell and
  the name and leaves the body alone" was the escape hatch, and it was
  taken far too often: fifteen routes reduced to a title, four drawing
  nothing at all, and Puzzles drawing a page heading over a trainer that
  has none. The test is not whether a shape is easy to reach from here —
  an outline module can import anything the page can — it is whether the
  shape is KNOWN before the answers are. Nearly all of it is, and by
  three routes:
  - **The real control, held inert** (`skeletons`, `Inert`), wherever a
    control's shape does not depend on data. A shelf's sort select with
    the order this device chose in it, the games page's tab strip and
    filter rail, the editor's Position card, the drill's New game form.
    A grey box of the control's size is a second statement of its
    geometry and has to be re-measured every time the control moves.
  - **The page's own reservation**, wherever a count or a size was seen
    last visit: the shelves' cards, the themes histogram, a book's page
    shape, the endgame picker's groups, the licence chips. A paint hint,
    wrong by at most one visit, corrected by whatever lands.
  - **The same measurement the page makes**, wherever the page measures.
    The games outline draws the same tab strip and puts the same
    ResizeObserver on it, so it folds its toolbar where the page folds
    it. This is what "reserving rows is guessing at their height" had
    been standing in for, and it was not true: the rows follow a media
    query, a stored pin and that one measurement.
  What is genuinely left to the page is the part that would be a guess
  and the part that arrives into empty space BELOW everything the
  outline drew: the games page's details card, the dashboard's lower
  panels, the workspace's board budget. Say which, in the module, with
  the reason.
- **The placeholder is drawn once and filled in, never drawn twice.**
  `lib/lazyRoute` draws the outline as ordinary state through the same
  `useSlowLoad` every page's skeleton uses, with two figures of its own:
  up after 200 ms and kept 500 ms once up, or up from the first frame
  inside a page transition. The guides disagree on the delay (Apple: none,
  placeholders at once; Android and eBay: 500 ms; Nielsen: feedback by one
  second; Material: no number), and 200 sits between Apple and the rest: a
  warm chunk lands in 50 to 90 ms and never shows it. The stay is TanStack
  Router's default. When the chunk lands the page mounts UNDER that
  outline and starts its own wait, and `routePlaceholderShown()` is what
  the page ORs into its own gate so the 180 ms delay does not open a hole
  between the two and blink the picture out and back. Measured at
  1.5 Mbps: the outline is up at 245 ms, the page arrives when it did
  before, and an unthrottled tab never shows it (Studies drew at 88 ms).
  `npm run shots:placeholders` is what photographs all of this; the pixel
  grid cannot, because on the demo every chunk beats the 200 ms. It takes
  THREE pictures a route — the chunk held, then the answers held, then
  settled — because "one picture over both waits" is precisely the claim
  that the first two are the same picture, and holding the chunk alone
  cannot tell you. `npm run check:skeletons` reads the same three states
  as landmark positions and fails when anything drawn in two of them has
  moved, and when a route's outline and its wait share no landmark
  INSIDE the page, which is what a placeholder standing over a different
  page looks like: the endgame drill's drew a document's row, a third
  pane and a panel called Moves over a trainer, and shared only the skip
  link and the toast layers with it. It runs in CI beside
  `check:contrast` and `check:page-turn`.
- **A section is warmed before it is asked for.** The placeholder covers
  a cold chunk; `lib/prefetch` sees to it that few are cold. Once the app
  has loaded and the browser is idle, the sections' chunks are fetched
  one section at a time (a section's own imports still arrive together,
  which is how modules load), the three phone tabs first, then the
  board, then the sidebar's order; and a sidebar row fetches its section
  on hover, which is TanStack Router's default and Next.js's on
  viewport. Nothing is warmed on a 2G link or where the user has asked
  to save data. Measured on the demo at 3 Mbps: the sweep runs 5 s
  after the home page is up and the first tap on Games then draws in
  97 ms with no placeholder, where the same tap on the previous build
  drew a bare box; the home page itself arrived at the same time on
  both.

## Kept pages

A page comes back as it was left. The last three sections a reader
visited stay mounted while another is open, and a section's list stays
mounted under the document opened from it, in React's `<Activity>`
(`lib/keep-alive`): hidden with `display: none`, state and DOM intact,
effects paused. Back from a note lands on the shelf at the card it was
scrolled to, with the search field and filters as they were and the rows
already drawn; a tab returns its section to the page it was on, and a
second tap on it goes up to the section's root. Nothing is refetched
before the first paint; the list's load effect runs again on show and
revalidates behind the rows.

What is kept is a budget, not everything: three sections, the least
recently shown evicted first, and never the board, the workspace or the
editor, which hold their state in stores or a snapshot of their own and
are the heavy trees. Leaves (a note, a study, a book, a trainer) are
never kept; keyed by id, two documents are two mounts. Measured on the
demo, 2026-09-14, after seven sections with three kept: 12.7 MB of heap
against 12.0 on a phone, 16.6 against 13.8 on a desktop.

Two rules for a page that may be kept. Its load effect must revalidate
without blanking, since effects run again on every show, not only on
mount (`NoteList.refresh` keeps `loaded` true through a refetch). And
anything that must not survive the hide, an open menu or a selection
mode, closes in a layout-effect cleanup, which runs as the page is
hidden. The slot itself puts every scroller the reader moved back where
it was, because Chromium kept a plain div's position through the hide
but dropped the games list's; the measurement is in `lib/keep-alive`.

## Dialog policy

One dialog per concept, shared everywhere. "Load position" (FEN, PGN,
or image via the corner-adjust photo flow) is a single component used
by the Board, studies/games, and the editor — only the destination
differs. Modals use the same scrim + panel pattern, close on Escape and
scrim-click.

Three sizes, one look — one component. Every window is shadcn's
`Dialog` with the app's `DialogContent` (`components/ui/dialog`):
`size="sm"` is the small centred card every one-question window is built
from (a confirmation is `AlertDialog`, the same card with the alertdialog
role); `PromptDialog` is that plus a field (new study, new note, new
book, every rename); the default size is the same card at window width
for anything larger (import PGN, the PDF import, the explorer's filters),
and `size="full"` a wide one on a desktop. On a phone every one of them
is the bottom sheet, but for a question (`ask`: a confirmation, a
one-field prompt, the leave question), which is a centred card on every
phone; "Platform-specific design" says why. Anything that is not a single line is one of these
rather than a panel that grows in place.

None of them — nor any `PanelHeader` — draws a rule under its title: the
registry's card header and its dialog title row are both rule-less, and
the two agree. (Windows once had no rule while panels did, which made
the same app look like two; the panels' rule went with the old look.)

The way out is a **Cancel**, stated in words, next to the thing it
cancels. Escape and the scrim also close, but neither is advertised. A
window whose changes apply as you make them (the filters) offers
Cancel — restoring what was there when it opened — beside Done. The
one-field prompt is the exception on a phone: its sheet carries the
handle, which is the advertised way out there, and a Cancel beside the
single answer was a second button for the thumb to tell apart, so the
answer takes the whole row and Cancel is a desktop control.

A sheet may have **resting heights** (`snapPoints` on `Dialog`): a
drag stops at the nearest one instead of closing, and a drag past the
lowest still closes. It is for a sheet over a subject that the sheet
otherwise covers entirely: the opening map's move panel opens at its
full height and rests at half the screen when pulled down, with the map
in view above it. A form is not a candidate; its buttons are at the
bottom, where a lower rest would put them out of reach. The move between
two rests rides the same spring as the entrance. The lower the sheet
rests, or the further a finger has pulled it, the more it becomes a
card: its top corners round further, as a multiple of the xl rung, so
the Corners setting scales the whole curve and Square stays square at
every height; it stands a few pixels in from the edges, flush at full
height; and its bottom corners round from nothing.

The rule was once "never an X in the corner". Since every window became
shadcn's Dialog, every titled window carries the registry's X on
**desktop only** — a mouse has no gesture, and for a window with no
button row (a list of settings, which applies as you touch it) it is the
only visible way out. An Android phone shows none: the sheet drags away from anywhere
on itself, which is the gesture it was given instead. An iPhone sheet carries one
in its band's trailing corner, as a glass circle, since a `fill` sheet leaves the
scrim a strip and there is no Back inside a sheet (2026-09-21); the centred `ask`
card takes none on either phone.

**The X means out, and never back.** It shuts the window it sits on and
every window that one was opened inside, so it says the same thing on
page three of a chain as it does on page one; the footer's Cancel is the
same verb in words and does the same. It was the primitive's own Close,
which shuts one Root — and one Root is one page here, so on a nested
page the X uncovered the parent and became a second chevron pointing the
same way. Back is the chevron's job, and only the chevron's.

The exception is a window that was opened to ask ONE question, where
Cancel is an answer rather than an exit: a confirmation's own buttons
(`AlertDialogAction`, `AlertDialogCancel`), and a window a panel opened
to ask something about what the panel is showing — the opening map's
Grow, whose Cancel means "do not grow this move", not "close the move
details behind me". Answering hands you back what asked, which is the
point of asking. The test is whether the parent is still the subject: if
cancelling leaves you looking at the thing you were working on, it is an
answer; if it leaves you looking at a window you had already finished
with, it is the Back button in disguise and belongs on `dismissAll`.

**A window may turn its own page rather than open another.** A sheet
that needs to show a detail — the contents of one earlier version, say —
sets `DialogContent`'s `onBack` and replaces its own body, and the
chevron in the top-left corner turns the page back. Escape and Android's
Back go to the previous page, not out of the sheet. This is the same
control, in the same corner, that a small window grows once it has hidden
the window it was opened over, and the same one a window's second page
(a default-sized dialog written inside another) uses.

Reach for it before a second sheet. Two stacked windows for one train of
thought is a layer too many: the question underneath is still there,
dimmed, and answering the top one leaves you looking at a window you have
already finished with. A second page that shows the thing being acted on
is also the better confirmation — it names what will happen to WHAT,
where a generic "are you sure?" over the top can only name the action.

And a confirmation is worth having only where something can be lost.
Restoring an earlier version of an open document overwrites what is there
and is confirmed on that second page; restoring a deleted one puts back a
file that is absent and asks nothing, because a question in front of an
action with nothing to lose is how questions stop being read where they
matter.

The row-actions sheet (`ActionMenu`'s Android phone half; on a desktop
and on an iPhone it is shadcn's DropdownMenu under the ⋯, see
"Platform-specific design", and `ActionContextMenu` the same verbs
at a right-click) is the exception, and it proves the rule: it is a list
of verbs with no button row of its own, so there is nowhere for a Cancel
to sit that is not itself another verb. It carries a grab handle and
nothing else, and the handle is honest — every sheet on a phone is pushed
away by dragging it from anywhere on itself. It carried an X beside the
handle for a while, from back when the drag was a promise the sheet did
not keep.

Autofill is off in every field (`Input`, `Textarea`, or the exported
`noAutofill` props for the few bare inputs). `autocomplete="off"` is not
enough: Safari decides from the field's own words and offers to complete
a "name" with a contact, so a plain text field is rendered as
`type="search"`, which it never offers contacts for.

## iOS keyboard: do not fight it

Three attempts to outsmart the keyboard (scroll-pinning, focus
pre-scrolling, shell resizing) each produced a worse artefact than the
native behaviour. Settled rule: never move the PAGE while the keyboard is
up; reset window scroll only on the viewport resize that signals it
closed.

Refined, not repealed, and the refinement has a boundary that was found
the hard way.

**A transient dialog may live in the visual viewport.** `PromptDialog`
centres inside `visualViewport` — the part of the page the keyboard has
left visible — rather than pinning itself to the top. That moves the
dialog, not the document underneath it. Only its padding responds and
nothing is transitioned, so it never animates against iOS's own
animation.

**A persistent toolbar may not.** The note palette was built that way
first and failed twice over: iOS already puts its own accessory row
(prev/next/Done) immediately above the keyboard, so the bar competes for
that strip; and because the bar is fixed, the last line of the document
— and the caret in it — end up behind it with nothing to scroll. Padding
the document helped and did not fix it. Editing toolbars go at the TOP of
the document instead, sticky, where nothing else is claiming the space.
Confluence does the same, for what appear to be the same reasons.

The distinction is dwell time. Something that appears, takes one value
and closes can borrow the space above the keyboard. Something that stays
for as long as you are editing must not.

Any change here requires an on-device test loop — desktop cannot
reproduce it, and the automated browser cannot either. The keyboard-bar
palette looked correct on an iPad and was wrong on an iPhone.

## Motion

One spring, two directions. Everything that moves from one resting
state to another (the pane turn, the strip's pill, a sheet rising, a
page sliding in) settles on the spring in `lib/spring.ts`, sampled into
`--pane-turn` and `--pane-turn-ease`. Everything that leaves (a sheet
dismissed, a page popped, the old page under a tab switch) takes the
same trace run backwards, `--pane-turn-ease-out`: slow off the mark and
gone at the spring's own peak speed. A thing leaving on the entrance
curve lingers at the edge; both Apple's and Material's guidance ends an
exit at full speed, and this is that without a second physics. Exits are
shorter than entrances (200ms against 337ms). A test holds both tokens
to the spring.

The phone's page changes, chosen against the two platform guides and
measured on the demo: a **tab** switch is a cut. It was a fade-through,
and in use the fade read as the screen flickering, so it went
(2026-09-13). A **push** slides the new page in from the right over the
old one, which slips a third of the way out and darkens, with no fade on
either, the way iPhone does it; a **pop** is that in reverse. The
router reads the shape off the two
routes' depth, so a chevron that `navigate`s to its list still plays as
a step up. A browser-driven history move (the iPhone edge swipe) plays
no transition, because Safari has already played its own.

The turn is React's `<ViewTransition>` on each kept route slot
(`lib/keep-alive`), not the browser's on the root (2026-09-14): the
router commits the route inside a Transition typed `nav-push` or
`nav-pop`, each slot animates its own snapshot, and a pop flies the
page's board back into the thumbnail it came from when that thumbnail
is still there (`lib/shared-board`; 360 px at the page to 64 px at the
card, which the root transition never did). Two things hold it up.
React hands back no promise for the transition it starts, so the router
catches the one call to `document.startViewTransition` to answer
`routeSettled`. And React skips a pending view transition when anything
calls `flushSync`, which Base UI does on a hover-driven popup change and
at the end of a popup's exit animation. So every popup is closed by the
router before the turn starts (`lib/popups`): the tooltip is controlled,
closes with no exit and is deaf to hover while the turn plays; the
Popover, DropdownMenu, ContextMenu and Select roots register their close
while open, and `index.css` turns a popup's closing animation off while
the root carries `data-nav`, so Base UI sees its end inside the router's
own flush, before the transition exists to be skipped. A popup that was
already closing when the turn began is not on that list, having stopped
being open when its verb was pressed, and the stylesheet's `none` only
lands at the browser's next style pass, inside the turn; so the router
also finishes any exit still running on those four roots, which resolves
it in a microtask before React renders the transition (`lib/popups`,
2026-09-20). On an Android phone every one of those is a bottom sheet,
which the parent unmounts on choose. On an iPhone a row's menu is the
DropdownMenu, and this is the path it takes on every verb that
navigates: a book's Read verb turns the page about 150ms after the
press, and the turn played with a 100ms exit and was skipped with a
200ms one until the router finished it.

An iPhone's **menu** grows out of its button and goes back into it on
the same spring: from half size at the corner Base UI anchors it to,
over `--pane-turn` in and 200ms on the reversed trace out. Desktop keeps
the registry's 100ms pop from 95%. Measured on the demo at four times
CPU throttle, the frames during the open are the same as under the old
animation (one long frame as the menu mounts, then 16.7ms); what a
scaling glass surface costs the phone's compositor is owed from the
device.

A **sheet** slides from the bottom edge and does not fade; only the
scrim fades. The one sheet that raises the keyboard as it opens rises
too, from a length the keyboard cannot change: its height changes under
it while the keyboard comes up, and a slide measured from that height
jumped, so for one release that sheet did not slide at all. It now
starts a full viewport height down (`100dvh`), which is off screen
whatever the sheet's box does. Recorded on the demo, it animates like
any other sheet; against a real iOS keyboard it is still unchecked, and
if it jumps there the cause is not the one this fixed.

A sheet leaves the same way however it is closed. The wrapper holds the
exit for a close that comes through it (the scrim, a drag, Back; the
note at the top of `components/ui/dialog.tsx` says how it makes the
primitive see the close), and a window's own answer asks for the same
hold with `useDialogDepart`: a prompt's Done and a folder picked in Move
to used to go straight to the caller, which unmounted the sheet in that
commit, and the sheet that slid away when dismissed was cut when
answered (2026-09-20). On a phone the answer runs once the sheet has
left. A window that closes itself on a choice of its own should do the
same.

A prompt's sheet can be dragged while its text is selected. The Drawer
ignores a swipe while the focused field has a selection, to leave the
selection's handles alone, and a prompt selects its whole value as it
opens; a touch that lands on the sheet and not on a field collapses the
selection first (`releaseFieldSelection`).

A **press** is colour, not scale: a touched button or row takes the
tint it would have under a mouse, plus the registry's 1px nudge. A
control that shrinks under the thumb is a hover idiom the thumb hides.
Content that replaces a **placeholder** fades in over it (150ms, phones
only); content that never showed a placeholder mounts as it always did.

Reduced motion: the router never starts a page transition, the global
clamp flattens every transition and animation to a cut, and only the
gesture-tracked motion (a drag under the finger) and the two status
indicators keep moving. Nothing new may escape that block.

The clamp sets a duration, though, not a property list, so what it
leaves behind is a 0.01ms transition on `all` — and that is a cut to the
eye but not to a script. Code that writes a size or a colour and reads
it back in the same task gets the value from BEFORE its write, because
the transition it just started is at its first frame. So the two places
that measure their own writes are exempt from the block rather than
clamped by it: the board's `cg-container`, which chessground resizes and
then lays all 32 pieces out from in one ResizeObserver callback, and the
document's ground, which `store/theme.ts` reads back to pin the launch
colour. An exemption of that shape takes motion away rather than
granting it; it is the other direction the block still closes.

## The component layer

The app is a shadcn/ui project (`components.json`: the base-nova style,
Tailwind v4, CSS variables). What that means here, and what it does not:

- **`web/src/components/ui/` holds the registry's files, ours to keep.** Button,
  Input, InputOTP, Textarea, Label, Field, InputGroup, Checkbox,
  RadioGroup, Slider, Dialog, AlertDialog, DropdownMenu, ContextMenu,
  Select, Popover, Tooltip, Tabs, ToggleGroup, Toggle, Switch, Progress,
  Spinner, Skeleton, Empty, Card, Badge, Separator, Calendar, Toast, Command —
  each the shape
  `npx shadcn add` writes (Base UI underneath, `cva` variants, `data-slot`),
  each in the registry's own face (the nova style: its sizes, radius
  ladder, focus rings, the inverted tooltip, the card that is a ring
  rather than a border — drawn in `--border` here, not the registry's
  fixed `foreground/10`, so the contrast schemes can reach it) and
  carrying this app's physics on top: every window a bottom sheet on a
  phone, dragged away from anywhere on itself; the page/layer distinction
  and the back chevron; the keyboard band; the sole-text-field focus;
  Android Back through CloseWatcher; the coarse-pointer hit areas;
  `title` as a tooltip. The look is shadcn's; each file says at the top
  what it adds and why. Adding a component is `npx shadcn add <name>`;
  it needs no restyling. These files are app code otherwise: they take
  the same refactors as any other (the React Compiler compiles them
  too, since 2026-09-14), so re-adding one from the registry is a diff
  to read against the file in hand, not a rewrite to accept.
- **"Owned" means behaviour on top, not geometry underneath.** Card is the
  worked example of getting this wrong: its root had been rewritten to
  drop the registry's padding and gap, which reads like a small local
  decision and is in fact a rule every call site then has to re-derive —
  see the panel spacing note under Layout rules. The departures that
  survive in that file are the ones that cost nothing structurally: the
  slots are semantic elements (`section`/`header`/`h2`) rather than four
  `div`s, and the title uses this app's `font-heading` token because the
  registry's `cn-font-heading` class does not exist outside its own
  stylesheet. Before changing a registry file's layout classes, check
  which of its rules the call sites are relying on it to provide.
- **`web/src/components/` holds the app's composites** (Panel, PageShell,
  ShelfCard, ActionMenu, PromptDialog, Disclosure, the skeletons …), built
  from the primitives; **`web/src/hooks/`** the window physics they share.
- **The no-hand-rolling rule is about OVERLAYS.** A second popover, menu,
  dialog or tooltip beside a Base UI one is two focus stacks on one page,
  which is the whole objection. A disclosure is not that: it opens nothing
  over anything, reveals siblings in the flow, and leaves focus where it
  was. `components/disclosure.tsx` is therefore hand-rolled on purpose —
  the game form's "Advanced details" markup, lifted verbatim when Settings
  needed a second one, rather than a registry primitive pulled in to do
  less. Its button and its content are siblings, not a wrapper around a
  box, so both call sites keep taking their spacing from the flex column
  they sit in.
- **Duplicated geometry is a bug waiting for a flipped board.** Three
  overlays each derived a square's place on the board as drawn, and the
  heat map spelled the rank `Number(sq[1]) - 1` where the two badges used
  `charCodeAt(1) - 49`. Nothing would have reported a disagreement — a
  badge on the wrong square is still a badge. `board/square-overlay.tsx`
  holds `squareToGrid` and the `SquareBadge` disc above it; the caller
  passes the fill and the glyph and nothing else.
- **The theme is the registry's vocabulary and, at rest, its values** —
  `bg-card`, `text-muted-foreground`, `border-input`, `bg-destructive` — so
  a component added tomorrow is themed the moment it lands. The default
  scheme, Neutral, IS shadcn's neutral theme (white page, grey surfaces,
  a near-black primary) in light, and its vocabulary with the app's own
  ladder behind it in dark, where the registry's 14.5 / 20.5 / 26.9 % is
  replaced wholesale by the anchors above; the
  values are written as the app's OKLCH ladder in `styles/tokens.css` with the
  hue, tint and contrast knobs as lerps, so Settings → Appearance keeps
  tinting them (Blue is the app's previous look) and there is no second
  palette. Several roles depart from the registry's numbers, every one of
  them measured. `--accent` (the pressed, selected and highlighted fill)
  is a rung above `--muted` (the hover fill) instead of the same rung,
  because a pressed toggle on a card was 3% of lightness from its
  surroundings in the light and 6% in the dark and could not be seen —
  92.8% and 37% now. On the page ground the light tone is a hazard the
  other way: `--secondary` and `--muted` are the light page's own 97%,
  so a secondary button, a progress track or an empty state's tile
  standing on the page rather than on a card drew nothing (1.00:1 on
  eight pages, 2026-09-12). An element that stands on the page says so
  with `data-ground` (a page header's rows, a gate, a toolbar), and
  under that mark `index.css` points both roles one rung up, at
  `--surface-3`; dark keeps its values, since there the page already
  sits below the card. The mark goes only on boxes that hold no card,
  because a card under it would take the rung too; the ghost button's
  hover read the same mark first. The dark `--input` is shadcn's own translucent
  white, which the chosen tab's pill (`dark:bg-input/30
  dark:border-input`) depends on: over the muted track an opaque grey at
  30% was the track's own colour. In light the page is a 97% tone and
  the cards white on it, so surfaces separate by fill and the card's
  ring (`--card-ring`) is transparent until the contrast knob asks for
  it; the page was white with a ring round every card until a mockup
  over the demo retired that (lanph3re, 2026-09-07; since 2026-09-08 the
  rule outranks the registry's own strokes too: a card's footer band takes
  `--card-ring`, and every window, dialog, popover, menu and toast, takes
  `--window-ring`, the card ring in light and the plain hairline in dark,
  where a shadow is invisible and a window's fill is a card's), and which
  PROPERTY carries that colour is not a free choice either: a card takes
  `ring-1`, as the registry's Card does, and a border is for a stroke on
  one side or on a filled well or a thumbnail. A ring is a box-shadow and
  costs no layout; a border is 2px of box. Cards drawn both ways look
  identical and measure 2px apart, so nothing reports it and every
  placeholder that stands in for a card rediscovers it by measuring —
  `skeletons.tsx` carried three separate comments recording the same 2px,
  one per shelf, before the shelves' cards moved to the ring, and the structural
  strokes had moved as a set while it was, because the hairline was then
  the only structure there was: `--border` rests at 88% rather than
  92.2% (1.26:1 on white was not visible on a phone at all; 1.44:1 now),
  and it still draws every other stroke,
  `--border-strong` follows to 82% to stay a distinct rung, and
  `--text-subtle` to 51.5% from 53%, which had measured 4.25:1 on
  `--surface-3` under a comment claiming a clearance the arithmetic
  never supported. The primary's lightness follows the accent knob: grey is the
  registry's near-black, a coloured accent sits mid-scale. Settings offers
  the schemes as one dropdown in three groups — shadcn's five base colours
  (Neutral, Stone, Zinc, Gray, Slate), the app's tinted ones, and High
  contrast — and a radius knob, `--radius`, the one number the corner
  ladder derives from. What the ladder says that shadcn has no
  word for keeps its own name in the same style: `surface-3`,
  the colour grammar (`good`/`warn`/`info`) and the board and eval
  colours; the ladder's own rungs (surface-3, surface-inset, text-subtle,
  border-strong) are variables, not utilities. A preset theme pasted over `:root` would
  override the roles but not the ladder they derive from, so the knobs in
  Settings would stop reaching them — re-express a theme in the ladder.
- **Which rung of the corner ladder a surface takes follows what it
  is.** A window takes `xl`: the cards, the desktop dialog, and the
  phone sheet that same dialog becomes. A menu takes `lg`: Popover,
  DropdownMenu, ContextMenu, Select's list, and the text fields beside
  them. What sits INSIDE one of those takes `md`: a menu row, a select
  row, the icon chip in an alert, the tooltip (a label, not a surface),
  and the buttons, which cap the rung at 10 or 12px where a full one
  measured too round for its row. Toast is the one deliberate exception
  at `2xl`: it floats over everything and belongs to no page. This is
  written down because the sheet spent 0.4.7 to 0.9.3 on the menus'
  rung. It had been `rounded-t-2xl`, and the sweep that replaced
  app-chosen values with the registry's stock ones could not tell a
  deliberate corner from a leftover and dropped it two rungs, while
  `sm:rounded-xl` on the next line survived untouched because `xl` was
  already stock. One component then changed rung when it changed shape,
  and the sheet sat 4px shy of every card behind it at the default knob
  and 6.4px at Large, since both sides scale off `--radius` (put back on
  `xl` 2026-09-10). A new surface takes the rung its kind already has;
  one that wants another says why, here.
- **One focus ring, the registry's shape at the app's strength.**
  Components draw shadcn's `focus-visible:ring-3` and turn the outline
  off; everything that is not a component (a bare button, a link) gets
  the same ring from the global `:focus-visible` outline in the same
  colour, so a page has one focus style whichever kind of control has
  it. The colour is `ring-ring` at FULL alpha, not the registry's
  `ring-ring/50`, and `--ring` is placed by measurement rather than by
  eye: 3:1 against every surface the ring can land on (page, card,
  popover, muted, surface-3), in both themes, at every point of the
  contrast knob and in every tinted scheme. WCAG 1.4.11 asks that of a
  focus indicator and PRODUCT.md's yardstick is 2.2 AA; the 50% wash
  measured 1.35 to 1.60:1 in light and 1.72 to 1.88 in dark over 1,636
  tabbed stops, which on a bright screen is no indicator at all. What
  binds the token is the selected fill an inset ring is drawn straight
  onto (`--surface-3` in light, `--accent` in dark), and
  `check:contrast` now holds a focus indicator to 3:1 at any alpha it is
  drawn at, including the one global rule that draws the ring for every
  control that is not a registry component, so neither the next retune of
  a surface nor a ring quietly thinned back to a wash can take it away
  again. The same token paints the slider thumb's edge at rest and its
  hover halo, which moved with it, and its focus halo, which had to be
  hung on `has-[:focus-visible]` before it painted at all; `slider.tsx`
  records what they measure.
- **Anything pinned over a scroller tells it so.** A ring at 3:1 is not
  an indicator if it is painted underneath something. The browser's own
  scroll for Tab and Shift+Tab stops as soon as a control is inside the
  scrollport, and a pinned band is inside the scrollport too, so the
  settings section row hid whatever Shift+Tab landed on at the top of
  the page (0 of 1,260 ring pixels visible), the note's header hid a
  board's controls, and a phone's create disc hid a card's and a game
  row's more-actions button. `scroll-padding` is the property for that,
  and its number is the band's OWN measured height, published to the
  scroller by `hooks/use-pinned-band` and read back in `index.css`. So a
  60px row, the 84px that row becomes when it wraps and a 65px document
  header all clear themselves with no constant written down: a band that
  grows grows the clearance, measured live at 60px to 132px as names
  were added to the settings row. The shelves' floating disc was the one
  that is not inside the scroller, and there the room it reserved did
  the telling, until the disc itself went to the header and the room
  with it.

## Platform-specific design

The app drew one UI on every platform until 2026-09-18, and the phone
chrome was judged by what both platforms would accept: the iOS 26
floating tab bar was rejected in 2026-09 as "iOS-only form for a
cross-platform app", and hide-on-scroll and the capsule with it. That
rule is retired (lanph3re's call, 2026-09-18). The phone shell may now
take the idioms of the platform it is running on, and a proposal is
judged against that platform's own guidance rather than against the
other's. What follows is which platform owns what, how a variant is
drawn, and what one has to prove.

- **Three platforms, one attribute.** `lib/platform.ts` decides once at
  launch, before the first render, and writes `data-platform` on the
  root: `ios`, `android` or `desktop`. The desktop shell, a browser on a
  desktop and anything unrecognised are `desktop`. Two custom variants
  read it, `ios:` and `android:` (`styles/variants.css`), and they stack
  on every existing class the way `md:` and `keyboard:` do. There is no
  second component tree: an iOS look is a variant on the shadcn file the
  registry wrote, in the registry's vocabulary, which is how the phone
  sheet and the coarse-pointer hit areas already ride on those files.
  A component branches on the platform in TypeScript only where the
  geometry differs, never to pick a colour. The bar's own geometry is
  already shared: it is an overlay on the shell's row that measures
  itself, and `main` pads by `--bottom-bar-h` on every platform
  (`hooks/use-bottom-bar`, `styles/shell.css`), so a floating bar
  changes what is drawn in that band, not how the page is laid out.
- **Detection is one file's problem, and it is a guess kept honest.**
  `main.tsx` said for a year that nothing sniffed a user agent, so there
  was nothing to keep correct as devices changed; that sentence is now
  false in exactly one place. iOS is read from the platform string plus
  touch points, because an iPad has reported itself as a Mac since iPadOS
  13; Android from `userAgentData` where a browser has it and the user
  agent string where it does not. Every other reading in the app stays
  a feature test. A wrong guess costs a phone the other platform's
  chrome, not a broken page, since neither variant removes a control the
  cross-platform layout has. `localStorage` `chess-vault:platform`
  overrides the guess; it exists for the screenshot grid and the
  Settings debug card, not for users, and nothing else reads it.
- **iOS owns its chrome; the content is the same everywhere.** On iOS
  the chrome may follow iOS 26: the tab bar as a floating capsule inset
  from the edges over scrolling content, icons only, and getting
  smaller on a scroll down and whole again on a scroll up (Instagram's
  shape; Apple's own closes to the current tab alone, which read as an
  empty control on the phone; lanph3re's call, 2026-09-18); the compact page header, the contextual action
  bar, the toast and the menus as glass over what is under them (the
  sheet stays opaque: built as glass and tried on the phone, it looked
  worse than the opaque card, and it went back the same day, 2026-09-18); a row's ⋯ menu hung from the ⋯ as that glass menu and not
  risen as a sheet, since iOS 26 anchors every list of actions, its
  action sheet included, to the control that opened it (2026-09-20; one
  hook in `components/action-menu.tsx` decides, and the long-press menu
  keeps the sheet on every phone, having no control to hang from). Its
  rows are 44px under a thumb on every platform
  (`pointer-coarse:py-2.5`, as a Select's are; they measured 32px); the back chevron and a header's icon actions in glass circles, and
  its text buttons (a shelf's Create, Import) in pills of the same
  height, the primary one in its own fill, rather than bare on the page
  (one rule in `styles/shell.css` on the rows marked `data-chrome`,
  reaching the registry button by its own attributes); grouped inset lists with a chevron on every
  navigable row (the More page's groups, one card per group with a
  hairline between rows; the docked platforms keep a card per row); the platform's own switch (the registry's switch under `ios:` variants:
  a 51 by 31px track, green when on from a `--switch-on` token that is
  the platform's colour and not the app's `good`, a 27px white thumb). Android kept what
  shipped that day: the docked opaque bar with the M3 pill, the flat full-bleed
  rows, the registry switch, and the row-actions sheet, which Material
  still offers beside its menu; what it took three days later is in the
  second pass below. Desktop was untouched by this first pass. What
  is INSIDE a card follows the tonal rule on every platform: a card
  resting on the page is separated by its fill, so no material that
  samples the ground goes behind it, and a segmented control or a chip
  row inside a card is drawn the same on both phones. The board, its
  overlays and the pane strip are the same on every platform by the
  rules that already govern them.
- **Glass is one surface, gated three ways.** A translucent surface is
  the glass tint at high alpha over a small backdrop blur with a saturate,
  a one-pixel hairline of the foreground at 12% inside its edge (dark
  in light, light in dark, so the edge shows over content of the
  surface's own colour),
  all from existing tokens, defined once as a utility and never as a
  per-component recipe. It is drawn only under `@supports
  (backdrop-filter)`, taken away under `prefers-reduced-transparency:
  reduce` (as an override, never as a grant under `no-preference`: a
  browser that does not know the feature, Safari among them, reads an
  unknown feature as false, and the grant form left the phone opaque),
  and only on a phone — `max-md:ios:`, not `ios:`, which reaches an iPad
  too and drew a glass menu over a desktop page with nothing else glassy
  on it (measured at 834px, 2026-09-22); under any of the three it falls
  back to the opaque card. Two things beyond the fill belong to the
  utility rather than to its callers. The focus ring: the glass
  box-shadow outranks `focus-visible:ring-3`, so a keyboard-focused
  glass surface changed zero pixels until the utility drew the ring
  itself, in the registry's shape (3px of `--ring`, the border taking it
  too) — the slider thumb's fault over again, and the same fix. And the
  edge width, which a full-bleed surface sets to zero: it is registered
  with `@property ... inherits: false`, because set on the compact header
  it reached the glass circles standing on that header and they drew no
  hairline at all. The alpha and the blur radius are the two
  numbers a glass surface has, and both are set by measurement (below),
  not by eye: 70% where the surface carries text (4.5:1) and 55% on the
  capsule, which carries icons (3:1), 70% in dark. The tint is a step
  AWAY from the ground (`--glass-tint`: 95% grey in light, the third
  surface rung in dark), since glass the colour of the card under it
  was told from that card by its hairline alone; a greyer tint moves
  toward the contrast worst case in both themes, so changing it means
  re-reading both fills (`tokens.css` and `tokens-dark.css` carry the
  readings). Apple publishes no ratio; Liquid
  Glass is a dynamic material, and these are this app's numbers.
- **What a platform variant has to prove.** The screenshot grid
  (`npm run shots:grid`) walks a `phone-ios` state beside `phone`,
  with the override set, so a change that means to be iOS-only shows a
  diff in the `phone-ios` pictures and none in `phone` or `desktop`,
  and a neutral change shows none anywhere. A glass surface owes two
  more numbers. Frame time while scrolling under it, on the phone, Low
  Power Mode off, from the on-device probe in the Settings debug card:
  the bottom bar was made opaque in 2026-09 because a full-width 24px
  blur was re-blurred on every scrolled frame, and that is the reading
  a glass bar has to beat. And contrast: text over glass has no fixed
  ground, so `check:contrast`'s theme reading proves nothing about it,
  and the surface is sampled over a dark board square, a diagram and a
  dark note before its alpha is settled.
- **The second pass, 2026-09-21: what each platform took, and what
  turned out not to be a platform's at all.** A sweep of the registry
  files against the HIG found controls iOS does not have, and a second
  sweep found the other two platforms a release behind it. Three things
  that were built as `ios:` came back out from under the guard, because
  they are every platform's idiom: a QUESTION is a centred card on every
  phone and not a rising sheet (`ask` on the Dialog root takes the Dialog
  primitive instead of the Drawer; iOS draws it as iOS 26's own alert,
  300px wide on the 4xl rung with 20px of padding all round, a started
  17px title over a 15px message, no icon and no action band at all, and
  its answers as 48px capsules of equal width side by side (stacked when
  there are three, the leave question), the destructive one the same
  quiet capsule as Cancel with the destructive ink; Android as Material's basic dialog,
  312px, started text, text buttons in an end-aligned row; the scrim
  still closes it, as every small window here does, and "Dialog policy"
  carries the exception); the segmented track's raised thumb SLIDES
  wherever a track is drawn, placed by measuring the pressed item so
  unequal segments work (only drawing a `row` as a track, and equal
  widths, are iOS's); and a setting is a ROW, label and blurb on the
  left and a control at its own width on the right, on every platform
  (`SettingRow` with `control="wide"`), which the two phones then group
  in their own flavour from one place, `SettingsCard`: iOS one inset
  card per group with hairlines from the label's edge and 44px rows,
  Android a card per row with a 2px gap, large outer and small inner
  corners, no hairline and 48px rows. iOS also took: the multi-select
  mark as a 22px circle and one-of-many as a grouped list with a
  trailing checkmark (`ui/checkbox.tsx`, `ui/radio-group.tsx`); the
  compact date picker (a muted capsule, a month grid of circles from
  44px down to no less than 36px at 320px, the dropdown caption kept
  and restyled so a date a century back is one tap); the eight-spoke
  activity indicator, the one place a variant picks its drawing in
  TypeScript, since both drawings in the DOM would double thirty call
  sites; a 6px slider track under a 38 by 24 capsule thumb; a press that
  dims, 80% filled and 60% unfilled, instantly in; an empty state as one
  48px muted symbol; the glass Cancel beside a sheet's search field; a
  sheet's own close as a glass circle in the band's trailing corner, the
  one exit an iPhone sheet was missing; and
  the system face, `-apple-system` with Apple SD Gothic Neo, set once on
  `--font-sans-stack`, Pretendard last in the stack for the figurines,
  the wordmark pinned to `--font-brand`, and no tracking added to it.
  Android took Material 3 Expressive's shapes: header icon actions as
  40px round buttons and text actions as 40px capsules in the fill their
  variant already has, the back chevron bare; a press answered by a 10%
  state layer and a corner morph to 12px (a radius that morphs is
  written as a number, since `rounded-full` is `calc(infinity)` and
  cannot interpolate) and no ripple, which would be a second clock; a
  page's claimed controls as the floating toolbar, a 64px pill hugging
  its content 16px over the inset, while the docked navigation bar is
  unchanged; the FAB as a 56px rounded square; the loading indicator,
  one path morphing through five generated shapes, at `size-5` and up
  only, since at 16px a morph reads as a wobble; and a linear bar with
  rounded ends, a gap and a stop dot, the wavy track rejected at 4px.
  Android keeps Pretendard: it is the app's own face on that phone
  already, and Roboto offers no argument the way San Francisco's optical
  sizes do. Both phones pull to refresh (`hooks/use-pull-refresh`: only
  at scrollTop 0, only a clearly vertical pull, never in a sheet, on a
  board page or with a field focused; the app's `overscroll-behavior`
  already contained Chrome's own), and each draws its own control, which
  one shared drawing could not: Android keeps Material's raised circle
  travelling over content that stays put, resting clear of the header's
  row, while iOS has no container at all, the bare 28px spoke indicator
  centred in a gap that opens UNDER the page header, the title row
  staying where it is (the header's two elements carry
  `data-page-header`, and one rule moves every other child of the column
  by `--pull-own`), and the content held 56px down until the refetch
  settles. The adopting scroller asks Safari for no overscroll on iOS so
  the app opens the whole gap; where the browser bands anyway the app
  translates only the difference. Two earlier drawings were read on the
  phone and dropped the same day: a circle at a fixed spot, which sat on
  the header's buttons in the middle of the band, and the whole column
  moved with the spinner above the title (lanph3re, 2026-09-21). Both phones share through the system
  sheet where one exists (`lib/share.ts`, a feature test and never the
  platform attribute; only the glyph reads the platform; nothing carrying
  book evidence is shareable). The theme-color metas are written from
  the body's resolved ground on every ground change. The desktop took
  the inset shell: `--app-ground` is the window's ground from md, the
  sidebar and the title band share it without a fill or a border of
  their own, and the page is one `rounded-xl` panel inset in it, so
  every page's interior is what it was and only the frame moved (this
  reopens the white sidebar of 2026-09-07). The frame is a rung UNDER
  the page in both themes: 95% under 97% in light, and 19% under 20.5%
  in dark since the dark ladder was lifted off the floor on 2026-09-22
  ("The colour grammar"). The rule is not about elevation, which would
  have to pick a direction and defend it: the frame steps once back
  from the READING surface, whichever end of the scale that surface
  sits at. It went the other way in dark for a release, and the reason
  was the floor rather than the direction: with the page at 14.5%
  anything under it was black, 11% read as a void with the sidebar's
  labels floating in it (lanph3re, at the real window, 2026-09-21), so
  the frame took `--surface` and the page was the well set into it.
  Raising the page is what made one direction possible in both themes.
  It is the direction Notion draws in light (254 against 247) and
  Linear in dark, its content lighter than its sidebar; shadcn's own
  inset block goes the other way in dark (L* 2.75 page against 7.78
  frame) and with it in light (100 against 98.26), so the direction is
  a choice and not a law. What is not a choice is the size of the
  step. `--panel-ring` draws the panel's edge where the two fills do
  not, which is now both themes: the window ring in light, transparent
  until the contrast knob turns frame and panel both white, and the
  a rung of its own in dark, a shade over the card and well under the
  hairline a card's edge takes: Linear draws this ring at its card rung
  exactly, and 24.5% is the lowest this app reaches before its own 1.2
  stroke floor stops it (1.222:1 over the window ground, where 22.25%
  read 1.16). The two fills are 1.06:1 apart there, so the ring is real
  structure and not decoration, which is also why the floor's
  fill-already-separates exemption does not reach it; a field-shaped Search button under the
  wordmark that opens the quick switcher; a games table without stripes
  (they were recorded for two-line card rows, which keep them) whose
  resize handles show on hover or focus; filters as chips at content
  width shared with the phone's (`games/filter-chips.ts`); Home without
  trailing chevrons under a fine pointer, and an Activity card counting
  solved puzzles by day, counts and never a rating. The desktop window
  can ask the OS for its material (Mica, sidebar vibrancy), and from md
  it is the FRAME that steps aside for it: `--app-ground` goes
  transparent under mica and to a 70% mix under vibrancy, while the
  panel and every surface on it stays as opaque as it is today, which is
  where a native window puts its material too. It ships OFF, from
  Settings, because no window was opened to read it. The grid walks `phone-android` beside `phone-ios`.
  Still to be read on a device: every item above.
- **What did not reopen.** Five tabs with Notes under More: iOS also
  stops at five. The radius ladder: iOS 26's continuous corners cannot
  be drawn in CSS, and a glass surface takes the `2xl` rung or a true
  pill from the ladder rather than a hand-written number. Swipe rows and
  the edge-swipe back, the push and pop slides, the keyboard rules: all
  already the platform's behaviour, measured on the device. Swipe to
  page between tabs: rejected on Material's rule before, and iOS does
  not do it either. Haptics: Safari has no vibration API, so the move
  buzz the sound module sends is Android's only, and that is a known gap
  rather than a choice. The pane strip: out of scope by the rule in
  CLAUDE.md, on every platform.

## The mark

A knight's head as one open line, from the base of the throat, out
along the muzzle, up the forehead to the ear, down two steps of mane and
along the neck back to the base. The line is in
`web/src/components/brand-mark.tsx` and in `scripts/render-icons.mjs`,
which cuts every icon size from it; the script also carries a solid
silhouette of the same head, which is what the favicon and the `.ico`
use.

- **A knight, this time.** The hexagon that preceded it (0.1 to 0.8.4)
  was chosen not to be a piece, on the argument that a piece says "chess"
  and not which app. In a tab strip and a dock that argument lost: the
  hexagon said nothing at all, and a mark that has to be explained is
  not doing the one job a mark has. The name carries "vault"; the mark
  carries "chess".
- **Straight where a horse has bone, curved where it has muscle.** The
  forehead, the ear, the two mane steps and the muzzle are straight
  segments meeting at corners; the throat and the neck are curves. Eleven
  points in all. That construction is what keeps it from being the
  knight every other chess app wears: it is a drawing, not a silhouette
  of the board piece.
- **One line, at the weight of everything else.** The stroke is 7 units
  on an 80-unit box, the weight the hexagon had, and it sits in the
  sidebar among outline icons as one of them.
- **Two drawings, because it has to survive 16 px.** A 7-unit line is
  1.4 px at favicon size and disappears in a tab strip, so the favicon
  and the `.ico` carry a solid cut of the same head, drawn for that size
  with a deeper muzzle and a heavier neck. Everything from 180 px up
  carries the line.
- **Still not `KnightIcon`.** Where the app means *chess* rather than
  itself (the notes palette, an archive row, an empty state) it draws
  the cburnett knight, the piece on the board. The two are different
  enough in construction that neither reads as the other.
- **Black and white** because the theme at rest is neutral and the board
  is the only colour the app insists on. Bare in the surrounding ink
  everywhere the app draws it; white on a black rounded square only on
  the icons an OS composites onto a ground of its own, apple-touch and
  the desktop installers, and the same two inks as the splash, so launch
  and icon agree.

## Process conventions

- Verify in the browser (hard reload — plain F5 can serve stale
  modules), run the test suite, then commit per feature. Vault data
  changes go in separate commits from code.
- Comments state constraints the code can't show, often with the
  decision's owner ("lanph3re's call") so future refactors know what is
  deliberate.
- A slow frame is measured, then attributed. The probes (a rAF sampler,
  a CDP screencast, Event Timing) say when it happened; `CHESS_PROFILE=1
  npm run build:demo` builds with `react-dom/profiling`
  (`web/vite.profiling.ts`), and a Chrome Performance recording of that
  build shows React's Scheduler track (which lane, which phase, and any
  cascading update) and, inside a `<Profiler>` or with React DevTools
  installed, the Components track with per-component render and effect
  times. It is a measurement build, slower and larger than the release,
  and is never what a user runs.
