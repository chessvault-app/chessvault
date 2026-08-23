# Update log

*English · [한국어](update-log.ko.md)*

What changed, newest first. Feature-level entries, not a commit ledger —
`git log` has the full detail.

## 0.4.8

A library of your chess books, read beside a board.

- **Books.** A new top-level section: upload any chess book as a PDF —
  strategy, a games collection, an opening book, a puzzle book — and read
  it in the app, in a resizable pane beside the analysis board, the moves
  panel and the position loader; on a phone, as Book and Board tabs with
  the bottom bar turning pages on one and stepping moves on the other.
  The file lives in your vault (`vault/books/<id>/`, never in the history
  repo) and is served with byte ranges, so a page costs its own bytes and
  the book is never held whole in a phone's memory. The reader keeps your
  page per book, on the server, so it follows you between devices. Cards
  show the file's size and where you stopped; rename, replace the file,
  and remove from the card's menu or the reader's header.
- **Every printed diagram is a tap from the board.** The reader draws a
  small board button on each diagram of the page. Where a puzzle book was
  read from this same PDF, the puzzle's own position and side to move
  land on the board directly; anywhere else the book's pages are read
  once with the importer's own detector and CellNet — when the book
  arrives, as a background job, or from the card's "Read diagrams" — and
  kept on the server per page, and the button asks White or Black to move
  rather than guessing — or
  opens the position in the editor, for a diagram it misread; the board's
  own header has the same way out for whatever is on it. The book scrolls
  as one column, page after page, with only the pages in view rendered;
  the reader fits the page to the pane's width or shows the whole page on
  one toggle, and goes to a page by number. Beside the PDF, the moves
  panel sits next to the board where there is room and under it where
  there is not; on a phone the reader is the Board page's own shape —
  board on top, then Book, Moves and Engine as panes.
- **The importer files the PDF it scans.** Importing a puzzle book puts
  the PDF in the library too and links the puzzle book to it, so the book
  page offers Read; removing the library book leaves the puzzle book and
  its progress untouched. With a library called Books, the puzzle shelf
  under Puzzles is now "Puzzle books" everywhere it is named.
- **Settings shows storage used, area by area.** Games, studies, notes,
  books, puzzle books, puzzle progress, repertoire, PGN sources, the
  browsed-games cache, document history, reference databases and the
  explorer and tablebase caches, with a total — an inventory, cleared
  from each area's own page.

## 0.4.7

The app becomes a shadcn/ui project, and an import no longer needs
watching.

- **The app is a shadcn/ui project.** Every control is one of the
  registry's components — Button, Input, Dialog, DropdownMenu, Select,
  Tooltip, Tabs, Switch and the rest, Radix underneath — owned in
  `web/src/components/ui` and given the app's face, with nothing it had
  learned on a device thrown away: every window is still a bottom sheet on
  a phone that drags away from anywhere on itself, the back chevron still
  turns a window's page, the keyboard band still holds, Android's Back
  still closes the top layer. What changed for the keyboard and the screen
  reader is for the better: one Escape closes one layer, topmost first;
  focus returns to the control that opened a window even when its field
  took the focus as it opened; tooltips show on keyboard focus; menus have
  typeahead; the segmented choice is a radiogroup and the pane switcher a
  real tablist. The theme speaks shadcn's token vocabulary, derived from
  the app's own OKLCH ladder, so the hue, tint and contrast knobs keep
  working and a component added from the registry tomorrow is themed the
  moment it lands. The migration itself was measured against a 44-shot
  grid of the app at two widths and two themes and was pixel-identical
  through every step; then the look was let go: the app now wears
  shadcn's own design — its neutral theme (Neutral is the new default
  scheme; Slate, the old look, is one press away in Settings), its
  sizes and radius ladder, its focus rings, its dialogs, menus, tooltips
  and cards. Settings → Appearance gained shadcn's own knobs: its five base
  colours (Neutral, Stone, Zinc, Gray, Slate) as schemes beside the app's
  tinted ones, and a corner-radius setting (square, small, default, large)
  that every corner in the app derives from. Date filters are the registry's
  date picker (a calendar in a popover, in the app's language); every
  confirmation is the registry's destructive alert dialog. Two of the
  registry's numbers were retuned after the crops were measured: the
  pressed/selected fill sits a rung above the hover fill (a pressed toggle
  on a card was 3% of lightness from its surroundings in the light, 6% in
  the dark, and could not be seen), and the dark input chrome is shadcn's
  own translucent white, which the chosen tab's pill depends on. Tabs,
  toggles and toggle-group items show a `title` as the tooltip, as
  buttons do.

- **The screenshots and the landing page wear the new design.** Every
  image in the README and on the site is recaptured from the demo in both
  themes, and a `<picture>` picks the one matching the reader's system
  setting — the app follows that setting, so a white screenshot on a dark
  page was a picture of a different app from the one a click opens. The
  landing page is rewritten as shadcn's neutral theme by hand (the same
  tokens, the hairline-ring cards, the `--radius` ladder, the outline and
  primary buttons, the Tabs-shaped language switch), light at rest and
  dark under `prefers-color-scheme`, where it used to be dark only. The
  capture script forces the theme through the app's own store instead of
  inheriting it from whoever's machine runs it, which is how the last set
  came out dark.

