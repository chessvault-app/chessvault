# Design principles

*English · [한국어](design-principles.ko.md)*

Decisions that recur across the app, with the reasoning that produced
them. When in doubt, these win over novelty.

## Language and tone

- **Sentence case everywhere** ("Add puzzle", "Book solution"). No
  Title Case labels.
- **Plain words over jargon**: fidelity tiers are "Book solution /
  Engine + book / Engine solution / Engine guess", not
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
| cyan (primary) | interactive/active | active nav, chips, buttons |

Corollaries that were learned the hard way: a green dot on a tile grid
reads as "solved" no matter what you meant (the fidelity marks became
shape-coded icons for this reason), and the difficulty ramp
(green→red) is forbidden because it would collide with outcome colors
in the same rows. Signals should never be color-only — the winning
digit is also bold, tier marks also differ by icon shape.

## Layout rules

- Column header bands are `h-9`; with the column's `gap-3` this equals
  the board's `h-10` strip + `gap-2`, so panel tops align with the
  board across Studies/Games/Board/Puzzles.
- `wide` / `stacked` are orientation-based custom variants: side-by-side
  when the viewport is wide, single column otherwise. Stacked layouts
  lead with a page header (convention: header at top), wide layouts put
  the header in the side column where it aligns with the board.
- Phones (`md:hidden` world): the bottom bar is the navigation on hub
  pages, but a **leaf page claims it** — board, study, puzzle and
  repertoire replace the global tabs with their own controls (move
  navigation, puzzle actions) via `MobileActionBar`, and you leave by the
  back chevron, chess.com/Lichess-style. The puzzle dashboard is the hub
  (Puzzles tab lands there). Desktop navigates by sidebar, no back arrows
  on top-level pages.
- Board and piece appearance are user-chosen (Settings → Appearance):
  board-colour presets ride the same OKLCH tokens, and piece sets are
  vendored from lila. This is orthogonal to the semantic colour grammar
  below — the hues there dress the UI, not the board.
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

Three sizes, one look. `Sheet` is the small centred card every
one-question window is built from; `PromptSheet` is Sheet plus a field
(new study, new note, new book, every rename); `Modal` is the same card
at window width for anything larger (import PGN, the PDF import, the
explorer's filters). Anything that is not a single line is one of these
rather than a panel that grows in place.

Every one of them — and every `PanelHeader` — draws the same thin rule
under its title. Windows once had no rule while panels did, which made
the same app look like two.

The way out is a **Cancel**, never an X in the corner: one closing
idiom, stated in words, next to the thing it cancels. Escape and the
scrim also close, but neither is advertised. A window whose changes
apply as you make them (the filters) offers Cancel — restoring what was
there when it opened — beside Done.

The row-actions sheet (`ActionSheet`, the phone half of a row's ⋯) is
the exception, and it proves the rule: it is a list of verbs with no
button row of its own, so there is nowhere for a Cancel to sit that is
not itself another verb. It carries a grab handle and nothing else, and
the handle is honest — every sheet on a phone is pushed away by dragging
it from anywhere on itself. It carried an X beside the handle for a
while, from back when the drag was a promise the sheet did not keep.

Autofill is off in every field (`Input`, `TextArea`, or the exported
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

**A transient dialog may live in the visual viewport.** `PromptSheet`
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

## Process conventions

- Verify in the browser (hard reload — plain F5 can serve stale
  modules), run the test suite, then commit per feature. Vault data
  changes go in separate commits from code.
- Comments state constraints the code can't show, often with the
  decision's owner ("lanph3re's call") so future refactors know what is
  deliberate.
