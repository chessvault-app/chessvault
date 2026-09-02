---
name: Chess Vault
description: A private, self-hosted chess workbench — the board carries the colour, the chrome stays out of the way.
colors:
  background: "oklch(100% 0 0)"
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
  primary-soft: "oklch(94% 0 0)"
  primary-soft-dark: "oklch(30% 0 0)"
  ring: "oklch(70.8% 0 0)"
  ring-dark: "oklch(55.6% 0 0)"
  good: "oklch(50% 0.141 150)"
  good-dark: "oklch(72% 0.16 152)"
  warn: "oklch(52% 0.112 75)"
  warn-dark: "oklch(80% 0.15 80)"
  info: "oklch(51% 0.102 230)"
  info-dark: "oklch(72% 0.13 232)"
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
    backgroundColor: "color-mix(in oklch, oklch(20.5% 0 0) 80%, transparent)"
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
- Flat: depth is a tonal rung plus a hairline ring, almost never a shadow.
- Dense and adjustable: two density rungs, read by every surface that repeats a row.
- One type family for two scripts, with mono reserved for what is scanned as a column.
- shadcn/ui (Base UI, nova style) at the component layer, worn faithfully.

## Colours

A neutral grey ladder with one near-black accent, plus a small fixed set
of semantic hues that never change with the theme.

Colour names in this document are the token names in
`web/src/index.css`. There is no second vocabulary: what you read here is
what you grep for.

### Primary

- **primary** (`oklch(20.5% 0 0)` light, `oklch(92.2% 0 0)` dark): the
  only accent. Active navigation, the default button, chips, the current
  item. In the default Neutral scheme it is not a colour at all but the
  near-black end of the grey ladder; the `--accent-tint` knob is what
  gives it a hue in the tinted schemes, and `--accent-hue` decides which.
- **primary-soft** (`oklch(94% 0 0)` light, `oklch(30% 0 0)` dark): the
  quiet fill under something selected that must not shout — a highlighted
  row, a soft badge.

### Neutral

- **background** (`oklch(100% 0 0)` light, `oklch(14.5% 0 0)` dark): the page.
- **surface** (`oklch(100% 0 0)` light, `oklch(20.5% 0 0)` dark): a card
  or panel resting on the page. In light it is the same white as the
  page, which is exactly why the hairline ring is load-bearing.
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
- **ring** (`oklch(70.8% 0 0)` / `oklch(55.6% 0 0)`): the focus ring, at 50% alpha.

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
- **info** (`oklch(51% 0.102 230)` / `oklch(72% 0.13 232)`): trusted or
  informational — the book-solution tier, the annotated-game pen.

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

Two families are **coloured by data**, where the hue is the information
and only its lightness and chroma belong to the theme. The ECO tag takes
`--eco-l` / `--eco-c` (with `--eco-wash` for the tint behind it) and the
opening map takes `--map-line-l` / `--map-line-c`; the caller supplies
the hue — an ECO letter, a position on the wheel — and the token supplies
everything else. Both are OKLCH for a reason that is not consistency:
holding a *hue-independent* lightness is the whole point, and the map
spelled the same idea in `hsl` for a while, where one line came out
nearly six times brighter than another.

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
token in `index.css`, expressed as a lerp on the same knobs, or it is not
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
- **Headline** (600, 20px / `text-xl`): page titles, via `PageHeader`.
- **Headline, board family** (600, 16px / `text-base`): the page title on a
  page whose subject is a board — Board, Editor, Puzzles, Repertoire, the
  book reader. Still the `h1`; a rung quieter because the title shares a
  strip with the board's own controls and every point it takes is a point
  off the board.
- **Title** (500, 16px / `text-base`): section titles, setting rows.
- **Body** (400, 14px / `text-sm`): body copy, list rows, panel text.
- **Label** (500, 12px / `text-xs`): captions and dense labels only.
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

**The Body Is 14px Rule.** Body copy sits on `text-sm`, not `text-xs`.
The 12px rung is captions — the size Material, Fluent and GitHub all
reserve for them. Body once sat there at 284 call sites, which on a phone
is 70% of the size every other app on the device uses.

**The Board Pays Last Rule.** On a page whose subject is a board, chrome
gives up a rung before the board gives up a pixel. That is why the page
title is 16px there and 20px everywhere else, and why the density knob
leaves the reader's toolbar bands alone — they are not rows.