- **Polish after the migration, measured on a phone.** The games panel's
  source tabs are shadcn's own underlined Tabs (the classes that styled
  them had never applied, so the registry's raised pill sat inside an
  underline strip); study cards centre the board against the title
  instead of pinning it to the top; every panel header is one height —
  44px, 52px on a touch screen — so the title no longer jumps when the
  phone's pane tabs switch between Moves, Engine, Chapters and Explorer;
  the phone's action sheet lines its rows up under its title. Panels
  stand their actions on shadcn's CardFooter: the puzzle and book
  trainers, the repertoire, and the puzzle solution recorder, whose four
  buttons used to float between the panel and the tab bar (its header
  undo goes — Start over does it). Settings → Appearance's colour scheme
  is a dropdown, grouped shadcn / Coloured / Contrast, like the rest of
  the card. In the move list a sideline's moves flow on from its first
  move the way lichess lays them out (the first move used to stand alone
  on its line), and sidelines hang from right-angle branch guides — ├
  while siblings follow, └ for the last — at every depth.

- **"Try harder on boards that fail" uses the whole machine too.** The
  search it is named for was never the cost: on a failing board it is 33
  ms of replaying candidate positions, against seconds to re-read the board
  itself — the same classifier as a normal read, run five times over so a
  cell that flips under a small shift can be spotted. That re-read already
  had the pool to run on and was not using it: boards went out one at a
  time, so five workers in six sat idle while one worked. They now go out
  as they are cut and are searched as their readings land, which is what
  the scan beside them has always done. Same boards, same candidates, same
  refusals — the puzzles come back in the same order, just sooner.

- **Reading a board is four times faster, and every import gets it.** Half
  of a board read is one 3x3 convolution, and every one of its taps was
  checking whether it had fallen off the edge of the image when only the
  outermost pixel ever can: separating the border from the middle is 1.73x,
  bit for bit the same answer — 832 probabilities compared against the old
  code, none of them different. The other half is the repair read's four
  extra passes over all 64 cells, which exist to catch a cell that changes
  its mind when the board shifts. Cells the classifier is sure of do not do
  that: across 2,496 cells of a real book, every one of the 93 that flipped
  had a margin under 0.4. Only the close calls are read again, at twice
  that margin for safety, which is 320 reads a board down to 153.

- **An import no longer needs somebody watching it.** Cover the window and
  a scan stopped on page one and said nothing about it, because pdf.js
  renders a page in pieces scheduled on animation frames and a window
  nobody is looking at gets none — measured, zero in two seconds. It now
  renders under the one intent that is not scheduled that way, which
  changes nothing about the pixels: both kinds of page a book can be, text
  and photograph, came out byte for byte identical. The waits between
  pages were on timers too, which a browser deliberately slows down in a
  background tab; they are not any more. Start a long book and go and do
  something else.

- **A greyscale scheme with black and white in it.** Greyscale took the
  colour out of the app and left the lightness where it was, so the name
  promised two things it did not have: the dark page bottomed out at 15.5%
  lightness and the lightest panel reached 29%, which is to say the whole
  app sat in the middle of the scale with nothing at either end. High
  contrast is that scheme with the scale opened all the way up — a #000000
  page under a #ffffff button in the dark theme, and the reverse in the
  light one, with text at 21:1 against the page. It is a fourth number on
  the same three-number scheme model rather than a palette of its own, so
  the eight schemes that came before are untouched: 320 token values, every
  preset in both themes, identical pixel for pixel before and after.
  Greyscale itself is one of them and stays the soft grey it has been.

## 0.4.6

A release about books and about the record of your own work: reading a
scanned one into the app at the speed the machine can actually manage,
and getting back a document you changed or deleted. Thirty-nine changes.

- **Reading a scanned book uses the whole machine.** Classifying a board
  is almost a second of inference and nothing else, and it ran on one
  worker while every other core sat idle — twenty minutes for a
  thousand-board book. Boards are independent, so they go out to a pool
  as wide as the machine less one core, which leaves the app usable while
  it runs. The 1,033 diagrams of a 1,001-puzzle book now read in 314 s on
  a 12-core machine.

- **The engine answers for the boards the book's own answer could not.**
  A scan that turns the printed solution to soup used to leave a
  position with nothing attached to it. Those boards are searched
  instead and imported labelled by how much is known — highest where the
  engine's line lands on the squares the book itself printed, lower where
  it is decisive with nothing to check it against, lower again where the
  position is merely legal and the side known. Nothing is taken on trust:
  every line is replayed from the position that gets stored, and what
  will not replay stays a draft. On the 1,001 book, 276 unreadable boards
  became 269 puzzles.

- **That engine pass costs 8 seconds, where it used to cost 137.** It
  searched one position at a time on a fixed half-second clock, so it was
  the one phase of an import a faster machine did not finish sooner. It
  is now a pool of single-threaded engines that stop at a depth rather
  than running the clock out — 16.7x on the same book and machine,
  measured end to end. The trade is stated where it is made: thirteen
  boards that used to be claimed now import badged one tier lower.

- **Every puzzle carries the page its answer is printed on**, verified
  tiers exactly as much as drafts, so the one kind that has a printed
  solution to check against is no longer the kind you cannot check.

- **A book's puzzles come back in the book's order.** The importer writes
  in passes, so a freshly imported book ran 955, 956 … 1001 and only then
  2, 4, 10 — grouped by how confidently each was read. Next, previous,
  the grid sheet and "next unsolved" all inherited that. Sorting by the
  printed number on the way out repairs the books already imported
  instead of needing their files rewritten.

