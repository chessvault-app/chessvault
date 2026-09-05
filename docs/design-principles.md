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
digit is also bold, tier marks also differ by icon shape.


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
at 18.4px in the sidebar's own colours, and both times the reading
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
| body, list rows, panel text | `text-sm` | 14px |
| titles, setting rows | `text-base` | 16px |
| page titles (`PageHeader`) | `text-xl` | 20px |
| the one display figure | `text-2xl` | 24px |

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
ours to name.

Placeholders are what a scale change breaks. A skeleton line box must
equal the real line-height, and line-heights do not all move together —
an explicit `leading-` pins one where the token would have moved it. Re-
derive each box from the component it stands in; never shift them along
with the text. Rhythm copied out of the note editor belongs in `em`
against the editor's own font size, not in the px it resolved to once.

## Density

How much of a vault fits on the screen is a setting, not a constant. It
is the knob a tool has and this app did not: it could recolour itself
thirteen ways and round its corners four, and had nothing to say about a
page that is four hundred games.

Five numbers in `index.css`, one per kind of repeating row, and
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
  draws as icons and the Fab fans out as pills, the same
  two-presentations-one-list shape `CreateControl` uses.
  The header is IN THE FLOW, above the surface. It floated briefly, and
  that put dots and labels behind the page's own title and panned them
  through it on every drag; it also meant the surface could swallow a
  press meant for the header, which took a pointer-events dance to
  arrange around. Chrome that belongs to the SURFACE floats; chrome that
  names the PAGE does not. A canvas still cannot be a fourth width: a
  width answers how long a line of text should be, and a canvas wants
  every pixel it is given at any size.
- **One page title**: `PageHeader` — `text-xl font-semibold
  tracking-tight`, actions pushed right, the phone-only back chevron
  where a page is reached through More. `ShelfToolbar` is built on it.
  (Four title sizes had accumulated; a page's name is one voice.)
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
- Phones (`md:hidden` world): the bottom bar is the navigation on hub
  pages, but a **leaf page claims it** — board, study, puzzle and
  repertoire replace the global tabs with their own controls (move
  navigation, puzzle actions) via `MobileActionBar`, and you leave by the
  back chevron, Chess.com/Lichess-style. Desktop navigates by sidebar, no
  back arrows on top-level pages.
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
is the bottom sheet. Anything that is not a single line is one of these
rather than a panel that grows in place.

None of them — nor any `PanelHeader` — draws a rule under its title: the
registry's card header and its dialog title row are both rule-less, and
the two agree. (Windows once had no rule while panels did, which made
the same app look like two; the panels' rule went with the old look.)

The way out is a **Cancel**, stated in words, next to the thing it
cancels. Escape and the scrim also close, but neither is advertised. A
window whose changes apply as you make them (the filters) offers
Cancel — restoring what was there when it opened — beside Done.

The rule was once "never an X in the corner". Since every window became
shadcn's Dialog, every titled window carries the registry's X on
**desktop only** — a mouse has no gesture, and for a window with no
button row (a list of settings, which applies as you touch it) it is the
only visible way out. A phone still shows none: the sheet drags away from anywhere
on itself, which is the gesture it was given instead.

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

The row-actions sheet (`ActionMenu`'s phone half; on a desktop it is
shadcn's DropdownMenu under the ⋯, and `ActionContextMenu` the same verbs
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

## The component layer

The app is a shadcn/ui project (`components.json`: the base-nova style,
Tailwind v4, CSS variables). What that means here, and what it does not:

- **`web/src/components/ui/` holds the registry's files, owned.** Button,
  Input, InputOTP, Textarea, Label, Field, InputGroup, Checkbox,
  RadioGroup, Slider, Dialog, AlertDialog, DropdownMenu, ContextMenu,
  Select, Popover, Tooltip, Tabs, ToggleGroup, Toggle, Switch, Progress,
  Spinner, Skeleton, Empty, Card, Badge, Separator, Calendar, Sonner —
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
  `title` as a tooltip. The look is shadcn's; what is added is
  behaviour, and each file says at the top what it adds and why. Adding
  a component is `npx shadcn add <name>`; it needs no restyling.
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
  a near-black primary; 14.5 / 20.5 / 26.9 % on the dark side); the
  values are written as the app's OKLCH ladder in `index.css` with the
  hue, tint and contrast knobs as lerps, so Settings → Appearance keeps
  tinting them (Blue is the app's previous look) and there is no second
  palette. Several roles depart from the registry's numbers, every one of
  them measured. `--accent` (the pressed, selected and highlighted fill)
  is a rung above `--muted` (the hover fill) instead of the same rung,
  because a pressed toggle on a card was 3% of lightness from its
  surroundings in the light and 6% in the dark and could not be seen —
  92.8% and 37% now. The dark `--input` is shadcn's own translucent
  white, which the chosen tab's pill (`dark:bg-input/30
  dark:border-input`) depends on: over the muted track an opaque grey at
  30% was the track's own colour. And in light the structural strokes
  moved as a set, because that scheme paints the page, the cards and the
  panels all the same white and the hairline is therefore the only
  structure there is: `--border` rests at 88% rather than 92.2% (1.26:1
  on the page was not visible on a phone at all; 1.44:1 now),
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
- **One focus ring, the registry's.** Components draw shadcn's
  `focus-visible:ring-3 ring-ring/50` and turn the outline off; everything
  that is not a component (a bare button, a link) gets the same ring from
  the global `:focus-visible` outline in the same colour, so a page has
  one focus style whichever kind of control has it.

## The mark

A hexagon outline with one of its six wedges filled, white on a black
rounded square. It is in `web/public/favicon.svg`, cut into every icon
size by `scripts/render-icons.mjs`, and drawn in the app by
`web/src/components/brand-mark.tsx`.

- **A hexagon is a cell** — a tile, a crystal, the outline of a cube seen
  corner-on. Both readings fit a vault: a container, and a solid block
  you can look into.
- **The filled wedge is the top face of that cube catching light** — the
  lid of the box, and one position out of many, the one in front of you.
  A vault of games, studies and puzzles is exactly that: a lot of
  material, and one thing you are working on.
- **Outline and fill say what is yours and what is open.** The outline
  is the boundary — your files, on your disk. Nothing is drawn locked:
  the stance is "your chess, in plain files", not "behind a door", so
  the mark is a container, not a padlock.
- **Not a chess piece.** Every chess app wears a knight or a king; a
  piece says "chess", not which app, and this app's distinction is where
  your material lives, not the game. The pieces stay on the board
  (cburnett); `KnightIcon` is what the app uses where it means *chess*
  — the notes palette, an archive row — never the brand.
- **Black and white** because the theme at rest is neutral and the board
  is the only colour the app insists on. The tile takes no side, sits
  beside any other icon, and is the same two inks as the splash, so
  launch and icon agree.
- **Two shapes, because it has to survive 16 px.** An outline plus one
  triangle keeps its silhouette in a browser tab and on the 32 px
  sidebar tile, which is what a nine-dot lattice, tried first, did not.

## Process conventions

- Verify in the browser (hard reload — plain F5 can serve stale
  modules), run the test suite, then commit per feature. Vault data
  changes go in separate commits from code.
- Comments state constraints the code can't show, often with the
  decision's owner ("lanph3re's call") so future refactors know what is
  deliberate.