**The Named Tier Rule.** A magic `text-[…]` literal means a tier exists
that nobody named. Three survive in app code — the heat map's cell
label, the result bar's digits, the puzzle tile's corner mark — each
sized to a physical thing it sits on, which is the only excuse a literal
has, and each says so in a comment on the line above it. `check:repo`
holds that: a `text-[…]`, `rounded-[…]` or `shadow-[…]` literal outside
the registry files is a finding unless it reads a `var(--…)` or the
lines above it say what it is fitted to.

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

### Named Rules

**The Not-`--spacing` Rule.** Density must never be implemented by
squeezing Tailwind's own `--spacing`. 401 rules in the built stylesheet
derive from it, `size-*` included, so shrinking it takes every icon down
with the padding. Density is about whitespace; a glyph is not whitespace.

**The Orientation Rule.** Decide side-by-side versus stacked from
orientation plus a floor, never from width alone. Portrait always stacks.

## Elevation & Depth

**The system is flat.** Depth is a rung on the surface ladder plus a
hairline ring, and almost never a shadow. Cards carry no shadow at all:
they are `ring-1 ring-border`, which is what makes a white surface
read on a white page in light mode where card and background are the same
value. The ring used to be `ring-foreground/10`, a fixed alpha the
contrast knob could never reach — High contrast, the one scheme chosen
for legibility, moved every border and left card edges at 1.3:1. On the
border token the knob reaches them.

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

Bare `rounded` is deliberately **not** on the ladder — it resolves to 4px
— and is used by badges and move chips, which want a fixed small corner
rather than the knob. Badges are the exception in the other direction:
`rounded-4xl` makes them true pills.

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
- **Primary:** primary fill, primary-foreground text, hover at 80% alpha.
- **Outline:** background fill, border stroke, hover to the muted rung;
  in dark it takes shadcn's translucent `input/30`.
- **Secondary / Ghost:** the surface-2 rung, hovering a further 5% toward
  the foreground; ghost is transparent until hovered.
- **Destructive:** a 10% destructive wash with destructive text, *not* a
  solid red fill — `destructive-solid` exists separately for the rare
  action that must shout.
- **States:** `focus-visible:ring-3 ring-ring/50` with the border taking
  the ring colour; a 1px downward translate on press, suppressed for
  anything with a popup; 50% opacity and no pointer events when disabled.
- **Icons:** 16px by default, 12px at xs and 14px at sm, marked with
  `data-icon` so the button can tighten the padding on that side.

### Cards

- **Corner:** `xl`. **Background:** surface. **Border:** none — a
  `ring-1 ring-border` hairline instead. **Shadow:** none.
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
- **Focus:** border to the ring colour plus `ring-3 ring-ring/50`.
- **Invalid:** destructive border and a destructive ring at 20% (40% in dark).
- **Disabled:** translucent input fill, 50% opacity, no pointer events.
- Text is 16px on small viewports and 14px from `md` up — the 16px floor
  is what stops iOS zooming the page on focus.

### Badges

- 20px high, pill-cornered (`rounded-4xl`), 12px medium text, 12px icons.
- Variants mirror the button's colour assignments; destructive is again a
  10% wash rather than a fill.

### Navigation

- A section list of icon-plus-label rows; the active section takes the
  primary treatment, everything else is quiet until hovered.
- On a phone the bottom bar becomes the open page's controls — move
  navigation, puzzle actions — in the Chess.com / Lichess idiom, claimed
  by whichever page is open.

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

### Named Rules

**The No-Hand-Rolled-Overlay Rule.** A second popover, menu, dialog or
tooltip beside a Base UI one is two focus stacks on one page. Overlays
come from the registry. A disclosure is not an overlay — it opens nothing
over anything and leaves focus where it was — and is hand-rolled on
purpose.

**The One Focus Ring Rule.** Components draw shadcn's
`focus-visible:ring-3 ring-ring/50` and turn the outline off; anything
that is not a component gets the same ring from the global
`:focus-visible` outline in the same colour. A page has one focus style
whichever kind of control has it.

**The Behaviour-Not-Geometry Rule.** "Owned" registry files may gain
behaviour and must not quietly lose geometry. Card is the worked example
of getting this wrong: its root was rewritten to drop the registry's
padding and gap, which reads like a small local decision and is in fact a
rule every call site then has to re-derive.

## Do's and Don'ts

### Do:

- **Do** express a new colour as a lerp on the existing knobs
  (`--ui-hue`, `--ui-tint`, `--ui-contrast`, `--accent-hue`,
  `--accent-tint`) in `web/src/index.css`, so Settings → Appearance keeps
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