- **The vault's history is readable from inside the app.** Every change
  to every document has been auto-committed to `vault/.history.git` since
  the first release, and using it meant a terminal. Now the clock in a
  study's, game's or note's header lists the times it was saved, shows
  what any of them held and puts one back, and Settings → Deleted
  documents recovers a document that is gone entirely. Restoring writes
  in place and is itself undoable: the state it replaces is committed
  first, so it is back in the list a moment later. Where a vault keeps no
  history — no git, the demo — both surfaces say so plainly instead of
  erroring.

## 0.4.5

A release about geometry: what the app does with a screen that is short,
sideways, upright or simply not the one it was drawn on. Thirty-six
changes, almost all of them measured on the pixel.

- **An upright iPad Pro stacks, like every other portrait screen.** The
  rule has always been that portrait stacks — a tall screen wants a huge
  board with the panels below it — and the one device named in the rule
  as the reason for it was the one device exempt from it: a width-only
  branch let anything at least 1024px wide go side by side, and 1024 is
  exactly the iPad Pro 12.9-inch portrait width. Measured at 1024x1366,
  the board was 448px filling 40% of the screen; one pixel narrower,
  where the portrait rule already applied, it was 792px and 98%. It is
  the wide one now, and the 13-inch M4 goes 448 to 800. The cost, stated
  plainly: a portrait desktop window at least 1024 wide stacks too.

- **A short or sideways window scrolls instead of cutting things off.**
  The board keeps a floor under it so a short landscape viewport cannot
  collapse it to nothing, and what that floor overflowed by was simply
  cut, with no scrollbar anywhere to say so — measured at 740x360, the
  board page lost 61px, the editor 71, the repertoire 59, both trainers
  45. Five pages, nothing lost now. A phone held sideways also squeezed
  the side column past the point of being a pane at all: at 667x375 the
  move panel was 18px around 40px of content. The column keeps a floor,
  and the page gives instead.

- **A panel is the height of what it says.** Panels had been grown to
  the bottom bar so a phone's column would not end in a band of page
  background, which bought a panel drawn a screen tall around three
  lines of text with the empty half of it inside the border. Blank space
  under the text belongs to the page, not to the panel. Both trainers'
  Puzzle panel and the repertoire's Game panel take their content's
  height again and shrink from there, and where they meet the column's
  floor it is the body that scrolls rather than the frame that runs past
  the edge. A phone gets the same 12px band under the last panel on
  every board page now, where it was 32 on some and 12 on others.

- **The buttons scroll with the text they answer to.** Pinning a row to
  a panel's floor kept it in one place for a thumb, at two costs: it
  held station while the text moved behind it, which reads as two panels
  in one, and a floor cannot shrink, so a short window squeezed the text
  to a couple of lines to keep a row on screen nobody was reaching for.
  At 375x600 the book trainer's body goes from 51px of a needed 92 to
  111px of a needed 152.

- **Every row of buttons ends the way every window in the app ends.**
  Right-aligned, a gap of 8px, the primary one last. The book trainer's
  primaries used to lead the row and stretch across it; the puzzle
  trainer's alignment jumped from one edge to the other the moment the
  puzzle ended; the link out to the game a position came from sat up in
  the body text as blue prose. One row now, in both trainers, and both
  say "Next puzzle". Settings' wipe confirmation, the most serious
  question the app asks, was the one place still standing its buttons as
  a row — it stacks now, destructive on top and filled, the way every
  other destructive question here already did.

- **A finished puzzle can be played again.** Retry replays the same
  puzzle from the top and reports nothing: the attempt that counts was
  decided the first time through, and a win sent after the solution has
  been seen would put a clean solve in the history for a puzzle that was
  given away.

- **A phone stays on the panel that says what just happened.** All three
  finishing screens used to move you to the engine pane the moment a
  puzzle was solved or a line ran out, on the theory that the evaluation
  was what you came back for — replacing the verdict, the difficulty and
  the themes, or the line's ending and the row of things to do about it.
  The engine is a second question, and it is one tap away. At the end of
  a repertoire line the engine also went on and straight back off again,
  and returning to the assessment started a second search of a position
  it had already scored; it shows the number it had.

- **The last move of a shown solution is a move.** Both trainers replay
  a solution a move per beat, and on the last one the in-place analysis
  swapped in a fresh board, which draws rather than animates — so every
  move of the line slid to its square except the one the replay was for.
  The swap waits one animation now.

- **The editor's Position sheet has a way out of it.** On a phone the
  sheet covers the board it edits and its fields write straight through,
  so there was nothing to press meaning "I have finished" and nothing at
  all that undid a change made with the board out of sight. It ends on
  Cancel and Apply, and only Apply keeps what changed — the chevron, the
  scrim, a drag down and a second press of the button had all quietly
  kept it, so the answer depended on which way you happened to leave.
  Side to move gets its king glyph, as the repertoire's has; the
  castling flags stopped wearing the colour this app paints actions
  with, and now say they are toggles out loud.

- **A long vault path breaks instead of running off the page.** A
  Windows path has no break opportunity in it at all, backslashes
  included. Measured at 320px wide, it ended 32px past the edge.

## 0.4.4

- **Text is the size other apps use.** Body copy had been sitting on the
  12px rung that Material, Fluent and GitHub all reserve for captions,
  with an unnamed 11px tier below it — on a phone, 70% of the size every
  other app on the device is read at. Body is 14px now, titles 16, page
  headings 20, captions 12. Lists and panels fit fewer rows per screen as
  a result; that is the trade, and it was worth it.

