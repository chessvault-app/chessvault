---
name: Chess Vault
description: A private, self-hosted chess workbench — the board carries the colour, the chrome stays out of the way.
colors:
  background: "oklch(97% 0 0)"
  background-dark: "oklch(14.5% 0 0)"
  background-accent: "oklch(97% 0 0)"
  background-accent-dark: "oklch(12% 0 0)"
  surface: "oklch(100% 0 0)"
  surface-dark: "oklch(20.5% 0 0)"
  surface-2: "oklch(97% 0 0)"
  surface-2-dark: "oklch(26.9% 0 0)"
  surface-3: "oklch(92.8% 0 0)"
  surface-3-dark: "oklch(32% 0 0)"
  surface-inset: "oklch(98.5% 0 0)"
  surface-inset-dark: "oklch(23% 0 0)"
  border: "oklch(88% 0 0)"
  border-dark: "oklch(29% 0 0)"
  border-strong: "oklch(82% 0 0)"
  border-strong-dark: "oklch(40% 0 0)"
  foreground: "oklch(14.5% 0 0)"
  foreground-dark: "oklch(98.5% 0 0)"
  muted-foreground: "oklch(48% 0 0)"
  muted-foreground-dark: "oklch(74% 0 0)"
  text-subtle: "oklch(51.5% 0 0)"
  text-subtle-dark: "oklch(69.5% 0 0)"
  primary: "oklch(20.5% 0 0)"
  primary-dark: "oklch(92.2% 0 0)"
  primary-foreground: "oklch(98.5% 0 0)"
  primary-foreground-dark: "oklch(20.5% 0 0)"
  primary-hover: "oklch(34% 0 0)"
  primary-hover-dark: "oklch(85% 0 0)"
  primary-soft: "oklch(94% 0 0)"
  primary-soft-dark: "oklch(30% 0 0)"
  ring: "oklch(59% 0 0)"
  ring-dark: "oklch(66% 0 0)"
  good: "oklch(50% 0.141 150)"
  good-dark: "oklch(72% 0.16 152)"
  warn: "oklch(52% 0.112 75)"
  warn-dark: "oklch(80% 0.15 80)"
  info: "oklch(51% 0.102 230)"
  info-dark: "oklch(74% 0.13 232)"
  destructive: "oklch(52% 0.245 27.3)"
  destructive-dark: "oklch(72% 0.191 22.2)"
  board-light: "oklch(91% 0.035 84)"
  board-dark: "oklch(62% 0.072 52)"
  eval-white: "oklch(97% 0 0)"
  eval-black: "oklch(30% 0 0)"
typography:
  display:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 2rem
  headline:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.75rem
  title:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.5rem
  body:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.25rem
  label:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1rem
  control-sm:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
  mono:
    fontFamily: "'JetBrains Mono', 'Pretendard Variable', Pretendard, ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
  moves:
    fontFamily: "'Pretendard Variable', Pretendard, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  chip: "0.25rem"
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.875rem"
  2xl: "1.125rem"
spacing:
  base: "0.25rem"
  row-py: "0.5rem"
  row-py-dense: "0.375rem"
  row-py-tight: "0.25rem"
  row-h: "2rem"
  card-pad: "1rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0 0.625rem"
  button-destructive:
    backgroundColor: "color-mix(in oklch, oklch(52% 0.245 27.3) 10%, transparent)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    height: "2rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0.25rem 0.625rem"
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "1.625rem"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
    typography: "{typography.label}"
---

# Design System: Chess Vault

> This file is a machine-readable record of a system that is already
> written down in prose. `docs/design-principles.md` is the authority —
> it carries the reasoning, the measurements and the cases that produced
> each rule, and it is what to change first. This file follows it. Where
> the two disagree, `docs/design-principles.md` is right and this file is
> stale; `CLAUDE.md` governs both.

## Overview

**Creative North Star: "The Quiet Workbench"**

Tools laid out on a neutral bench. The board, the position and the
signals a player reads off them are the only things allowed to carry
colour; everything else — panels, rows, controls, navigation — recedes
into a grey ladder until it is asked for. The default scheme is
shadcn's neutral theme, which means a fresh install has exactly one
near-black button and no other saturated pixel outside the board. That
is the point, not an oversight waiting to be brightened.

The register is dense, professional and tool-like. This is a desktop
chess database and an engine workbench before it is anything else: rows
are close-set, a page holds a great deal at once, and the density knob
exists so a user with four hundred games can pack them tighter still.
The confirmed anti-reference is consumer SaaS — the airy marketing
layout with big rounded cards, generous whitespace and an illustration
in every empty state. Also rejected, from the product's own side: the
gamified chess-app register of streaks, badges and confetti.

The palette is not a list of colours but a formula. Every neutral in the
app derives from three knobs — `--ui-hue`, `--ui-tint` and
`--ui-contrast` — and the accent from two more, so the thirteen schemes in
Settings → Appearance are one system re-parameterised, not thirteen
palettes. Colours are OKLCH throughout so that light and dark stay
perceptually matched. Anything that pastes a fixed palette over `:root`
breaks the knobs, and is therefore forbidden.

**Key Characteristics:**

- Neutral by default: the grey ladder carries structure, the board carries colour.
- OKLCH everywhere, parameterised by hue / tint / contrast rather than fixed.
- Flat: depth is a tonal rung, a hairline only where the contrast knob asks, almost never a shadow.
- Dense and adjustable: two density rungs, read by every surface that repeats a row.
- One type family for two scripts, with mono reserved for what is scanned as a column.
- shadcn/ui (Base UI, nova style) at the component layer, worn faithfully.

## Colours

A neutral grey ladder with one near-black accent, plus a small fixed set
of semantic hues that never change with the theme.

Colour names in this document are the token names in
`web/src/styles/tokens.css` (`tokens-dark.css` beside it for the dark
palette). There is no second vocabulary: what you read here is what you
grep for.

### Primary

- **primary** (`oklch(20.5% 0 0)` light, `oklch(92.2% 0 0)` dark): the
  only accent. Active navigation, the default button, chips, the current
  item. In the default Neutral scheme it is not a colour at all but the
  near-black end of the grey ladder; the `--accent-tint` knob is what
  gives it a hue in the tinted schemes, and `--accent-hue` decides which.
  One scheme, Follow the board, reads both knobs off the chosen board's
  dark square (`BOARD_ACCENT` in `store/prefs.ts`, held to index.css by
  a test): a Blue board makes a blue accent, and a grey board keeps the
  accent grey, since the tint follows the square's own chroma. The one
  colour the app allows then does the branding.
- **primary-soft** (`oklch(94% 0 0)` light, `oklch(30% 0 0)` dark): the
  quiet fill under something selected that must not shout — a highlighted
  row, a soft badge.

