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
- **No user-facing ratings.** Puzzle ratings exist only as curation
  data; the UI shows bands (Easy/Medium/Hard/Expert) as text labels.
  Difficulty is ordinal, so if it ever needs more visual weight it gets
  a strength meter, not colors.

## The color grammar

Color carries meaning, and each hue has exactly one job:

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
(green→red) is forbidden because it would collide with outcome colors
in the same rows. Signals should never be color-only — the winning
digit is also bold, tier marks also differ by icon shape.


Contrast is measured against every background a token can land on —
`--background`, `--card`, `--muted`, `--surface-3` — and not against
the page and the white surface alone. The quiet tiers passed on those
two and failed on the raised and inset panels, which is where the gap
is smallest: the then third text tier, `--text-subtle`, was 4.12:1 in light and 3.16:1 in dark
before anyone measured the third and fourth. Small text needs 4.5:1 on
all of them. When a tier darkens to reach it, the tier above darkens
too — two quiet greys that meet at the same lightness are one grey.

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
| captions | `text-xs` | 12px |
| body, list rows, panel text | `text-sm` | 14px |
| titles, setting rows | `text-base` | 16px |
| page titles (`PageHeader`) | `text-xl` | 20px |
| the one display figure | `text-2xl` | 24px |

A magic `text-[…]` literal means a tier exists that nobody named: 81 of
the 89 in the app were the same value, retyped at every call site. The
two that remain are tile-corner glyphs, sized to a board square and not
to type, which is the only excuse a literal has.

Placeholders are what a scale change breaks. A skeleton line box must
equal the real line-height, and line-heights do not all move together —
an explicit `leading-` pins one where the token would have moved it. Re-
derive each box from the component it stands in; never shift them along
with the text. Rhythm copied out of the note editor belongs in `em`
against the editor's own font size, not in the px it resolved to once.

## Layout rules

- **A page belongs to one of three families**, listed in `components/layout.ts`.
  The family says what the page *is*; only the first has widths to pick
  from. A page that fits none of the three is a fourth family to be
  named there, not markup written inline — the opening map spent its
  first release off-template that way.
- **Scrolling pages sit in `PageShell`, on one of three named
  widths**: `wide` (72rem) for pages that split into columns or card
  grids (Games, Studies, Notes), `medium` (48rem) for one column read
  top to bottom (Puzzles, Databases), `narrow` (42rem) for forms
  (Settings). A width is a statement about the kind of content, so
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
  keeps its controls on the right; the elite and archive panels share
  this shape because they take turns in one column. (The small-caps
  `label-caps` voice is gone with the old look.)
- A panel's header is the registry's card header as a row (`PanelHeader`:
  title, actions, `px-3 py-2`); it is no longer a fixed-height band, so
  nothing else is sized against it.
- `wide` / `stacked` are orientation-based custom variants: side-by-side
  when the viewport is wide, single column otherwise. Stacked layouts
  lead with a page header (convention: header at top), wide layouts put
  the header in the side column where it aligns with the board.
- Phones (`md:hidden` world): the bottom bar is the navigation on hub
  pages, but a **leaf page claims it** — board, study, puzzle and
  repertoire replace the global tabs with their own controls (move
  navigation, puzzle actions) via `MobileActionBar`, and you leave by the
  back chevron, chess.com/Lichess-style. Desktop navigates by sidebar, no
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
  measured.** Not guessed from the class names: a shelf card is 88–90 px
  because the excerpt is one line and the 64 px board is what governs, a
  game row is 72 px because its three lines are 20 + 20 + 16. Compose the
  real thing's own layout constants where they exist — `SkeletonBoard`
  builds from `BOARD_WIDE_SHELL`, `BOARD_MAX_W` and `BOARD_WIDE_SIDE`
  rather than from something that looks like them, because a copy drifts
  the first time one of them moves.
- **A block with nothing in it yet is not a block with nothing to show.**
  An empty array reads the same whether the answer said "none" or has not
  arrived, and a panel that announces "nothing solved yet" to somebody
  with a hundred solves is worse than one that waits. Track the ANSWER
  arriving, per block, and hold each one's own placeholder until it does.