- **And a colour you can read it in.** Six tokens were under the 4.5:1
  small text needs, measured against every surface they actually land on
  rather than the two they were first checked against: the quiet label
  grey reached 3.16:1 in dark mode, and amber warnings 2.61:1 on a
  near-white page. All of them clear it now. The accent is a visibly
  deeper blue in light mode, which is what that cost, and white text on
  primary buttons went from failing to comfortable.

- **A note has room under its last line.** The document ended exactly
  where the page ended, so the line you were writing sat pinned to the
  bottom edge. There is room to scroll past it now, and clicking that
  space puts the caret at the end of the note. In reading mode the title
  is no longer pressed against the rule beneath it.

- **The opening map sees games you just added.** Add games and Grow found
  nothing; open My games first and the same Grow worked. The server was
  never the problem — a successful *empty* answer was cached for the life
  of the page, so "you have no games", learned once before you had any,
  stayed the answer. Empty is provisional now, and collecting games
  clears it outright.

- **The puzzle hub stops waiting on itself.** One request took 2.7
  seconds while every other one the hub makes took two to five
  milliseconds, and the page waits for all six. The weakest-theme tally
  was reading a table whose only index is the wrong one, scanning 27.6
  million rows per chunk. Off the primary key instead: 2.72s → 0.004s,
  same answer. The hub's four buttons also stay placeholders until the
  page has decided what they say.

- **The trainer sends you to the setup screen, not an error about it.** A
  vault with no puzzle database showed the trainer printing the setup
  screen's own advice in the one place that cannot act on it. Finishing a
  build had the matching bug in reverse — the page kept the last failure
  from before the database existed. A rebuilt database also swaps in
  properly now; the old handle was still open on the file being replaced,
  which on Windows made the swap fail outright.

- **Grow says what it did not find, and what it grew from.** "Nothing
  indexed" and "below the floor" are different answers and now read as
  different answers, and Grow can be pointed at a subset of your games
  rather than all of them.

- **The licences are a page of the app.** The link used to open a browser
  tab — in the desktop shell, a second window with no way back to the
  settings you were reading. It is a sub-route under the app's own header
  now, with a back chevron.

- **A misspelt handle says so.** Searching the online archive for a
  player who does not exist showed the same prompt as having typed
  nothing at all. A 404 from a player endpoint is an answer, and is
  passed on as one; anything else is still the network.

- **The board grows on a big screen.** It stopped at 736px on any
  display, because the row holding it was capped — a 27" monitor drew a
  13" laptop's board. Measured at 1920×945: 736 to 785, and bounded by
  the window's height now rather than by a number, so a taller screen
  gets more.

- **Ocean is the default board.** New vaults only; the choice is stored
  per device, so anyone who has already opened this keeps what they had.

## 0.4.3

- **The macOS app icon is drawn at the size macOS wants.** It was 512×512
  — the minimum the packager accepts, which had been read as the answer —
  so the generated `.icns` had no slot for its largest size and every
  Retina Finder was upscaling it. It looked like a broken thumbnail
  because it was one. Rendered at 1024 now; Windows keeps its 256, which
  is the most NSIS will take.

## 0.4.2

- **The desktop app's own vault works again — it never had a database
  driver.** Choosing a local folder failed with "The local server did not
  start", and the server it could not start was dying on "Cannot find
  package 'better-sqlite3'". The dependency was built and copied
  correctly and then dropped on the way into the app: app-builder-lib's
  copy filter opens with `if (relative === "node_modules") return false`,
  so a directory named exactly that, at the root of an extraResources
  source, is silently discarded whatever filter you pass it. Every
  platform, not just macOS. It is copied in an afterPack hook now, which
  throws if it does not land — so the next time this breaks, the build
  breaks instead of the app.

- **And the failure says where to look.** The screen said "check the
  terminal output" while the packaged app spawned its server with
  `stdio: 'ignore'`, discarding the only account of what went wrong. Both
  streams are kept now, in `server.log` beside the vault, and the screen
  names the file.

## 0.4.1

- **The macOS build is ad-hoc signed.** It carried no signature at all,
  and arm64 macOS will not load unsigned code — so a downloaded dmg was
  refused with "Chess Vault is damaged and can't be opened", which is a
  lie about a perfectly good download and sends people to the Trash with
  it. An ad-hoc signature costs nothing and needs no Apple account. The
  app is still not notarised, so the first open is right-click → Open, or
  one `xattr -dr com.apple.quarantine`; both are written down in
  `desktop/README.md` now, which said nothing about any of this before.

## 0.4.0

- **The opening map can be read as a tree.** The same nodes, the same
  sizes, the same edges, put in order instead of in a constellation:
  depth along one axis, siblings along the other, every parent centred
  over the children it owns. It grows sideways on a desktop and downward
  on a phone, and the device remembers which arrangement you were last
  in. A tree does not drift and its dots cannot be towed — that is the
  constellation's, where wandering a few pixels costs nothing; here it
  would make a straight line wander.

- **Prune, for a map too wide to read.** Scissors on a node draws the
  moves that lead there and everything that follows, and drops the
  siblings on the way — one press against the dozens that folding one
  node at a time would take. Restore the whole graph brings it back, and
  so does switching arrangements. Align fits what is drawn, which is also
  what switching now does for you: the pan and zoom you had were answers
  to where things used to be.

- **Home can drop a destination altogether.** Switching a tile off used
  to move it to the row under the grid and no further, so a destination
  you never use kept a button there for ever. There is a third place now
  — off the page — listed by name in the customise sheet and one press
  from coming back. Nothing is stranded: the sidebar and More reach every
  section whatever home shows.