### Neutral

- **background** (`oklch(97% 0 0)` light, `oklch(14.5% 0 0)` dark): the
  page. A tone in light, not white: cards and panels are white on it and
  separate by fill, the way Apple's grouped screens, Material 3's surface
  containers and both big chess sites draw a light theme. High contrast
  takes it back to white (the knob lerps it) and puts the card ring on.
- **surface** (`oklch(100% 0 0)` light, `oklch(20.5% 0 0)` dark): a card
  or panel resting on the page, a rung above it in both modes.
- **card-ring**: the card's edge. Transparent in both modes, where a
  card is a rung of tone above the page, and the full `border` hairline
  at the top of the contrast knob, where the reader has asked for every
  cue. Floating surfaces (popovers, menus, dialogs, peeks) keep
  `border` at every setting.
- **surface-2** (`oklch(97% 0 0)` / `oklch(26.9% 0 0)`): the hover fill
  and the muted rung — a track, a secondary button, a row under the cursor.
- **surface-3** (`oklch(92.8% 0 0)` / `oklch(32% 0 0)`): the pressed,
  selected and highlighted fill. Deliberately a rung *above* surface-2
  rather than the same rung, which is a measured departure from shadcn's
  numbers: at parity a pressed toggle on a card sat 3% of lightness from
  its surroundings in light and 6% in dark, and could not be seen.
- **surface-inset** (`oklch(98.5% 0 0)` / `oklch(23% 0 0)`): a well —
  something recessed into a panel rather than sitting on it.
- **border** (`oklch(88% 0 0)` / `oklch(29% 0 0)`): the default hairline,
  and the input stroke. 88% is a measured move off the registry's 92.2%,
  which was 1.26:1 on the white page — in light the page and every panel
  are the same white, so this line is the only structure there is, and
  on a phone it was not visible at all.
- **border-strong** (`oklch(82% 0 0)` / `oklch(40% 0 0)`): a divider that
  has to survive a busy surface.
- **foreground** (`oklch(14.5% 0 0)` / `oklch(98.5% 0 0)`): body text.
- **muted-foreground** (`oklch(48% 0 0)` / `oklch(74% 0 0)`): the second
  text tier — labels, secondary values.
- **text-subtle** (`oklch(51.5% 0 0)` / `oklch(69.5% 0 0)`): the third tier,
  for text that is present but not being read.
- **ring** (`oklch(59% 0 0)` / `oklch(66% 0 0)`): the focus ring, at full
  alpha. Placed by measurement, not by eye: 3:1 against every surface it
  can land on, in both themes and at every point of the contrast knob,
  which is what WCAG 1.4.11 asks of a focus indicator. The registry's
  50% wash measured 1.35 to 1.88:1 and was no indicator at all. The
  binding surface is the selected fill an inset ring is drawn onto —
  surface-3 in light, accent in dark. One control paints it without
  focus as well: the slider thumb's 1px edge at rest and its hover and
  active halos, which the move made stronger too. Its focus halo is hung
  on `has-[:focus-visible]`, because the focusable element there is a
  clipped `input[type=range]` inside the thumb and the registry's
  `focus-visible:` drew nothing (`slider.tsx` measures all four).

### Semantic

These four are the app's colour grammar. They do **not** multiply by the
tint knobs — a puzzle that cannot say *wrong* in red has lost something a
palette was never meant to take.

They **do** follow `--ui-contrast`, on lightness alone. Leaving them out
of it was an accident with one visible consequence: the surfaces moved as
the knob rose and these four did not, so High contrast — the one scheme
chosen for legibility — closed the gap on exactly the colours carrying
the meaning. Hue and chroma stay put; only the lightness lerps, and only
in light mode, where the gap closes. In dark it already opens.

- **good** (`oklch(50% 0.141 150)` / `oklch(72% 0.16 152)`): outcome — solved, won.
- **destructive** (`oklch(52% 0.245 27.3)` / `oklch(72% 0.191 22.2)`):
  outcome — failed, lost; and destructive actions.
- **warn** (`oklch(52% 0.112 75)` / `oklch(80% 0.15 80)`): caution — the
  engine-guess fidelity tier, offline notices.
- **info** (`oklch(51% 0.102 230)` / `oklch(74% 0.13 232)`): trusted or
  informational — the book-solution tier, the annotated-game pen. Dark's
  74 is the one semantic colour raised for the hover fill: it is the only
  one the app writes as a sentence on a row that fills, and at 72 the
  puzzle dashboard's due count read 4.29:1 there.

### Board and reading colours

Outside the UI ladder entirely, because they are the thing being read
rather than the frame around it: **board-light** / **board-dark** (ten
selectable sets, the default a warm oklch(91% 0.035 84) over
oklch(62% 0.072 52)), the last-move / selected / destination / check
square washes, **eval-white** and **eval-black** for the evaluation bar,
**side-white** and **side-black** for whose move it is, and the seven
NAG colours (`nag-good`, `nag-mistake`, `nag-brilliant`, `nag-blunder`,
`nag-interesting`, `nag-dubious`, `nag-book`), which are the only hex
values left in the system because they match a published annotation
convention rather than this palette.

One family is **coloured by data**, where the hue is the information
and only its lightness and chroma belong to the theme: the opening map
takes `--map-line-l` / `--map-line-c` and the caller supplies the hue, a
position on the wheel. It is OKLCH for a reason that is not consistency:
holding a *hue-independent* lightness is the whole point, and the map
spelled the same idea in `hsl` for a while, where one line came out
nearly six times brighter than another.

The ECO tag used to be the second such family, one hue per letter, and
two of its five hues were the green and amber the grammar reserves for
outcome and caution: a green D36 chip sat two cells from a green "1-0".
It is one hue now (`--eco-l` / `--eco-c`, with `--eco-wash` for the
tint behind it), and the letter moves the chip two points along the
lightness ladder per family, in the direction `--eco-dir` sets per
theme, so every step keeps the base tag's contrast. The letter carries
the family, as it always did.

### Named Rules

**The One Job Rule.** Each hue has exactly one meaning, app-wide.
Green/red is outcome. Amber is caution. Blue is trusted or
informational. Teal and purple are the middle rungs of the fidelity
ladder. Primary is interactive. A hue may not be borrowed for a second
job on one page because it looked good there.

**The Never Colour-Only Rule.** No signal is carried by colour alone. The
winning digit is also bold; fidelity tiers also differ by icon shape. A
green dot on a tile grid reads as "solved" no matter what was meant by
it, which is why the fidelity marks became shape-coded.

**The No Difficulty Ramp Rule.** A green→red ramp for difficulty is
forbidden. It would collide with outcome colours in the same rows.