- **Cover the wait that actually exists.** Data arriving is not the same
  as content appearing: a big book's list answers in 48 ms and then takes
  most of a second to build, so the skeleton is keyed on the grid being on
  screen, not on the fetch being done.
- **Arrive whole.** The shelf decodes its covers before drawing, rather
  than laying out cards and filling them in one at a time — bounded, and
  skipped once cached, because a cover is a nicety and must never be
  something a page waits on.
- Suspense is used for CODE (route chunks), never for data; its fallback
  stays blank because a chunk usually beats the next paint.

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

Every one of them — and every `PanelHeader` — draws the same thin rule
under its title. Windows once had no rule while panels did, which made
the same app look like two.

The way out is a **Cancel**, stated in words, next to the thing it
cancels. Escape and the scrim also close, but neither is advertised. A
window whose changes apply as you make them (the filters) offers
Cancel — restoring what was there when it opened — beside Done.

The rule was once "never an X in the corner", and it has one exception
now, because some windows have no button row for a Cancel to sit in: a
list of settings (the engine's, the puzzle difficulty and theme picker)
applies as you touch it and has nothing to confirm. Those get an X on
**desktop only** — with no Cancel, the other two ways out are both
invisible. A phone still shows none: the sheet drags away from anywhere
on itself, which is the gesture it was given instead.

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
pre-scrolling, shell resizing) each produced a worse artifact than the
native behavior. Settled rule: never move the PAGE while the keyboard is
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

The app is a shadcn/ui project (`components.json`: the radix-nova style,
Tailwind v4, CSS variables). What that means here, and what it does not:

- **`web/src/components/ui/` holds the registry's files, owned.** Button,
  Input, Textarea, Label, Field, InputGroup, Dialog, AlertDialog,
  DropdownMenu, ContextMenu, Select, Popover, Tooltip, Tabs, ToggleGroup,
  Toggle, Switch, Progress, Skeleton, Card, Separator — each the shape
  `npx shadcn add` writes (Radix underneath, `cva` variants, `data-slot`),
  each in the registry's own face (the nova style: its sizes, radius
  ladder, focus rings, the inverted tooltip, the ring-hairline card) and
  carrying this app's physics on top: every window a bottom sheet on a
  phone, dragged away from anywhere on itself; the page/layer distinction
  and the back chevron; the keyboard band; the sole-text-field focus;
  Android Back through CloseWatcher; the coarse-pointer hit areas;
  `title` as a tooltip. The look is shadcn's; what is added is
  behaviour, and each file says at the top what it adds and why. Adding
  a component is `npx shadcn add <name>`; it needs no restyling.
- **`web/src/components/` holds the app's composites** (Panel, PageShell,
  ShelfCard, ActionMenu, PromptDialog, the skeletons …), built from the
  primitives; **`web/src/hooks/`** the window physics they share.
- **The theme is the registry's vocabulary and, at rest, its values** —
  `bg-card`, `text-muted-foreground`, `border-input`, `bg-destructive` — so
  a component added tomorrow is themed the moment it lands. The default
  scheme, Neutral, IS shadcn's neutral theme (white page, grey surfaces,
  a near-black primary; 14.5 / 20.5 / 26.9 % on the dark side); the
  values are written as the app's OKLCH ladder in `index.css` with the
  hue, tint and contrast knobs as lerps, so Settings → Appearance keeps
  tinting them (Slate is the app's previous look) and there is no second
  palette. The primary's lightness follows the accent knob: grey is the
  registry's near-black, a coloured accent sits mid-scale. Settings offers
  shadcn's five base colours (Neutral, Stone, Zinc, Gray, Slate) as schemes
  and a radius knob — `--radius`, the one number the corner ladder derives
  from — beside the app's tinted schemes. What the ladder says that shadcn has no
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
  — the notes palette, an archive row, an empty state — never the brand.
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