- **The puzzle hub offers a theme worth practising.** Where a vault with
  no imported books had an empty slot, it now names the theme that loses
  most often — judged only once a theme has five counted attempts behind
  it, and only when it is doing worse than the vault's own average.
  Either way it says nothing rather than guessing, and no rate or rating
  is shown.

- **Waiting looks like what is coming, at the size it is coming.**
  Placeholders across the app were the wrong shape or the wrong height,
  so pages rearranged as they filled: shelf cards stood 20 px short of
  the real ones, a game row 16 px, the settings page drew its own column
  and then jumped into the page's. Board and note placeholders are now
  built from the pages' own layout constants rather than from something
  that resembles them, and each block holds its own place until its own
  answer lands — a panel that says "nothing here yet" before anybody has
  answered is worse than one that waits.

- **Two lists stopped taking two round trips.** The elite list asked for
  its databases and only then for its games; the online archive asked for
  its months and only then for a month. The first was the client's to
  fix, the second the server's — /months now carries the newest month's
  games with the list that names it.

- **The engine tab's line reads from the root.** It used to be walked
  through the cursor, so stepping into a variation made the variation the
  line and bracketed the mainline beside it, as if the tree rearranged
  itself around you. The cursor marks where you are; it no longer decides
  what the sentence is.

- **Analysing from a map node opens the line, not the map.** It handed
  the board the whole resolved tree with the cursor parked on your node,
  so one question arrived carrying every other line in the map.

- Smaller things: recent archive searches are one list rather than one
  per site; the archive window opens at the height it ends up at instead
  of growing under your thumb; the "Name this…" buttons are gone from
  studies, notes and books, where double-clicking the title already did
  it; a segmented control's parts are as wide as their labels; the start
  position's details no longer open under a keyboard on a phone.

## 0.3.0

- **The repertoire's new-game panel reads as a form.** Its four
  buttons — which mode, and which side you play — were one block of the
  same size and shape, with nothing to say which pair chose what. Both
  pairs now carry a label, in the style of the source and rating fields
  under them, and the side pair carries the king of its colour, so the
  two rows cannot be mistaken for each other at any glance. Open play
  is called **free play** rather than *spar*.

- **The Puzzles tab lands somewhere you can reach.** On a phone it
  opened the dashboard — counters, a difficulty breakdown and a
  200-row attempt log — which is a page to consult now and then, not
  the one to meet every time you reach for training. And the three
  shortcuts that made it usable as a hub were pinned to the top of it,
  the one corner a thumb cannot get to one-handed. The tab now opens a
  launcher: Train, and tiles for themes, books and the dashboard, all
  sitting on the bottom edge above the tab bar. The review queue
  appears there with its count when you have one. Nothing on it waits
  for the network to be usable, and the two things that do arrive late
  are placed so that no button moves once you have started reaching
  for it. Everything it opens comes back to it. Desktop is unchanged —
  the sidebar has listed all four destinations all along.

- **The opening map colours at once.** Checking a map against a field
  used to cost one request per charted position — hundreds of round
  trips from a phone to a small server — and the reference databases
  summed their answers live, which near the root meant summing most of
  the database on every visit. Every source now answers the whole map
  in a few batched requests (opening-name labels too, which were the
  same flood one request at a time), the reference databases answer
  the unfiltered question from per-move sums precomputed at build and
  tune time (measured on the live server: 4.7 s of summing for the
  first batch became 2 ms), and the Lichess source answers from the
  proxy's disk cache from the second visit within a day. The page
  holds the canvas behind a brief spinner until coverage, names and
  the field have all answered, then shows the finished picture once,
  whole — with a deadline past which a slow source falls back to the
  old progressive colouring rather than keeping the map hostage.
- **The map moves at any size.** The arrival overture, the idle drift
  and the drag physics all animated by re-rendering the whole scene
  through React every frame — roughly eight SVG elements per dot,
  sixty times a second — which is why maps above 160 nodes were kept
  still. One animation loop now writes positions straight onto the
  SVG while React renders the scene once, so the cap is gone: a
  400-node map scatters into place, breathes, and pulls like a web
  when dragged, the same as a small one.
- **The opening map is a page of its own, and reads like one.** It was a
  sub-entry under Tools, one indent down beside Board and Editor, which
  is not what it is: it is a standing view of the repertoire, the same
  kind of destination Games and Studies are. It now has a top-level row
  in the sidebar. Phones still reach it through More, because a seventh
  tab on the bottom bar leaves every tab about 50px to hold the longest
  label in the app. The page caught up with the rest of the app while it
  was there: the same title in the same size at the same distance from
  the edge as every other page, a search field on a row of its own, the
  map's two controls drawn straight onto the surface instead of parked
  in bordered squares, and a detail panel wide enough that its fields
  and statistics rows stop wrapping — at the old 18rem nearly every line
  in it broke. The canvas begins under the header now rather than
  running behind it, so nothing pans through the page's own title.
- **The accent answers what you are looking at.** Every covered dot used
  to be drawn in the app's accent, so highlighting a mainline in that
  same accent was one more accent thing among hundreds. The field is
  neutral now and the colour is spent on one thing: select a dot and the
  line the field walks from there lights up, all the way down, while its
  lineage back to the root answers in bright foreground — where you came
  from and where the crowd goes next, at a glance. Search, and every hit
  gets that at once, each line in its own colour, so "which defences do
  I actually face and where do they go" is one query. Focus on nothing
  and the map is calm. (The rule underneath changed twice to get here.
  "Mark the most-played child at every node" sounds like it marks the
  mainline and marks nearly everything, because an only child is
  trivially the most played — 54 of 63 edges on a test map. And a colour
  per search HIT is not a colour per line: searching "Ruy" over six
  variations matches 18 nodes, most of which stand on another hit's
  line, which is why the Berlin used to come out the colour of the
  mainline.)