**The Knobs Are The Palette Rule.** Never write a fixed colour at a call
site and never paste a preset theme over `:root`. A new colour is a new
token in `styles/tokens.css`, expressed as a lerp on the same knobs, or it is not
a colour this app can wear.

**The Four Backgrounds Rule.** Contrast is measured against every
background a token can land on — `--background`, `--card`, `--muted` and
`--surface-3` — not against the page alone. The gap is smallest on the
raised and inset panels, which is where a quiet text tier fails first.
Small text needs 4.5:1 on all four.

## Typography

**UI Font:** Pretendard Variable (with Pretendard, `ui-sans-serif`,
`system-ui`, `-apple-system`, Segoe UI, Apple SD Gothic Neo, Malgun
Gothic)
**Mono Font:** JetBrains Mono, then Pretendard (with `ui-monospace`, SF
Mono, Menlo)
**Moves Font:** resolves to the UI font, and is a distinct role on purpose.

**Character:** One voice for two scripts. Pretendard replaced Inter
because half this app's interface is Korean and Inter has no hangul —
every Korean string fell through to whatever the OS had, so one screen
mixed two typefaces at two apparent sizes, differently on every machine.
Pretendard draws both and its Latin is deliberately Inter-shaped, so the
English UI reads as it always did. It is loaded as the dynamic subset (92
unicode-range chunks): the English UI pulls one chunk at 37 KB, less than
the Inter latin it replaced. Fonts are bundled, never fetched from a CDN —
the app must render with the network cable pulled.

There are three type roles, not two. **sans** is the whole UI. **mono**
is anything the eye scans as a column or copies as a literal —
evaluations, clocks, counts, FEN, PGN — where tabular figures and a fixed
advance are the point. **moves** is SAN, which is prose rather than data:
"Nf3" read aloud is a word, and move lists already align by cell, so
setting them in mono made every one of them look like a terminal.

### Hierarchy

- **Display** (600, 24px / `text-2xl`): the one display figure on a page.
- **Headline** (600, 20px / `text-xl`; the phone's 24px large title
  under `md`): page titles, via `PageHeader`. Two rungs under one name,
  for the reason the row rungs are two: a desktop header shares its line
  with the page's actions, and a phone's is a large title in a 44px row
  of its own. Exported as `pageTitleClass`, since Settings' loading
  skeleton draws the same title and had the pair written out a second
  time.
- **Headline, board family** (600, 16px / `text-base`): the page title on a
  page whose subject is a board — Board, Editor, Puzzles, Repertoire, the
  book reader. Still the `h1`; a rung quieter because the title shares a
  strip with the board's own controls and every point it takes is a point
  off the board.
- **Title** (500, 16px / `text-base`): section titles, setting rows, and
  the title of an empty state, via `EmptyTitle`. That last one drew at
  `text-sm` until 2026-09-15, which made it the only title in the app at
  Body size — a shelf naming its own emptiness a rung under the cards
  beside it, which three separate comments in `skeletons.tsx` had each
  measured around. The five screens that say the same thing without the
  component say it in this voice too.
- **Panel title** (500, 14px / `text-sm`; `type-row`'s 16px under `md`): the header
  of a panel, via `PanelHeader`, in the registry's own card-title voice.
  Deliberately on the row rung, not Title: a panel's header shares a row
  with its controls and reads as the name of a band, not a section of
  the page (`docs/design-principles.md`, "A panel's header"). It follows
  the rows under it up on a phone for the same reason: a band's name a
  rung under the band's own rows is a hierarchy upside down.
- **Body** (400, 14px / `text-sm`): body copy and panel text.
- **Row** (400, 14px / `type-row`; **16px under `md`**): a list row's
  line and the panel heading over it. The same class at both widths and
  a different size, because the two platforms disagree: a desktop row is
  13 to 14 (macOS, Windows, dense tables) and a phone row is 16 or 17
  (iOS Body, Material Body Large). Under `md` the class also carries
  Body's weight and Title's size, on purpose: on a phone the row IS the
  body.
- **Row tail** (400, 12px / `type-row-sub`; **14px under `md`**): the
  date, count or word beside a row's text, a shelf card's meta line, and
  the hint beside a `Field`'s label, which `Field` draws itself. That
  last one was rendered raw, so six call sites each chose a size: three
  at 12px flat, two at 14, one a bare string inheriting whatever sat
  above it. Label's size on a desktop, Body's on a phone.
- **Label** (500, 12px / `text-xs`): captions and dense labels only.
- **Small control** (500, 12.8px / `text-[0.8rem]`): the label inside a
  `size="sm"` Button, Toggle or calendar cell. The registry's own value,
  kept because what this app adds to a registry file is behaviour and not
  geometry — but a rung all the same, and one a reader meets on every
  toolbar, so it is written down rather than left as a literal nobody
  named. `check:repo` cannot see it: it lives in
  `web/src/components/ui/`, which the check exempts.
- **Micro** (10px / `text-micro`): the last rung, and the only one below
  the label. A number or a mark read off a dense surface and never a
  sentence — the eval bar's readout, the PV peek's move label, a solved
  mark on a puzzle tile. It exists because seven places already needed
  something under 12px and each wrote its own literal.

### Named Rules

**The Fitted-Glyph Exception.** A glyph sized to a box it has to sit
inside is not on this ladder and does not have to be. The heat-map badge
is sized to a board square, the result bar's figures to their own 16px
track, the ✓/✗ to a tile corner; those numbers answer to geometry, and
rounding them onto a type rung would push them out of the box that
decides them. They are the only literal font sizes the app is allowed,
and each says in place what box it is fitted to. Everything a reader
reads as text is on a rung. The annotation-size setting is also not on
this ladder: it is a user preference with its own three rungs, whose
smallest step (11px) is written down in `store/prefs.ts` with the reason
the gap has to survive at the bottom.

**The One Display Figure Rule.** If the top rung appears more than once
on a page, the page has stopped ranking its own content. The puzzle
dashboard once spent it four times in a row on Solved / Attempts / Win
rate / Failed; four numbers at the top size is a scoreboard, not
emphasis. They are a figure list at body size now.

**The Three Weights Rule.** The app draws 400, 500 and 600, and nothing
else. One role takes one weight: a 16px title is 500 everywhere, whether
it names a card, a shelf entry, a trainer's verdict or a settings card,
and it is 500 rather than 600 because that is what this ladder has always
said, what Material's Title Medium is, and what the registry's own
`CardTitle` draws. An audit on 2026-09-15 found the rung split 26 sites to
12, with two files carrying both weights for one shape.

700 is not a weight here. Primer has no 700 token at all, Apple's
guidance is not to use Bold for standard UI text, and neither Material's
type scale nor Fluent's ramp gives a role one. Six sites had it, three of
them the trainers' side-to-move line, which is the Display rung and is
600 everywhere else. The two that were carrying meaning rather than
hierarchy — the NAG puck and the result chip's winning digit — went to
600 with them and still step clearly off what they sit on.

A second pass the same day found three more, all of them outside what a
grep over class names can see. The board's coordinate labels carry
chessground's own 700 on the smallest text on the screen, which is the
size both platforms say not to set in bold. The opening map's gap puck
sets `fontWeight={700}` on an SVG number. The note editor's document
headings drew 700 and a pair of 650s, a fourth and a fifth weight in a
ladder that has three. All are 600.

A weight is allowed to mark a state, and does: the current row goes
`font-semibold` whether or not it also takes a fill. `GameTable` records
the measurement behind that — in the Neutral scheme `--primary` (20.5%)
and `--foreground` (14.5%) are nearly the same ink, so a colour change
says nothing there while a weight step reads in every scheme and at every
contrast knob. What a weight may not do is change on hover, which
reflows the text under the pointer; `PvMoves` did that until the same
audit.

**The Body Is 14px Rule.** Body copy sits on `text-sm`, not `text-xs`.
The 12px rung is captions — the size Material, Fluent and GitHub all
reserve for them. Body once sat there at 284 call sites, which on a phone
is 70% of the size every other app on the device uses.

**The Phone Row Rule.** Under `md`, a line the reader chooses a row by
is 16px and the line under it is 14; nothing a reader must read to use
the page is under 14, and 12 is left to chips, codes, coordinates and
a tile's label under its icon (the tab bar's own size). The rule is
carried by `type-row` and `type-row-sub`, never by `max-md:text-*` at a
call site, and the rungs are named `type-*` and not `text-*` because
twMerge reads an unknown `text-*` as a colour and drops it beside a real
one (measured: the theme tiles' labels inherited 16px at every width).
It applies to every text of its role wherever it is rendered, registry
file or app code: the Button, Toggle, Tabs, Select and InputGroup
controls, the Badge, the Command palette, the form Label, and the
Insights tables all step up with the rows (lanph3re, 2026-09-15: "ignore
the registry rule, apply font sizes consistently"). Body copy, a
paragraph read as prose, stays at Body; a caption stays at Label. The
only things that do not move are on the Fitted-Glyph list, plus a move
list's number column, which is a column and not a line.

That Body copy does not move is the one part of this rule an audit will
ask about, since iOS puts Body at 17 and Material's Body Large at 16, so
neither leaves a phone's reading text at 14. It was asked and settled
(lanph3re, 2026-09-15: the blurbs are captions saying what each thing
contains). What settled it is the shape the app writes most of its
explanations in, a title with a blurb under it as `SettingRow` draws it:
lifting the blurb to 16 makes it the size of its own title, weight
becomes the only thing between them, and the row loses its hierarchy.
Measured on the demo at 390px with every 14px sentence forced to 16,
which also cost the vault's storage tree two of the seven folders it
fits. The paragraphs that would read better at 16 are the standalone
ones with no title over them, and giving those a rung of their own is
two prose sizes on a phone, which is the tier nobody named. 14 is also
what Primer, Polaris, Carbon and Fluent set body at on every device; it
is the two native-platform systems that go higher, and this is a web
app. Reopen it with new evidence, not with the yardstick.

It reached ten app files first and the rest on 2026-09-15: linked
mentions, the book reader's chapters, the database manager's three
lists, the study's chapters, the tag picker, Settings' recovery, cache
and storage rows, and the customise-home and move-to dialogs, which are
windows at every width and so had been drawing 16px rows on a desktop.
A row pinned at `text-base` at every width is not exempt from this rule
— it is the same mistake read from the other end, since a desktop row
is 13 to 14 on both platforms and only a phone's is 16. The study's
chapter number and its child count stay put beside the move list's
number column, for the same reason it does.

A third pass the same day took what the first two had read past, since
nothing mechanical looks for a row that never lifts. The explorer's and
the tablebase's move tables and the top-games rows under them, on the
Insights tables' own pattern (`type-row` on the table, `type-row-sub` on
the head); the unresolved-links list, beside a linked-mentions list that
had already been lifted; the expander under each of those tables, since
"Show all 42 moves" is a control and not a caption; the trailing note
under six capped lists ("Only the first 200 are shown"), which is a
sentence; and the date picker's weekday and week-number columns, which
were the one text in a phone date picker that never stepped up.

A fourth pass, on 2026-09-17, took the windows. Each of the three above
was verified by a script that walked the demo's 21 phone routes and
measured every visible text node, and a closed dialog has no text nodes,
so nothing in any of them could see one: the residue was almost all
inside a sheet or a popover. Frozen at the desktop rung: the history
sheet's version rows (its placeholder took `type-row-box` with them, or
it would have reserved a desktop line for a phone's); the opening
picker's list, whose own trailing note was already `type-row-sub`, so the
footnote was bigger than the rows it footnotes; the game filters'
suggestion rows and their glosses, inside an `h-7` that is pinned for the
windowing and still holds a 24px line; the build-a-database window's file
list; the PDF import's per-page state word; and `FieldRow`, which is the
map panel's statistics table and the add-a-move sheet both. Pinned at
`text-base` instead: the coverage dialog's rows and the Select among
them, a window at both widths drawing 16px rows on a desktop — the
mistake this section already names, two dialogs later. Two group
headings went to `type-row` with them, and the tablebase's distance cell
simply lost its `text-xs`, since the table is `type-row` and every other
cell in both of those tables inherits it. Codes stayed at 12 throughout,
on the games list's ECO precedent. The `text-base` half of that mistake
is `check:repo`'s rule 15 now; the `text-sm` half has no shape a grep can
hold, because `text-sm` on anything that is not a row is correct.

**The Phone Glyph Rule.** Icons take the type rungs' bargain. The row
glyph (a chevron, a row's leading icon, the icon in a small button) is
`glyph`: 14px on a desktop, 16 under `md`. The mark (a bookmark on a
card, a badge's tick, a checklist's dismiss) is `glyph-sm`: 12, then 14.
An icon-only Button draws 20 under `md` on its own. Both platforms put a
phone's list glyph at 20 to 24 and a toolbar glyph at 20 to 22; the app
drew 14 beside 16px text after the row lift, a third of its own 36px
button. No icon in app code is sized `size-3.5` or `size-3` any more; a
bare `size-3` is a dot or a swatch. A `size-4` written out in a
registry file can still be a row glyph and the sweep's script did not
read it as one: the Select trigger's chevron was left at 16px at every
width, the one 16 on a shelf header's 28px row, and now takes `glyph`
like the arrow and the plus beside it. The registry's own default-icon
rule (`[&_svg:not([class*='size-'])]`) also excludes `glyph`, or it would
size every renamed icon to 16 at every width, which the grid caught on
the desktop Games page. Fitted glyphs (board coordinates, the puzzle
tile's corner mark, the pane strip) stay where they are.

**The Board Pays Last Rule.** On a page whose subject is a board, chrome
gives up a rung before the board gives up a pixel. That is why the page
title is 16px there and 20px everywhere else, and why the density knob
leaves the reader's toolbar bands alone — they are not rows.

**The Named Tier Rule.** A magic `text-[…]` literal means a tier exists
that nobody named. Two survive in app code — the result bar's digits and
the puzzle tile's corner mark — each sized to a physical thing it sits
on, which is the only excuse a literal has, and each says so in a
comment on the line above it. (A third `text-[…]` is in `store/prefs.ts`
and is not one of these: it is the bottom rung of the annotation-size
setting, a user preference with its own scale. The heat map's cell label
was listed here and is not a literal at all.) `check:repo`
holds that: a `text-[…]`, `rounded-[…]` or `shadow-[…]` literal outside
the registry files is a finding unless it reads a `var(--…)` or the
lines above it say what it is fitted to.

What it cannot see is a `font-size` in a stylesheet, or one in a page
this repo *writes* rather than renders. Three had each grown a scale of
their own by 2026-09-15: the note editor's document styles (a 16.8px
heading and 13.6px code, off a 16px document body), the licences page
`web/vite.licenses.ts` generates (1.6 / .9 / .85 / .8 / .78rem, five
sizes the app does not draw, on the page that lists what the app is made
of), and the desktop vault chooser (an 18.4px logotype where its own
comment says the sidebar's 16px, and a 12.8px blurb where a settings row
draws 14). All three are on the ladder now, each in the em- or
rem-relative form its own base makes exact. The landing pages keep a
scale of their own on purpose — a marketing page reads at 15px and this
ladder is the app's — but not a size below 12: their nav row clamped
down to 11.52px and now stops at `--t-xs`.

**The Hangul Fallback Rule.** Any font stack that can appear beside
Korean must resolve hangul. This is why Pretendard sits inside the *mono*
stack, ahead of the generic fallbacks: JetBrains Mono has no hangul, so a
Korean word in a mono element fell through and rendered in a different
typeface two centimetres from its neighbour.

## Layout

The app is a page shell with a section list, and inside it, families of
panels around a board. Layout direction is **orientation-aware, not
width-only**: `wide` is `(orientation: landscape) and (min-width: 44rem)`
and puts panels beside the board; `stacked` is its exact complement and
always applies in portrait, tablets included — an upright iPad wants a
large board with panes below it, and keying off width alone gave it a
448px board using 40% of the screen where the portrait rule gives it
792px. Full desktop behaviour (all panels at once, no pane tabs) keys off
`lg`. A `.force-stacked` ancestor makes a subtree lay out as if the
viewport were stacked, for a board rendered inside a narrow region of a
wide page.

The side column next to the board is `--board-side` (27rem), written down
in exactly one place.

**Density** is a first-class control with two rungs, expressed as five
custom properties on the root and read by every surface in the app that
repeats a row: game rows, panel rows, the card they sit in, the move
tree, the explorer's tables, the studies chapter list. Default row
padding is 0.5rem on a 2rem row; compact takes them to 0.3125rem and
1.75rem. A density is five declarations, not a sweep of call sites.

That sentence was a claim rather than a fact until 2026-09-16. Measured
on the demo, comfortable to compact, page scroll height at 1280px: the
puzzle dashboard, a study, Games, Endgames, Insights and Home tightened
by 7 to 12 per cent, and Settings, Licences, Databases, the opening map,
the notes lists and the engine's own line list did not move a pixel. The
Licences page's 203 rows were the largest list in the app ignoring the
knob, and were ignoring it twice over: a literal padding, and an
unconditional `min-h-9` above it that the padding could never have
beaten. Thirty-odd rows read a rung now, and the floor is
`pointer-coarse` like every Button's.

What the knob does NOT reach is the card grids, and that is a decision
rather than a gap (lanph3re, 2026-09-16): the Studies, Notes and Books
shelves, the Themes grid and the puzzle hub's cards are cards, and
tightening a grid of cards is a different promise from tightening a
list. The book reader is the one surface that is half in: its toolbars
stay out, because an h-9 band is a control strip and shrinking it would
fight the coarse-pointer hit areas, but its chapter list is a list and
reads the dense rung with every other one. The note in `index.css` put
the whole reader out on the grounds that it had no list, which was true
when it was written.

### Named Rules

**The Not-`--spacing` Rule.** Density must never be implemented by
squeezing Tailwind's own `--spacing`. 401 rules in the built stylesheet
derive from it, `size-*` included, so shrinking it takes every icon down
with the padding. Density is about whitespace; a glyph is not whitespace.

**The Pinned-Row Rule.** A row that repeats reads a rung; it does not
write its own vertical padding. The rungs' comfortable values ARE the
literals a call site would otherwise type (4, 6 and 8px), so saying
`py-(--row-py-dense)` instead of `py-1.5` costs nothing at the default
density and is the whole of what the knob needs. `check:repo` holds the
half of this a grep can see: an `<li>` outside the registry files may
not carry a literal `py-*`/`p-*` unless the lines above it say "not a
row" - a list's floor, the sentinel an infinite scroll watches, is not
one of its rows. A row drawn as a button or a div is out of the grep's
reach and stays a matter of reading.

**The Orientation Rule.** Decide side-by-side versus stacked from
orientation plus a floor, never from width alone. Portrait always stacks.

## Elevation & Depth

**The system is flat.** Depth is a rung on the surface ladder, and
almost never a shadow. Cards carry no shadow at all: in light they are
white on a 97% page, in dark 20.5% on 14.5%, and in both they separate
by fill alone; in High contrast, where the light page is white again,
they carry `ring-1 ring-card-ring`, a hairline that follows the
contrast knob (it used to be
`ring-foreground/10`, a fixed alpha the knob could never reach, which
left High contrast's card edges at 1.3:1). The page was white for a
while, with every card the same white and the ring the only structure;
that was the registry's default and a mockup over the demo retired it
(lanph3re, 2026-09-07).

Three shadow tokens exist for the cases that genuinely float, and all
three are cast in `--shadow-color`, which follows the theme's hue.
Tailwind's own `shadow-sm`/`md`/`lg` are fixed black and once sat beside
these as a visibly different-coloured shadow; an audit found 31 of them
against a record that said five, so the utilities now resolve to the
tokens (`shadow-sm` is control, `shadow-md` is panel, `shadow-lg` and up
are pop) and a call site cannot cast a black one by habit.

### Shadow Vocabulary

- **control** (`0 1px 3px 0 hsl(var(--shadow-color)/10%), 0 1px 2px -1px hsl(var(--shadow-color)/10%)`):
  the slightest lift — a primary button, the active tab in a pill track, a
  label chip on the board.
- **panel** (`0 1px 2px -1px hsl(var(--shadow-color)/12%), 0 4px 16px -6px hsl(var(--shadow-color)/14%)`):
  a card or panel resting on the page.
- **pop** (`0 4px 12px -2px hsl(var(--shadow-color)/18%), 0 16px 40px -12px hsl(var(--shadow-color)/22%)`):
  something floating over the page — popover, sheet, toast, fab, peek card.

### Named Rules

**The Hairline-First Rule.** Reach for a ring or a tonal rung before a
shadow. A shadow is for something that has genuinely left the page:
cards carry none, and the ones that exist sit on floating things (a
popover, a peek card, a promotion picker) and lifted ones (a shelf card
under the pointer).

**The One Shadow Colour Rule.** A shadow is cast in `--shadow-color` or
it is not cast. The Tailwind utilities are mapped onto the three tokens
so this holds by construction; a `shadow-[…]` literal is the one way
round it, and `check:repo` flags one.

## Shapes

One radius knob, `--radius` (0.625rem), and a ladder every corner derives
from: `sm` ×0.6, `md` ×0.8, `lg` ×1, `xl` ×1.4, `2xl` ×1.8, and on up.
Settings exposes the knob, so moving one number moves every corner in the
app in step. Buttons and inputs take `lg`; cards take `xl`; small
controls step down to `md` with a pixel cap (`min(var(--radius-md),12px)`)
so a small button does not read as a pill.

Bare `rounded` is deliberately **not** on the ladder — it resolves to a
fixed 4px — and nothing in the app uses it. This paragraph said for a
while that badges and move chips did; they never have, and a corner that
stops answering the knob is not what either of them wanted. The two
small-tag corners both come off the ladder and both live on `Badge`:
`shape="pill"` is `rounded-4xl`, a true pill, and `shape="chip"` is
`rounded-sm` with tighter sides, for the tag that carries a code, a
theme or a verdict.

Borders are hairlines. Buttons carry a transparent border by default so
that a variant can fill it in without the control changing size, and
`bg-clip-padding` keeps a translucent fill from bleeding under it.

### Named Rules

**The One Knob Rule.** Every corner in the app derives from `--radius`. A
hand-written radius is a corner that stops responding to the setting, and
the only sanctioned exceptions are the 4px chip corner, the pixel caps
that stop small controls turning into pills, and a mark fitted to its
own few pixels (the 10px side dot at 3px, the review strip's 8px
diamond at 1px), where the ladder's smallest rung would round the shape
away. Each says so on the line above it, and `check:repo` asks for that
sentence.

## Components

**Character: quiet and exact.** Controls stay out of the way until they
are used. Sizes are tight rather than generous — the default button is
32px, not 40 — and every dimension is chosen, not inherited: the
coarse-pointer bumps, the icon sizes, the hit areas. The look is
shadcn/ui's nova style, worn faithfully; what this app adds is behaviour,
not geometry.

`web/src/components/ui/` holds the registry's own files, each written the
way `npx shadcn add` writes it (Base UI underneath, `cva` variants,
`data-slot`), carrying this app's physics on top: every window a bottom
sheet on a phone, the page/layer chevron, the keyboard band, the
sole-text-field focus, Android Back through CloseWatcher, coarse-pointer
hit areas, `title` as a tooltip. Composites live in
`web/src/components/`, shared physics in `web/src/hooks/`.

### Buttons

- **Shape:** the `lg` rung (0.625rem), with `md` capped at 10–12px on the
  xs and sm sizes.
- **Sizes:** default 32px high with 10px of side padding; xs 24px, sm
  28px, lg 36px; icon buttons square at each. Coarse pointers bump
  default and sm to 36px and icon to 44px; the trainer's three
  end-of-puzzle actions (Skip, Hint, Solution) also take 44, because two
  of them are adjacent, irreversible and one tap each.
- **The coarse-pointer floor:** 36px is the smallest hit area any control
  may have under a coarse pointer, and icon buttons and the bottom bar
  take 44px. This is the rung `pointer-coarse:` reaches for everywhere
  (tabs, switches, checkboxes, radios, disclosures, hover-revealed
  links), whether by growing the control or by an `after:` hit box.
  One exception, by decision and out of scope for any audit: the
  phone's pane strip (`components/pane-tabs.tsx`) keeps its own height
  (32px, whether pill or header, and the header also swallows the gap
  under it), because its tabs are a third of the screen wide, a swipe
  turns the panes without it, and every pixel it grows comes off the
  pane under it.
- **Primary:** primary fill, primary-foreground text, hover to the
  opaque `--primary-hover` rung (an 80% alpha lifted a coloured accent
  over the text's floor: 3.88:1 measured on Follow the board, Blue).
- **Outline:** background fill, border stroke, hover to the muted rung;
  in dark it takes shadcn's translucent `input/30`. A field-like
  control (a date picker's trigger, a toggle group), not a page's
  secondary action: on the tonal page strokes belong to fields, and the
  secondary action is a fill, the way iOS's gray button and Material's
  filled tonal are. The toast's action and the review band draw it.
- **Secondary / Ghost:** the surface-2 rung, hovering a further 5% toward
  the foreground; ghost is transparent until hovered.
- **Destructive:** a 10% destructive wash with destructive text, *not* a
  solid red fill — `destructive-solid` exists separately for the rare
  action that must shout.
- **States:** `focus-visible:ring-3 ring-ring` with the border taking
  the ring colour; a 1px downward translate on press, suppressed for
  anything with a popup; 50% opacity and no pointer events when disabled.
- **Type under `md`:** one rung up, like the rows: default 16, sm and
  xs 14 (`type-row` / `type-row-sub` as variants beside the registry's
  own classes).
- **Icons:** 16px by default, 12px at xs and 14px at sm, marked with
  `data-icon` so the button can tighten the padding on that side. An
  icon-only button (`icon`, `icon-sm`) draws its glyph at 20px under
  `md`, whatever class the icon carries: a toolbar glyph on a phone.

### Cards

- **Corner:** `xl`. **Background:** surface, a rung above the page.
  **Border:** none — `ring-1 ring-card-ring`, which is transparent at
  rest and a hairline under High contrast. **Shadow:** none.
- **Padding:** `--card-spacing`, initialised from the density token
  `--card-pad` (1rem default, 0.75rem compact), used for both the vertical
  padding and the gap between slots.
- Slots are semantic elements (`section` / `header` / `h2`), not four
  divs, and the title takes `font-heading`.
- The registry's padding and gap are load-bearing: call sites rely on the
  card to provide them, so removing them is not a local decision.

### Inputs

- **Shape:** `lg`, transparent background, `border-input` stroke — the
  field is defined by its stroke, not a fill. Dark mode takes shadcn's
  translucent `input/30`.
- **Sizes:** 28 / 32 / 36px; sm bumps to 36px on coarse pointers.
- **Focus:** border to the ring colour plus `ring-3 ring-ring`.
- **Invalid:** destructive border and a destructive ring at 20% (40% in dark).
- **Disabled:** translucent input fill, 50% opacity, no pointer events.
- Text is 16px on small viewports and 14px from `md` up — the 16px floor
  is what stops iOS zooming the page on focus.

### Badges

- 20px high, 12px medium text (14 under `md`, with the rows), 12px icons.
- Two shapes. `pill` (`rounded-4xl`) is the default and is what a status
  mark wears. `chip` (`rounded-sm`, tighter sides) is the small-cornered
  tag: an opening code, a puzzle theme, a tablebase verdict. Seven of
  these were hand-rolled spans until 2026-09-15, each re-deriving its own
  padding and corner, and two of the seven had quietly lost the weight
  and the phone step-up the other two carried.
- Variants mirror the button's colour assignments, plus the app's own
  grammar: `good` and `destructive` are the OPAQUE `--good-tint` and
  `--destructive-tint`, not a 10% wash. That is the whole reason those
  tokens exist (index.css): a badge sits in rows that fill on hover, and
  a translucent wash measured 3.58:1 in light and 3.02:1 in dark once
  `--accent` arrived under it. `muted` is the quiet chip, on `--muted`
  rather than `--accent`, which is a rung the ladder keeps for selected
  and pressed.
- Badge was used twice in the whole app before it carried those tones,
  which is the shape this kind of drift takes: a component nobody can
  express their case in is a component nobody uses.

### Navigation

- A section list of icon-plus-label rows; the active section takes the
  primary treatment, everything else is quiet until hovered.
- The phone's bottom bar: five tabs (Home, Games, Studies, Puzzles,
  More), docked and pinned, an overlay on the shell's row that `main`
  pads by the bar's measured height (`--bottom-bar-h`, so a page ends
  where the bar begins), `bg-card` on the toned page (its fill is its
  edge). On iOS the same box is the platform's capsule: 24px in from
  the sides and 6px of padding inside its ends, lifted by the home indicator's inset less 8px (20px
  where there is none), a true pill with the panel shadow, a 28px glyph
  box in a 52px track a fifth of the capsule wide, and the current tab's
  pill, that track, 4px off the capsule's top and bottom and 6px off its
  ends, a 12% wash of
  the ink over the glass (Instagram's glyph and track, measured off
  lanph3re's screenshots at 3x), and the page scrolls under it, its
  foot clearing `--page-b`. Icons only,
  a 60px row, the labels for the screen reader; on a scroll down it
  scales to 85% from its bottom edge and a scroll up, the top, or a tap
  brings it back, while the pinned header returns on the same scroll up
  (Instagram's shape on iOS; lanph3re's call, 2026-09-18, after Apple's
  own close-to-one-tab read as an empty control). A transform, so the
  page's padding never moves. The capsule is
  glass (`utilities.css`, `glass`: the card's fill over a 12px blur, a
  hairline of the foreground at 12% inside its edge, so it keeps an
  edge over content of its own colour; 70% for a surface carrying text and
  55% on the capsule, whose icons are held to 3:1 and drawn in
  foreground ink), falling back to the
  card's fill where the browser cannot blur, where the reader asked for
  reduced transparency, or where the debug card switched it off; the
  compact page header, the menus and the toast take the same glass on
  iOS, the sheet not: tried as glass and
  reverted the same day, since it looked worse on the phone. The
  docked face is `bg-card` (its fill is its
  edge; `border-card-ring` draws the line only under High contrast) and
  the home-indicator inset, gone while the keyboard is up. On iOS the back chevron and a
  header's icon actions stand in 40px glass circles and its text buttons
  in 40px pills, the primary one filled (`shell.css`, on rows marked
  `data-chrome`). Each tab is a
  28px-tall, 56px-wide pill track over a `text-xs` label; the current
  tab fills the track `bg-muted` with a `primary/30` inset ring and
  goes semibold, the sidebar's current-row treatment. 56px tall.
- On a phone the bottom bar becomes the open page's controls — move
  navigation, puzzle actions — in the Chess.com / Lichess idiom, claimed
  by whichever page is open.
- Page headers: `text-xl` on a desktop; on a phone a `text-2xl` large
  title in a 44px row that sticks to the top of the page, drops to
  `text-base` and takes the bars' white (`bg-card`) once the page has
  scrolled under it, with a hairline only under High contrast. A count line (`text-sm text-muted-foreground`)
  sits 4px under the title; the search field is full width on a phone
  and `max-w-sm` on a desktop.

### Signature: the board and its overlays

The board is chessground, framed by `--board-frame`, with ten selectable
square palettes and ten piece sets. Everything drawn on top of it —
last-move, selection, destination and check washes, arrows, square badges,
the heat map — derives its square geometry from one place
(`board/square-overlay.tsx`). Duplicated geometry here is a bug waiting
for a flipped board: three overlays once derived a square's position
independently and one of them spelled the rank differently, which nothing
would ever have reported, because a badge on the wrong square is still a
badge.

The coordinate labels are inked per board, not per mode: a light board
takes dark ink on both squares, a dark board light ink on its dark
square, each preset setting `--coord-on-light` / `--coord-on-dark` as a
mix out of its own two tokens. A light label on a mid-tone dark square
never reaches 4.5:1 (white itself is 3.7:1 on walnut, 2.3 on tan), so
the direction is decided by measurement per preset; every one is at or
above 4.5:1 on both squares in both modes, the tightest charcoal's light
square at 4.54. That is the label as drawn, not the token: chessground's
own sheet washes its coordinates to 80%, and through that wash the same
inks measured 3.6 to 4.4:1 on the dark squares of ten of the twelve board
states, so the app's sheet restores full ink and `check:contrast`
composites every preset's label at its rendered opacity, in both modes.
The app's one mark of its own, the engine's best move and the puzzle
hint, is the `best` brush: `--arrow-best` per preset at
`--arrow-best-alpha`, placed to clear 3:1 on both squares, where
chessground's blue through its 60% layer wash was 2.2:1 on walnut's dark
square and no colour could do better through it.

### Named Rules

**The No-Hand-Rolled-Overlay Rule.** A second popover, menu, dialog or
tooltip beside a Base UI one is two focus stacks on one page. Overlays
come from the registry. A disclosure is not an overlay — it opens nothing
over anything and leaves focus where it was — and is hand-rolled on
purpose.

**The One Focus Ring Rule.** Components draw shadcn's
`focus-visible:ring-3` and turn the outline off; anything
that is not a component gets the same ring from the global
`:focus-visible` outline in the same colour. A page has one focus style
whichever kind of control has it. The colour is `ring-ring` at full
alpha, and `--ring` is held to 3:1 against every surface it lands on
(WCAG 1.4.11) rather than to a look: the registry's 50% wash measured
1.35 to 1.88:1, which is not an indicator.

**The Behaviour-Not-Geometry Rule.** "Owned" registry files may gain
behaviour and must not quietly lose geometry. Card is the worked example
of getting this wrong: its root was rewritten to drop the registry's
padding and gap, which reads like a small local decision and is in fact a
rule every call site then has to re-derive.

## Motion

One clock, and it is a spring. Every state motion the app draws (the
pane turn and its indicator line, the tab bar's sliding pill, the page
title's collapse, the phone's route cross-fade, and a disclosure's
chevron) reads two tokens,
`--pane-turn` and `--pane-turn-ease`, and those are a damped spring
sampled into a CSS `linear()` easing: stiffness 380, damping ratio 0.92,
unit mass, settling within 0.1% in 337ms with no overshoot, 90% of the
way at about 180ms. The spring lives in `web/src/lib/spring.ts`;
`scripts/spring-easing.ts` prints the curve from it and a test holds
the tokens to it, so moving the motion means changing the two numbers
there, re-running the script and pasting what it printed.

Why a spring: a spring arrives fast and eases to a stop with no fixed
length, which is how iOS has animated since iOS 7 and what Material 3
Expressive made its motion model in 2025; the 200ms cubic-bezier it
replaced started from rest and took the same time for every distance.
Why no overshoot: a bouncing move list is the register the record
rejects; Apple's default rebounds a little (ratio about 0.83), Material's
"standard" scheme sits near critical, and this app sits at 0.92. Why
CSS: the shape at zero runtime cost, in the tokens the three motions
already read.

**The finger's speed.** The pane swipe is the one motion that does not
start from rest: the row is already moving under the finger when it
lets go. So the hook (hooks/use-pane-swipe) asks `lib/spring` for the
trace released at that speed, in trips per second towards rest, and
sets it on the column as this turn's `--pane-turn` pair; what the two
panes hold and the strip's line take it together, and it comes off with
the offset. A slow release is the rest curve, which is the tokens. A
flick at 10/s arrives in 294ms instead of 337 and overshoots by 0.08%;
past 20/s the curve is clamped, where the overshoot is 0.73% and stops
growing. Measured, not tuned: `scripts/spring-easing.ts <velocity>`
prints any of them.

**The shared board.** A phone's route change is a cross-fade, except
for the board: the page's board carries `view-transition-name: board`
(board/Board.tsx), and a shelf card or Home's Continue row names its
thumbnail the same the moment it is tapped (lib/shared-board), so the
browser morphs the small board into the big one on the spring's clock
while the rest of the page fades. Named at tap time only: a name must be
unique among the elements a transition captures, and a shelf shows a
dozen boards.

**The One Clock Rule.** A new state motion reads the two tokens. A
`duration-150` beside them is a second tempo on the same screen.
Hover and colour changes are not motion and keep their own short
transitions; `prefers-reduced-motion` flattens all of it to the swap.

The rule is about a *state* moving, which is narrower than every
transition with a duration on it, and the difference is worth writing
down because the list above was read as exhaustive once and was not.
Three kinds sit outside it and stay on their own numbers. A **value
being tracked** is not a state change: the eval bar, the review strip's
progress and its marker, a book scan's bar all follow a number that
moves on its own, and a spring restarting every time the engine reports
would be worse than the short fixed tempo they have. **Press and hover
feedback** is the sentence above. And one real state motion keeps its
own clock **by decision**: the sidebar's fold is a 150ms width change
matched to the rows' own colour timing, because the width, the label's
fade and the row's padding move as one gesture and the row carries its
hover colour on the same declaration — putting the width on the spring
alone would pull the gesture apart, and putting all of it there would
give a hover a 337ms fade. It says so where it is written.

## Do's and Don'ts

### Do:

- **Do** express a new colour as a lerp on the existing knobs
  (`--ui-hue`, `--ui-tint`, `--ui-contrast`, `--accent-hue`,
  `--accent-tint`) in `web/src/styles/tokens.css`, so Settings → Appearance keeps
  reaching it.
- **Do** use the registry's vocabulary at call sites — `bg-card`,
  `text-muted-foreground`, `border-input`, `bg-destructive` — with the
  app's own grammar beside it (`good` / `warn` / `info`, the board and
  eval colours).
- **Do** reach for a hairline ring or the next surface rung before a shadow.
- **Do** put body copy on `text-sm` (14px) and keep `text-xs` for captions.
- **Do** add a primitive with `npx shadcn add <name>` and keep its look,
  adding only behaviour.
- **Do** set anything scanned as a column — evaluations, clocks, counts,
  FEN, PGN — in the mono role, and leave SAN in the moves role.
- **Do** measure a text tier's contrast against all four backgrounds a
  token can land on, at 4.5:1 for small text.
- **Do** write UI text in sentence case, and in both English and Korean —
  a user-facing string is not finished in one language alone.

### Don't:

- **Don't** paste a preset theme over `:root`. It overrides the roles but
  not the ladder they derive from, so the Settings knobs stop reaching
  them.
- **Don't** use the retired colour names — `text-fg`, `text-subtle`,
  `bg-surface-3`, `bg-surface`, `border-line`, `text-bad` — as classes.
  The ladder's own rungs are variables, not utilities.
- **Don't** tint the semantic colours. `good`, `destructive`, `warn` and
  `info` are outside the knobs on purpose; green means solved in every
  scheme.
- **Don't** signal anything with colour alone, and don't build a
  green→red difficulty ramp.
- **Don't** use Tailwind's fixed-black shadow utilities beside the app's
  three hue-matched ones.
- **Don't** hand-roll a popover, menu, dialog or tooltip beside a Base UI
  one.
- **Don't** spend the display rung more than once on a page.
- **Don't** implement density by shrinking Tailwind's `--spacing`.
- **Don't** write a magic `text-[…]` or a literal radius; both are a tier
  nobody named.
- **Don't** re-derive a board square's geometry in a new overlay.