- **The constellation behaves like one web.** Dragging a dot used to
  move that dot and freeze everything else. It now pulls: the held dot
  follows the finger, its neighbours follow their springs, crowding
  pushes back, and the whole thing coasts to a stop after you let go
  rather than stopping dead. Where you leave things is where they stay.
  Pinch-to-zoom also works from anywhere, including from two dots —
  it used to need both fingers on bare canvas, and a dense map has
  almost none, which made zooming on a phone nearly impossible. Pressing
  the selected dot a second time lets it go, and the floating button no
  longer wanders: it is parked in its corner, and it is phone-only,
  because a mouse wants a page's controls in the page's own corner.

- **You save when you choose to, and the pieces move while you read.**
  Games, studies and notes used to write themselves every 1.5 seconds,
  and edit mode existed to stop a reader overwriting what they were
  reading — which is why the board refused a move until you pressed the
  pencil. Nothing is written unasked now, so the guard has nothing to
  guard: the board is live in both modes, and the pencil is what it
  always looked like, a toggle for the NAG palette, comment boxes and
  move surgery. A change made either way is one pending change, with an
  unsaved badge, a Save and a discard beside it, `Ctrl/⌘ S`, and a
  Save / Discard / Stay here question on the way out — including the
  browser's own Back button. Auto-save is a setting under Settings ›
  Documents, off by default; turning it on restores the old behaviour
  exactly. Three things that used to be thrown away silently — following
  an engine line, playing an explorer move, promoting a variation — are
  now ordinary pending changes you can keep. Turning the board round
  still doesn't count as an edit.
- **A document keeps its unsaved copy in the vault.** Manual save has a
  hole in it: the pending buffer only ever exists in a tab, so a browser
  that dies takes it. A copy is now parked beside the document a few
  seconds after the last edit, and finding one on open offers it back —
  restore it, or throw it away. It comes back unsaved, so you can look
  before you keep it, and nothing is applied behind your back. Because
  the copy is in the vault rather than the browser, a phone that dies
  mid-annotation is recoverable at the desk. The parked copy travels with
  a rename, dies with a delete, is dropped the moment you save or
  discard, and never enters the vault's history repo.
- **Launch is the OS's startup image, and nothing else.** An installed
  phone app opens on a knight the OS itself draws — 72 startup images
  (18 geometries × both orientations × both schemes) generated by
  `scripts/render-icons.mjs` along with the `<link>` tags themselves —
  and then a quiet app-coloured ground while the chunks arrive. An
  in-page launch screen was built on top of that and retired: a second
  splash after the OS's own is a second handover, and every handover is
  a seam (`web/index.html` tells the story). The images follow the
  PHONE's light/dark, not the app's stored preference, because that is
  the only thing iOS can know when it picks one; Android gets its
  `background_color` in the scheme the phone is actually in, via a
  client hint. A browser tab gets none of this: a full-screen brand card
  in front of a page that was going to appear anyway is a splash screen
  for its own sake.
- **Bookmarks, and the three shelves that agree about them.** Pins became
  bookmarks with one icon and one order across Games, Studies and Notes.
  Studies and Notes gained the two empty states Games already had —
  nothing bookmarked, and nothing matching a search — so a filter that
  hides everything says so instead of looking like an empty vault. The
  search field and the bookmark switch now sit with the thing they
  filter: in the Collection panel's header on a wide screen, on a line of
  their own on a phone.
- **Browsed games are cached, and the cache can be emptied.** Browsing
  several players' archives quietly filled the disk with them, and the
  cache did nothing for the month you are actually playing in — the one
  you look at most. chess.com months now revalidate with
  `If-Modified-Since` and cost a 304 when nothing has changed; Lichess
  fetches only what is new since the last look and merges it. Settings
  shows what is stored, with one button that clears all of it.
- **A greyscale scheme, and opening names you can read.** Mono flattened
  the surfaces and left a blue button, link and nav highlight standing in
  an otherwise colourless app; the accent has its own tint knob now, so
  Greyscale means it. Separately, ECO tags and opening names were 2.3:1
  against the light theme's page — measured, and now 7.0–7.2:1, with dark
  unchanged.
- **Korean titles for books.** Creating a book named 제목 없는 책 failed
  with "that title cannot be a folder name": the slug was an ASCII
  allowlist that stripped every hangul character and then rejected what
  was left. Any title a filesystem can hold is now a title the vault can
  hold.
- **A study imported from a PGN names itself.** Lichess writes the study's
  name into `[StudyName]` and its chapters into `[Event]`; the title field
  fills from the first when every game agrees, and is left alone when they
  do not.
- **Page headings dropped their icons**, and windows with no button row
  gained a way out. A small subtle glyph repeating the word beside it was
  on five headings, every one `aria-hidden`. The engine settings and the
  puzzle difficulty picker, which apply as you touch them and so have no
  Cancel, now carry an X on desktop — a mouse has no drag-to-dismiss.
- **Fixed: a held step button that never stopped.** Holding Forward on
  the board could set the game walking through itself until the page was
  left. The repeat's timers were rebuilt on every re-render — and with the
  engine running there are many a second — so letting go cancelled a timer
  that was not the running one. Found on an iPad; it was never
  iPad-specific.
- **Your own games are explorable, and no longer a book.** 0.2.4 let you
  build an opening book from the vault's games. It did not work: a book
  reports its sources through `basename()`, which threw away the prefix
  that said "this is a vault game", so Rebuild answered 400 for every one
  of them. It could not have worked either — a book's source list is
  frozen, so rebuilding it re-reads the same games and never the ones you
  played since. And it was the wrong shape: a book sums the results away
  at build time, so it can only ever answer one question. The explorer
  now has a **My games** source that indexes the vault directly and
  filters at query time — by which side you had, whether you won *(read
  against your side, not the result string)*, the speed, and the date.
  Nothing is built and nothing is rebuilt; a game counts the moment you
  collect it, and a listed game opens on the board.
- **Pretendard is the app's typeface.** Inter has no hangul, so every
  Korean string fell through to whatever the OS carried and one screen
  mixed two typefaces at two apparent sizes, differently per machine.
  The English UI now pulls one 37 KB subset — less than the Inter it
  replaces — and Korean pulls only the blocks it draws. Moves are no
  longer monospaced: SAN is a word, not a column.
- **The rest of the UI speaks Korean.** Navigation, puzzle prompts,
  filter chips, board player placeholders, the editor's side-to-move
  buttons, and all 73 puzzle themes.

## 0.2.4

- **The sounds are ours.** The move and capture samples were lichess's
  `standard` set, bit for bit, and that set is on lila's non-free list —
  shipped in every installer and served by the demo with no licence to do
  so. Replaced with nineteen synthesised takes, and Settings now has a
  Sound card: which take, how loud, or rotate so a long analysis does not
  sound like one sample repeating.
- **Licences travel with the build.** `licenses/` reached nobody who never
  opened the repository. Every build now carries the texts and a page
  listing all 931 things this app is built from — bundled assets, npm
  packages, and Electron's 773 Chromium components (937 as of a 0.3.0-era
  build; the page counts itself) — each opening to its
  own licence text, with a link to its source. Generated from
  `node_modules` at build time, so it cannot go stale.
- **Opening books from your own games.** A book answers "what is played
  here"; pointed at your own games it answers "what do *I* play here, and
  how has it gone" — the same win/draw/loss data read against yourself. A
  new page under Tools builds one from the vault's own games or from
  uploaded collections.
- **Games in batches.** Select many from an archive and add them in one
  action, or pick *All dates* in the month selector and take a whole
  history. Uploading PGN collections is in the app too — it used to tell
  you to copy files into `vault/sources/`, which a phone cannot do.
- **Korean, everywhere.** Status and error messages were English whatever
  the language, including the server's own. All of them are translated
  now; a message with no entry falls back to English rather than breaking.
- **Desktop builds for macOS and Linux actually work.** They never had:
  an invalid `linux.desktop` schema failed every platform, the macOS icon
  was below the 512 px minimum, and the `.deb` had no maintainer. Found by
  running the workflow rather than reading it.
- **Every dependency updated**, including TypeScript 7 and Vitest 4, and
  the CI actions off deprecated Node 20.

## 0.2.3

- **Auto-update actually works.** It never had. electron-updater is
  CommonJS, so `await import()` puts its exports under `.default` and
  destructuring `{ autoUpdater }` gave undefined — the check threw on
  every launch, the error went to a console nobody opens, and the app sat
  on 0.1.0 while the feed served three correct builds. This is the last
  release that needs installing by hand.
- **The desktop app's own server no longer answers the network.** Local
  mode has no password, by design, but it was bound to every interface —
  so opening the app on a shared network published an unauthenticated
  vault to it. Loopback only now.

## 0.2.2

- **Settings says what is running** — the server's version and, in the
  desktop app, its own, with a check that reports what it found. The
  health endpoint had been returning a hardcoded 0.1.0 for two releases
  while another endpoint read the real one, so the same page could
  disagree with itself.
- **Castling either way** — drop the king on g1 or on its own rook,
  whichever your hand expects. Both were always legal; only one was
  offered.
- **macOS** — the shell keeps running with its windows closed and comes
  back from the dock, and `npm run desktop:package:mac` builds a dmg.
  Unsigned, so Gatekeeper wants a right-click and Open the first time.

## 0.2.1

- **Switch vault from Settings** — the desktop shell's only way to change
  where it points was a menu bar hidden behind Alt. It is a card in
  Settings now, shown only when there is a shell to talk to.
- **A redeploy no longer blacks out an open window** — every section is a
  hashed chunk, so a deploy replaces the ones an already-open page is
  about to ask for; that page now reloads itself once rather than
  unmounting into a black screen.
- **Colour schemes**, six presets. Clicking beside the swatches no longer
  silently picks the first one — they were inside a label, which forwards
  a stray click to whatever control it finds first.
- The sidebar names the host it is connected to instead of always
  claiming to be local.

## 0.2.0

The first desktop release served from your own server rather than from a
public repository, and the first with the book importer needing no
configuration at all.

- **Notes gained a formatting toolbar** — bold through quote, plus insert
  a board, pinned with the note's header at the top of the page. Two
  other placements were tried and rejected: floating over the selection
  meant selecting text before you could insert anything, and a bar above
  the keyboard collided with iOS's own accessory row.
- **Editing is one idea across Games, Studies and Notes** — one Edit
  button in the header, double-click a title to rename, nothing hidden in
  a panel.
- **The book importer works the book out for itself** — numbering, label
  geometry, notation, answer pages and figurine symbols, all derived. 714
  solutions verified by replay on 1001 Chess Exercises, against 707 for
  the hand-tuned offline pipeline without its glyph pass.
- **Opening a book is a fraction of the weight** — the largest book's list
  went 1,856 KB to 283 KB, its grid builds only the rows on screen, and
  the shelf's covers went 1.77 MB to 262 KB.
- **Every page shows the shape of what it is loading**, and says nothing
  at all when the wait is short.
- **The installer is 108 MB, not 376** — it was shipping the server's
  whole dependency tree.

## 2026-08-10

- **Importing a book needs no configuration** — the app works out the
  book's numbering, where its numbers sit beside the diagrams, how it
  writes its answers and where they are, and what its figurine symbols
  mean, all from the book. On 1001 Chess Exercises that is 714 solutions
  verified by replay, against 707 for the hand-tuned offline pipeline
  without its own glyph pass. Numbers the scan lost entirely are deduced
  from the gaps they leave; board repair is offered as a checkbox with
  what it costs stated, because it buys 26 puzzles for twenty minutes.
- **Opening a book got much lighter** — a book's list no longer carries
  the positions, solutions, evidence or timestamps that only the solver
  and the source pane read. The largest book went from 1,856 KB to
  283 KB, and its grid now builds the rows on screen rather than five
  thousand tiles. Covers were 1.77 MB of page renders for five
  thumbnails; they are 262 KB.
- **Loading looks like loading** — every list, board and form sketches
  its own shape while it waits, held back long enough that a fast load
  shows nothing at all. The moves panel is named for the line it holds:
  the opening (with its ECO code) on the board and in games, the chapter
  in a study.
- **Editing is one idea** — Games and Studies follow Notes: one Edit
  button in the header, double-click the title to rename, no second
  pencil hidden in a panel.
- **Desktop releases without a public repository** — the shell updates
  from a feed the server hosts, so the source can stay private. The
  installer also stopped shipping the server's dependency tree: 376 MB
  to 108 MB.

## 2026-08-09

- **Reading vs editing everywhere** — Studies, Games and note boards
  open in reading mode with the pieces locked; the pencil (or a note's
  Edit) unlocks moving, NAGs and comments. Games gained the same toggle
  so a missed sideline can still be recorded deliberately.
- **Book trainer reshaped** — the book solver now matches the lichess
  trainer's layout: a Puzzle panel owns the status and actions (Submit
  included), the puzzle grid reveals from the panel header, and the
  phone bottom band navigates moves. The duplicated mobile action bar
  is gone.
- **Repertoire grows up** — all 3,810 ECO openings are searchable in
  the opening picker (curated spread stays as the default), the first
  move shows in the moves panel, the seeded opening's last move is
  highlighted on start, and replies land at a steady pace instead of
  instantly-or-slowly.
- **Solutions pane restored — and protected** — a re-import had
  silently dropped the solutions-chapter enrichment from all three
  books. The pages are re-rendered and re-stamped, and the importer now
  carries the enrichment across rebuilds.
- **Games page** — the collection box is always present (empty state
  lives inside it), archive browsing survives back-navigation, and a
  game preview can no longer click through to the game behind it.
- **Notes** — the shelf keeps a stable name order instead of
  reshuffling by last touch.
- **Drafts join the puzzle list** — imported-but-unsolved diagrams
  appear in the book's puzzle list as a Draft fidelity tier instead of
  a separate panel.
- **Example content** — annotated Morphy and Anderssen games, two
  studies and two linked notes ship as first-run examples; README
  screenshots show them.
- **Ops** — deploys build the web app locally and ship `dist/`
  (the 2 GB server stopped OOM-ing on builds), SSH rides the tailnet
  with public 22/80/443 closed, and the desktop app auto-updates from
  GitHub releases.

## 2026-08-08

- **Two more books read** — per-book import configs, an engine pool
  with a persistent search cache, and solution-constrained board repair
  (the book's own line fixes misread diagrams). The benchmark scans
  reached ~3,150 verified puzzles across three books; what a book
  yields lives in the vault of whoever imported it, never here.
- **Fidelity tiers** — every imported puzzle wears an honest
  provenance mark (book solution → engine-verified → unverified), with
  plain-words labels and shape-coded icons.
- **CellNet fine-tuning** — the board reader retrains on the books'
  own validated positions; round 2 hit 1,891 boards.
- **iOS keyboard lesson** — the app stops fighting the keyboard
  animation and corrects scroll only after it closes.

## 2026-08-07

- **Book puzzles arrive** — the ML import pipeline reads scanned
  tactics books: diagram detection, CellNet position reading, printed
  solution parsing, replay verification, per-puzzle evidence crops with
  a one-click peek at the original scan.
- **Puzzle trainer** — lichess-themed training with difficulty bands,
  a progress dashboard, and failed-puzzle review.
- **Mobile pass** — contextual bottom bar as move navigator, one-pane
  layouts under the board, touch-friendly previews and pickers.

## 2026-08-06

- **The foundation** — plain-files vault (Obsidian-heritage), analysis
  board with Stockfish 18 WASM, position editor, PGN chapter studies
  with lossless round-trip, markdown notes with embedded boards and
  wiki-links, curated game collection, chess.com/Lichess archive
  browsing, elite reference games, opening explorer, game review with
  accuracy and brilliancy detection, PWA + Electron desktop shells,
  password gate with optional TOTP.
