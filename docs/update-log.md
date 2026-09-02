# Update log

*English · [한국어](update-log.ko.md)*

What changed, newest first. Feature-level entries, not a commit ledger —
`git log` has the full detail.

## Unreleased

The explorer stops guessing once the pieces run out: under seven of them
it says what the position IS — won, drawn, lost, and how far away — with
every legal move ranked by the truth rather than by what happened to
other people.

- **Exact endgame verdicts, above the game statistics.** Any position of
  seven pieces or fewer now carries a Tablebase block at the top of the
  explorer: the verdict for the side to play, the distance, and every
  legal move with its own verdict, playable with a click. Winning moves
  come first and shortest first; losing ones come last and LONGEST
  first, because when nothing saves the game the best move is the one
  that gives the opponent the most chances to go wrong. The fifty-move
  rule's own two categories are kept rather than flattened — a "cursed
  win" is a win the rule draws, and it wears the draw's colour, since
  that is what the game ends in.

  It sits above the statistics rather than replacing them: under seven
  pieces a database usually has nothing to say, and the two are
  different questions anyway. Measured at the explorer's default height,
  six rows and their header took 209 of its 300 pixels and left the
  statistics five and a clipped sentence — so the block is capped at
  just over half the panel and scrolls inside its own share.

- **Asked once, kept for good.** The server probes Lichess's public
  Syzygy tables (no token, unlike the opening explorer) and writes every
  answer to `data/tablebase-cache`, with no expiry: game statistics
  drift daily, a tablebase result is a fact about a position. An ending
  looked at once is answered offline afterwards, including the answer
  "no table holds this", so a miss costs one request ever. The Storage
  card's "Tablebase cache" row has been listing that folder since the
  card existed; it now has something in it.

  Out of reach and not yet cached is one amber line and a Try again,
  under the word Tablebase — the pane's own answer stays on screen
  underneath, because an ending nobody could look up is a smaller loss
  than an ending nobody can explore.

- **The review stops guessing about endings too.** Engine review now
  judges a move under seven pieces on the RESULT it left behind, not on
  the score it moved: a blunder is a move that turns a win into a draw
  or a draw into a loss, by any distance. Mate in 5 to mate in 40 throws
  away nothing and is no longer a mistake; a quiet king move that
  concedes the draw is one however small the evaluation swing. There are
  no endgame inaccuracies any more, because there is no such thing as
  slightly losing a won ending.

  The fifty-move rule is part of it, which is the case that proves the
  rule is really the table's: the same king move, in the same position,
  is a blunder with a fresh counter and no mistake at all ninety-nine
  plies later — by then the win was already cursed, so nothing was
  thrown away. Cursed wins and blessed losses count as the draws they
  end in, here exactly as in the explorer's colours.

  What it does NOT do is fake a number. Accuracy and centipawn loss stay
  the engine's measurement, for the same reason a book move keeps its
  own: withholding a verdict is not the same as inventing a figure, and
  an accuracy that jumped to 100 the move the pieces ran out would be a
  number about nothing. The summary counts how many moves the tables
  judged, beside the count of book moves — both saying the same thing,
  that some of these were not the engine's to judge. No move under the
  tables is called brilliant: "!!" is chances offered against material,
  and where the result is known there are none.

  The probes ride the walk the review already makes, so they cost
  nothing extra, they stop at the first failure rather than spending
  thirty round trips learning the network is down, and everything they
  learn is cached like any other lookup. Switched off in Settings, the
  review judges the whole game the way it always did.

- **Or from the table files themselves, with no server at all.** Point
  Settings → Tablebase at a folder of Syzygy `.rtbw`/`.rtbz` files and
  the native core reads them directly: no second program to install, no
  network, nothing leaving the machine. It is the binary's first
  RESIDENT mode — every other job it does starts, burns CPU and exits,
  where this one holds its tables memory-mapped and answers questions
  for as long as it is wanted, because a probe from a warm mapping is
  microseconds and starting a process to make one is tens of
  milliseconds. The native counterpart of the resident scan worker, and
  the same shape for the same reason.
  
  It answers in Lichess's own format rather than the app's, on purpose:
  the point-of-view flipping and the move ordering stay in one place,
  in TypeScript, so both sources go through one normaliser instead of
  two that could drift.

  The reading itself is not ours and neither is the trust in it: the
  same Rust crate does the decoding here and inside lila-tablebase, so
  what this release added is the wrapper around it — the piece-count
  gate, walking the legal moves, and reporting each from the right side
  of the board. `npm run check:tablebase` holds that wrapper to the
  reference server, walking random endings and comparing every verdict,
  the position's and every legal move's: 120 positions, no disagreement.
  What it cannot catch, and says so, is the shared decoder being wrong —
  both sides would be wrong together. Distances read DTZ rather
  than DTM, because Syzygy holds no distance to mate; the pane already
  says which it is showing.

- **Or answer from your own tables.** The server Lichess runs is open
  source, so Settings → Tablebase takes an address as well as a switch:
  run lila-tablebase over a copy of the tables and point this vault at
  it, and no position leaves your network. It is a vault setting, not a
  device one — which tables this vault trusts is the same question from
  a phone — read per request, so saving one takes effect without a
  restart, and validated in one place, so what the page accepts is
  exactly what will be asked (http or https, no query, since the query
  is where the position goes).

  Each server keeps its own corner of the cache, because they need not
  hold the same tables: a five-piece server at home must not be able to
  write "nothing here" into the slot where the seven-piece one has
  already said "win". The public server keeps the name it had, so
  nothing already cached is stranded. Which one answered is on the
  Tablebase label, as a tooltip rather than as printed text — one word
  and a hostname would push the verdict itself off the end of the strip.

- **And a way to forget them.** A cache with no expiry is right for a
  fact and wrong for a source that has since LEARNED something: point a
  vault at a server holding the five-piece tables, look at a six-piece
  ending, and "no table holds this" is on disk for good — adding the
  six-piece tables afterwards changes nothing, because nothing asks
  again. Settings → Tablebase now has the way to ask again, and says how
  many answers it dropped. It clears the tab's own memory of them too,
  or the button would only half work. The other two reasons to press it
  are wanting the disk back and not wanting a record of which endings
  you studied.

- **Settings → Tablebase turns it off.** It is the one lookup the app
  makes without being asked for one — no source to select, no button to
  press, just a position small enough — so it says plainly where the
  position goes and what is kept, and a switch answers no. Off, nothing
  leaves the machine. The demo does not probe at all: a page that
  reaches a third party the moment somebody drags the pieces into an
  ending is not a demo of this app.
- **Checkmate no longer reads as a dead-level position.** With the engine
  on, a board that was already mated drew the eval bar split exactly down
  the middle with a dash for a score — the one position on the board whose
  value is not in doubt, shown as the one value it cannot have. Stockfish
  says nothing about a finished position (it answers `bestmove (none)` and
  no variation), and the bar was waiting for an answer that never comes,
  while the Engine panel beside it had known to score such a position by
  rule since it was written. The bar now does the same, and it names a
  finished game the way a scoresheet does: a mate falls all the way to the
  winning side and prints `1-0` or `0-1`, with the hover saying which side
  won in words. A draw keeps its number — `0.0`, which is what a draw is
  worth and what the bar already prints for any dead-level position. A mate
  still to be PLAYED is untouched at `#1`, and can no longer be read as one
  that has already been delivered. The repertoire's end-of-line assessment,
  which prints its own number beside its own bar, now says the same thing
  in the same words: a drill or a spar that finished in mate is headed
  `1-0` or `0-1` rather than `-#1`.

- **A browsed player can be cleared on its own.** Settings → Browsed games
  listed every player whose months are cached, with one button that took
  all of them. That was the wrong shape for the list it sat under: the
  handle you browse every week is in it beside the half dozen you looked
  up once, and clearing the lot to be rid of the curiosities re-downloaded
  the months actually in use. Each row now carries its own bin (“Clear this
  player's months”), and Clear all still takes everything. Deleting from
  the page also makes Storage used below re-read, which had been showing
  the size it loaded with — a card apart, two answers for the same thing.

- **The native core is held to its TypeScript twin by more than
  fixtures.** `native/` re-implements four database jobs, and when the
  two sides disagree the result is silently wrong rows, never an error.
  Three things now hold them together that did not. The SQL every table
  is created with, and the constants both sides carry as literals, are
  pinned to the goldens — and the first run found the Rust build two
  commits behind, three indexes and the `events` lookup table missing,
  invisible to a diff of the data tables, so a database built by the
  binary now has what the JavaScript build has. The fuzz that compares
  the two live implementations on a random corpus runs in CI on every
  push beside the fixtures, two seeds, one fixed so a failure
  reproduces anywhere. And deep search's native scan now reports only
  WHICH games hit: the server composes every frame itself and replays
  each hit through its reference scanner before streaming it, so a
  wrong hit becomes a log line instead of a row on screen. Measured
  with a binary built to misreport: nine hits overruled, the frames
  streamed identical to the JavaScript path's. A repo check keeps every
  Rust file naming the TypeScript it mirrors.

- **A six-hour job with nothing to say for the last three.** Building a
  database's position index printed a line every 25,000 games and then
  went quiet. The three passes after the replay — the index over the
  positions, the per-move sums, the key inversion — each ran as one long
  database statement that announced itself and then said nothing at all
  until it returned. At the size this was written for the gap is
  invisible: an Elite month indexes in 80 seconds end to end. On the
  largest reference database built here, 10,355,488 games and
  309,324,101 positions, the pass took 6 hours 11 minutes, of which the
  per-move sum alone was over an hour of silence — and the Databases
  page, which shows the newest line the job printed, sat on "summing per
  move" with nothing to separate that from a crash.

  Each phase now names itself as it starts and says where in the WHOLE
  job it is, which is what the page draws: a bar weighted by phase
  rather than by games. The games count is the thing that misled. It
  fills as the replay ends and then holds at the finish through hours of
  work still to come. The key inversion — the one late phase that walks
  rows this side has already counted — reports real progress as it goes.

  The other two are single database statements with nothing able to see
  inside them, so rather than invent a heartbeat the page reports the
  silence: past two minutes without a line it says the step is one
  operation that reports nothing until it finishes, and how long that
  has been.

  While there, the explorer's offer to index a database it finds without
  one has stopped promising "a minute or two". That was true of the
  corpus it was written for and wrong by two orders of magnitude at the
  sizes a reference database now reaches; it says a small database takes
  a minute and millions of games can take hours.

- **A page you launch into no longer waits a third of a second before it
  asks for its data.** Every section but Home loads as its own chunk, and
  React suspends the first time it draws one — which commits the blank
  fallback, and once a fallback has been committed React holds what
  replaces it back for 300 ms so that a spinner cannot flash past. On a
  launch there is no spinner to protect: the page was ready and simply sat
  there. Measured on a cold launch against a local server, the Databases
  page rendered at 171 ms and did not appear — or fetch its own contents —
  until 453 ms, with its chunk in hand since 139 ms and nothing running in
  between. Sections are now loaded without that boundary: the same blank
  box is held as ordinary state and replaced the moment the chunk lands.
  The same cold launch makes its first request at 165 ms instead of
  447 ms and has the list on screen at 215 ms instead of 956 ms; Board,
  Games, Notes and Puzzles were measured and gain the same 250–290 ms.
  First paint is unchanged, deliberately: holding the first render for the
  chunk was tried, and on a 1.6 Mbps link it pushed the fonts behind the
  download and cost 1.4 s of blank screen to save 300 ms. On a link that
  slow the throttle never cost anything anyway — the download outlasts
  it — so this is a straight gain on a fast connection and neutral on a
  slow one.

- **The Databases page asks for both of its lists at once.** The uploaded
  PGN collections were listed by the panel that the databases list brings
  on screen, so the request for them could not start until the databases
  had answered — two round trips in a row for two questions with nothing
  to do with each other. Measured against an emulated 200 ms link, the
  collections landed 242 ms after the databases did; they now land
  together. On a fast connection nothing looks different, which is where
  the wait was invisible to begin with.

- **A progress bar that ignored the number it was given.** The shared bar
  filled its whole track whatever its value said — 16% and 100% drew the
  same thing. No bar on screen showed it: the solved/failed bar draws its
  own two fills for its own reason, and Settings' download bar had been
  made to draw its own after the trap caught it there. What was wrong was
  what the next caller would get, so the third time it came up it was
  fixed at the source rather than worked around again. The cause is a
  leftover: the fill used to be positioned by sliding a track-wide block
  into view, which needs a rule saying grow to the track; when it changed
  to stating its own width, that rule stayed, and grow beats width.
  Measured on a 256px track, bars at 0, 16, 30, 73.5 and 100% each drew
  100% before and now draw exactly what they say. Settings' download bar
  drops its workaround and is the plain bar again; the solved/failed bar
  keeps its two fills, which it has for its own reason, and measures 30%
  and 20% either way.

## 0.7.2

A phone swipe that brings the panel you asked for along with your thumb
instead of nodding at you and swapping once you let go; light mode's panel
edges visible again on a screen held at arm's length; and pages that hold
still while they load — the Games pane opening on your own games, the home
page no longer sliding half a screen as its panels arrive.

- **Another round against placeholders that lied about their size.** Nine
  more stand-ins were re-read against the elements they stand for and
  fixed: the Settings recovery card reserved 112px for a card that
  measures 146 (it now draws the card's own heading and its paragraph's
  real words, invisibly, so it wraps right at every width — measured 146
  against 146); the home checklist reserved one line per step where its
  sentences wrap to two on a phone and its header had no room for the
  dismiss button a thumb gets (measured at 375px: placeholder and card
  both 213px, row for row); and smaller cases of the same defect in the
  opening map's tag list and field table, the grow dialog, the archive's
  lookup rows (which now dress for table density, header included), the
  cycles panel's line spacing, the note placeholder's scroll floor, and
  the board pages' side column, which now scrolls where the real ones do
  and reads the chapters height this device already dragged the panel to.

- **More pages remember their own shape.** The reservation idea the home
  page shipped with — size the wait from what this device saw last time,
  never trust it past one answer — now covers four more waits. The
  puzzles page remembers whether the vault has a puzzle database, so a
  vault without one waits on the setup card's own shape instead of
  drawing the whole trainer and replacing it wholesale. The theme wall
  remembers its histogram — the most stable
  shape in the app — and now reserves its exact sections and cards
  (measured: pixel-identical through the swap, where the old guess stood
  3 sections for 9). And the puzzles hub reserves the "Solved today"
  line on the days it was actually there, dated so yesterday's training
  cannot invent a line this morning.

  A second batch takes it to the rest of the app. The puzzle dashboard
  reserves its three variable blocks — the review slot's four possible
  shapes, the Books panel down to the EmptyState an unbooked vault
  actually settles into (taller than the rows it used to invent), and
  the attempts list inside its own 384px ceiling; measured, every panel
  holds its exact place through the swap. The studies, notes and book
  shelves reserve their own grouped shape — cards at the root, cards
  per collection under its 24px header, which was never reserved at all
  — and the grid card's excerpt reservation catches up with its
  two-line clamp, which a stale measurement had pinned at one; the
  studies shelf now measures pixel-identical through the swap. And each
  puzzle book's page remembers that book's own tile count and whether a
  cycle was open, so a twelve-puzzle book no longer collapses four rows
  of a 48-tile guess. The floors follow each page's own facts: a shelf
  something is seeded onto floors at one card, one nothing seeds at
  none.

- **The pane swipe carries both panels now.** Turning the panels under a
  board on a phone was a lean and a swap: the open panel followed half of
  what the thumb travelled, stopped at 32px, and the next one appeared on
  release. What the gesture asks for is the next panel, and the next panel
  was the one thing not on screen while it was being asked for — so the
  32px was a panel nodding at you, and the turn itself happened after the
  hand had let go. Both panels travel together now, a 12px gutter apart,
  one to one with the finger across the full width of the column: the panel
  being left goes out as the arriving one comes in, and letting go pulls in
  only the gap that is left. It turns at a third of the way across or on a
  flick — 0.5px/ms over the last 100ms of the path, because the gesture
  people actually use to page is fast, and a fast gesture is a short one.
  Both walls read the same way: at the first tab or the last, and past the
  arriving panel, the row gives a fifth of the movement up to 24px and
  stops, so an end of the strip still says so during the gesture and one
  swipe can never turn two panels. The tab's pill fills on the release
  frame rather than when the motion ends, because the turn completes by
  RE-ANCHORING and not by moving: the arriving panel is made the open one
  where it already stands and the offset is restated from its point of
  view, which changes nothing on screen and leaves only the gap to
  animate. The panels are still separate elements at the heights every
  board page has tuned — the arriving one is lifted out of the column's
  flow into the open panel's own measured box, so a column that has never
  laid out two panels at once still does not — and the offsets are still
  written straight onto the column, so the whole gesture costs two React
  renders: one to put the neighbour on screen, one to take it off again.
  Which panel is which is read from what was on screen before the
  neighbour arrived, never from the DOM order: the trainers render their
  panes in a different order from their strip, and an order read twice is
  an order that drifts. The control row at the column's floor stopped
  travelling with the panels — it is furniture the turn is measured
  against, like the tab strip above. Under `prefers-reduced-motion` the
  swap is still the instant one it always was. Measured with trusted touch
  input at 390x844, on the board page, on a study and on the puzzle
  trainer — which mounts its neighbour rather than unhiding it: a 366px
  column gives a 378px trip, a 220px drag puts the two panels at -208 and
  +170 with 12px between them and both at the full 311px height, the strip
  fills on release while the row slides the last 64px home, and at rest the
  column carries no attribute, no custom property and no compositing layer.

- **Light mode's panel edges became visible again.** In light the page,
  the cards and the panels are all the same white — deliberately — so the
  only thing separating a panel from the page is a one-pixel line, and
  that line was too faint to survive a phone screen: the default border
  measured 1.26:1 against the page, the card ring 1.25:1, and on the board
  pages the bottom panel and the move bar read as one unbroken sheet. Dark
  mode never had the problem, because its surface ladder separates panels
  by fill and the border is only the second cue. Three moves, all in the
  tokens: the light border rests at 88% now instead of the registry's
  92.2% (1.44:1 on white, measured), border-strong steps down with it to
  82% to stay a distinct rung, and the card ring is drawn in the border
  colour rather than a fixed 10% wash of the foreground. That last one
  also repairs the High contrast scheme, which moves every border through
  the contrast knob and could never reach the old ring — the one scheme
  chosen for legibility left every card edge at 1.3:1. It now takes them
  to 3.6:1 with everything else. The third text tier moved a step darker
  with them (51.5% from 53%): measured on the selected-row fill it sat at
  4.25:1, under the 4.5:1 floor small text needs, and the comment beside
  the old value claimed a clearance the arithmetic never supported.

- **The Games toolbar stopped rearranging itself while the list loaded.**
  The filter controls are drawn only when there are games to filter, and
  that condition cannot tell a list still arriving from one that is empty.
  At table density they sit in the toolbar itself with no band holding
  their place, so they appeared the moment the load landed and shoved the
  search box from 1078.5px to 731.1px — a 347px lurch in the row the eye
  is already on. They now draw from the first paint: all three are fixed
  option sets that read nothing from the games, so they look the same
  before the answer as after, exactly as the search box beside them
  already did. Placeholder bars could not have done this job, because a
  control is as wide as its label and a label moves with the language —
  106/93.9/93.9px in Korean against 144.4/104.4/102.6px in English, so no
  one set of bars is right in both. The count beside them has stopped
  lying too: it read "0 games" next to six loading rows and then jumped to
  the real number, and it is now a bar of its own size, measured at 65.5px
  in Korean and 71.9px in English. The same measurement now reads 1.5px,
  which is that bar landing and nothing else; the Import button does not
  move at all. A vault that had games and is empty now holds the space
  once, drops it when the empty list arrives, and opens elsewhere from the
  next launch.

- **Games opened on the reference databases instead of on your own games.**
  Which tab the page opens on is decided before the first paint, and the
  only thing it could ask was a copy of the collection that lives for one
  session. That copy holds whole games, so it is empty at every launch,
  and a cold start therefore guessed the databases every time — then moved
  to the collection once the real list arrived. Measured over three cold
  launches against a warm local server, the wrong tab was up for about
  85ms each time, and 280ms against a server still warming up. It was long
  enough to finish: the reference list was showing its full count before
  the swap — 3,436 games in the vault this was measured against — which is
  why it read as somebody else's games appearing rather than as loading,
  and two requests for those games were made and thrown away. The page now
  remembers the one thing it needs — whether the collection had anything
  in it — so it opens on your games directly and asks for nothing it will
  not show. A device that has never opened the
  vault, or last saw it empty, still takes the old path once and is right
  from the next launch. The correction only ever moves toward your
  collection: a collection emptied since the last visit opens on its own
  empty state rather than having real rows swapped out from under it.

- **Two panels that moved the page while it loaded.** The home page's
  Continue card has been reserved to the pixel for two releases, and it
  still jumped on every launch — because the page is CENTRED, and the two
  things below it were not reserved at all. An unreserved panel on a
  centred page does not push what is under it down; it moves everything by
  half its own height, including whatever was carefully held still above
  it. Measured at 1920x1080 against the demo vault: the dashboard grid and
  the setup checklist arrived worth 611px between them, and the Continue
  card travelled 306px up the screen as they landed. Both now reserve
  their place from what this device saw last launch, the same paint hint
  the card itself uses — four row counts for the dashboard, because its
  panels sit two to a row and a row is as tall as the taller panel in it,
  and one flag for the checklist, which is three fixed steps or nothing.
  A launch that was wrong about either is corrected by the vault, as
  before. The same measurement now reads 0px: the block is 885px tall
  before the answer and 885px after it, and nothing on the page moves.
  A device that has never opened the vault reserves the floor every vault
  starts at — for the checklist that floor is nothing, since it is the one
  card here a settled vault has finished with for good.

- **The workspace stopped growing sideways when the engine came on.** The
  eval bar's 36px lane is added to the board's column rather than taken
  out of the board, and the page's one width cap — which is what keeps the
  top row and the games band under it lined up as one block — was counting
  the lane as part of the board it allows for. On a window with slack the
  moves and explorer columns absorbed it, as intended; on a full-size
  desktop, where both columns are already at their caps, there was no
  slack and the cap itself grew instead. Measured at 1920x1080: 1643 →
  1679px, moving the whole page 18px left the moment the engine was
  switched on. The cap now counts the board without the lane, so the two
  columns pay for the bar at every width — measured at 1920, the page and
  the board both hold still and the explorer gives up 34px.

- **The demo's players have ratings a human could have.** The sample games
  were rebuilt on real chess last release and kept their old numbers: sixty
  ratings running from 2504 to 3661, thirty-seven of them at 2900 or above,
  and one two hundred points beyond anything ever achieved. They also moved
  by hundreds of points between two games of the same player a fortnight
  apart, because each game had been given its own number rather than each
  player. Every player now has one rating — 2581 to 2789, which is a strong
  invented circuit — and it drifts by a dozen points across their games,
  the way a rating moves over a season. Nothing else about the games
  changes.

## 0.7.1

The demo, which now carries a written vault, a puzzle book made from the
book it ships, and the safety net it could previously only describe; every
loading placeholder sized from what is about to replace it; and a desktop
update that says what it is doing while it does it.

- **A game's result stops fading into the row it sits in.** The result
  chip is tinted from your own point of view where the game says which
  side is yours — green won, red lost — and the tint was a wash of the
  text colour, so the games row's own fill arrived under it whenever the
  pointer was on the row. Measured on the games list, the digits fell to
  3.58:1 in light and 3.02:1 in dark against the 4.5:1 small text needs.
  An old fault that nothing could see until this release's sample games
  carried a side to win or lose from. Moving the colours does not reach
  it — light needs to darken nine points before hover clears the floor,
  and dark never clears it at all, because what moves under the pointer
  is the fill and not the text — so both tints are opaque now, at the 10%
  every other tint in the app already used. Rest and hover measure the
  same, from 4.65:1 upwards, in all three schemes.

- **A loading placeholder reserves what actually arrives.** The app draws
  one wherever it is waiting on data, and most of them had been sized from
  a memory of the thing they stand in for rather than from that thing's
  own rule — so the wait looked settled and the arrival moved the page
  under the reader. The games list was the worst of them: measured at
  1200px in table mode, six placeholder rows came to 509px against the
  204px of rows that replaced them, so everything below dropped 305px the
  moment the games arrived. The Continue card stood 192px and settled at
  156 — upwards, because a desktop was reserving the phone's rows — and a
  device that had never opened the vault reserved nothing at all for a
  card that exists from a vault's first second, so a new phone, a private
  window or a cleared store took the whole 156px every time. The puzzle
  dashboard's rows stood 75px too tall for the entire wait, that panel
  being drawn from the first paint rather than behind a delay. The book
  page held a place for its tile grid and none for the Cycles panel above
  it, so the grid landed 144px below where it had been drawn. Each of
  these is read off the element it replaces now: the games list from
  GameTable's own row geometry, the board column from the shell constant
  it had been copying by hand, panel headers from PanelHeader's
  `min-h-11`, the pane switcher from the registry's TabsList, and the
  three placeholders standing in for bordered cards from a border rather
  than a ring — 2px short is small, and it is every card on a shelf at
  once. Rows that grow under a coarse pointer grow in the placeholder too,
  which is where every phone had been a button short, and rows that follow
  the density knob follow it in the placeholder as well. Continue's stored
  hint is a shape — phone rows, desktop rows, a board — in one key rather
  than a count and a flag in two; it clamps a count it cannot believe
  instead of falling silent and reserving nothing, and it announces itself
  to a screen reader the way the app's other placeholders do. Measured
  after, each against the thing it stands in for: 204 against 204 on the
  games list, 156 against 156 on Continue, 33 against 33 per dashboard
  row, 150 against 150 on a study's chapters, 65 against 65 on a note's
  header, and 44, 36, 32, 122 and 58 on the panel headers, the coarse
  title rows, the switcher and the two bordered cards.

- **The demo can show the safety net now.** Earlier versions of a
  document, and bringing back a deleted one, are read out of the vault's
  history repository with git — which a browser tab has not got, so both
  Settings cards were missing from the demo and the one thing the app
  does at the worst moment could only be described. A page does have
  something better than an imitation: it sees every write, because they
  all go through its filesystem. So it keeps the versions itself and
  answers the same five questions from them. Edit a note in the demo and
  the clock in its header offers what it said before; delete one and it
  turns up under Deleted documents with a button to put it back. The
  history is the visitor's own editing rather than a fabricated past, and
  the questions are still asked by the same module a server uses.

- **The demo's sample vault is written rather than generated.** Its
  studies were twelve copies of one shape — three chapters called “Main
  line”, “The critical sideline” and “A model game”, none of them about
  the title above them — its notes were five documents copied four times
  each, and its thirty games shared two comments, one variation and a 60%
  draw rate between them. The chapters are real games chosen to match
  their study, the notes are eleven different notes, and the games are
  real games with a result spread across 23 opening codes. Clocks and time
  controls arrive with them, so the clock on a player's nameplate appears
  for the first time; half the collection says which side is yours, so
  “my games” selects something; a third of it is unannotated, so “with
  notes” is a filter rather than a description. Bookmarks, a repertoire
  drill history and the Storage card — everything that showed an empty
  state because the demo had never done anything — arrive too.

- **The demo has a puzzle book in it, made from the book it ships.** The
  shelf answered with an empty list and a note saying book puzzles come
  from commercial books, so the app's most distinctive feature — a
  position transcribed off a printed page, solved against the page it came
  from — was the one thing a visitor could only read about. The demo draws
  its own book, and the three positions it prints are now a puzzle book
  beside it: the Spanish after 3.Bb5, the Lucena, and the third-rank
  defence, each with the line the book prints, and two of them already
  solved so the shelf has progress on it. **Read** on the book's page opens
  the PDF they came from. The shelf is the real module now rather than a
  stub, so what it can do is what the app can do.

- **The pane swipe moves the pane.** On a phone the panels under a board
  turn with a sideways swipe, and until now the gesture committed on
  release and swapped instantly: up to that moment nothing on screen said
  a finger had been understood, and at the ends of the strip — where it
  deliberately does not wrap — an ignored swipe and one that landed looked
  exactly alike. The panel leans with the thumb now, half of what the
  finger travels and no further than 32px, and springs back if the drag is
  abandoned; at the first tab or the last it gives 10px and stops, which is
  the wall said during the gesture instead of after it. On a turn the
  arriving pane starts 32px the other way at 55% opacity and eases home
  over 200ms — the same distance the leaving one covered, so the handover
  cannot come out lopsided. The pill under the tab fills on the pane's own
  curve rather than Tailwind's default: the two durations already matched
  to within a frame, but at 80ms the pane was 60% home and the pill 17%
  filled, and that gap is what read as the strip lagging. Both are written
  from one custom property, a motion drawn in two files being two numbers
  that drift. The strip itself stays put, being what the turn
  is read against, and a tap on it is still instant: a tap has no
  direction, and can jump two tabs at once. Nothing was restructured for
  it. The panes stay separate elements at the heights every board page has
  tuned, and the offset rides two custom properties written straight onto
  the column, so a swipe costs no React render at all — these columns ARE
  the board pages, and a render per touch-move would re-run a move tree, an
  engine and an explorer sixty times a second. One pane could not move and
  now can: a study's Chapters sat in a `display: contents` box, which
  generates no box to transform, so the hiding moved onto the panel itself
  and the wrapper is gone. Under `prefers-reduced-motion` the motion is
  skipped entirely and the swap is the instant one it always was. Measured
  with trusted touch input at 375x812, on the board page and on a study:
  the drag caps at 32px, the wall at 10px, the arriving pane traces
  32 → 21 → 12.9 → … → 0 over ~200ms, the strip never moves, and at rest
  the column carries no attribute, no transform and no compositing layer.

- **A link written with a display text counts as a link.** `[[Target|the
  words you want]]` rendered its words, hid its brackets and opened the
  right document when pressed — and the document it opened listed no
  mention of it. What a mention carried as its target was the DISPLAY
  half, and a backlink is derived by resolving that string, so every such
  link resolved the writer's own words, found nothing, and was dropped in
  silence. The two halves are separate now: what the link points at is
  what gets resolved, what the reader sees is what a quoted sentence
  highlights. Nothing about writing or renaming them changes — those
  always kept the halves apart, which is why this survived: the one test
  the form had checked that writing it preserved the writer's words, never
  that the link counted.

- **The demo shows links written on moves, which is what 0.7.0 was
  about.** The sample vault carried forty `[[links]]` and every one of
  them was in a note, so the release's own headline — a link in a move
  comment, and the backlink that opens the chapter the comment is in —
  was invisible to anyone who did not type one themselves. Nine links now
  sit in the seeded studies' and games' comments, in every direction the
  feature has: a study's chapter 2 pointing at a note, a study's chapter 3
  at a game, games at studies and at notes. Each was placed inside an
  annotation that was already there, so the prose still reads as one
  voice, and each was checked to resolve and to report the chapter it was
  written in.

- **The demo's database search suggests names again.** Typing a player,
  an opponent or a tournament into the search panel is meant to suggest
  from that database's own names; in the demo it suggested nothing, ever,
  for any of the three — while the same name returned games in the table
  beside it. The route reads three small lookup tables derived from the
  games, and the demo's database was built without them: the builder's
  list of derived tables was a hand-written copy of the shared one, made
  before those lookups existed, and it did not follow when they were
  added. It calls the shared tuner now, so it cannot fall behind again.
  The two files grow by 0.3 MB each, which buys the lookups and the four
  search indexes the copy had also missed.

- **The demo's own vault is fully indexed again, and it says which build
  it is.** Two bugs in the static demo, both invisible from the source.
  Its my-games index walks the vault a slice at a time and reschedules the
  rest with `setImmediate`, which a browser has not got: the first walk
  threw after one slice and, having already set its own in-progress flag,
  was never rescheduled — so the index froze at 9 of the 30 sample games
  and the explorer went on reporting confidently on a third of the vault,
  with nothing to say it was partial. The opening map's compare panel,
  which asks that route directly, simply failed. A shim supplies
  `setImmediate` as a real yield to the page rather than a microtask, and
  all 30 games (1,638 positions) are indexed. Separately, the demo's
  health route omitted the version and the build stamp, and Settings →
  Version reads their absence as an answer still in flight: the Built row
  held a loading placeholder that pulsed for as long as anybody watched
  it. Both are known when the demo is built, and it now answers with them.

- **The desktop app says what an update is doing, and offers the restart
  itself.** It downloads an installer of some eighty megabytes in the
  background and said nothing at all while it did, so a slow connection and
  a stalled one looked identical; then it finished in a native message box,
  which arrives over whatever you were in the middle of, is not in the
  app's language, and whose “Later” took the offer to restart away for the
  rest of the run. Settings → Version now reports the download as it runs —
  “Downloading {version} — {done} of {total}”, with a bar — and when it is
  complete keeps “{version} is ready — restart to install it.” and a
  **Restart now** button on the card until you take them. Nothing is
  interrupted, and nothing is lost by not looking. Quitting still installs
  it, as before. A check that simply fails — offline, or no release
  published yet — stays where it was, behind the **Check for updates**
  button; only a download that broke says so on the card, and its reason is
  translated now rather than handed back in English.

## 0.7.0

The workspace, with every analysis surface on one page; links written on a
move and not only in a note; and the panes under a board that turn with a
swipe.

- **Links can be written on a move, not only in a note.** A note could
  write `[[Some Study]]` and open it; a study or a game could be named that
  way and never name anything back, because a link had to be typed into
  markdown and a study is a PGN. Move comments are prose too, and now hold
  links: typing `[[` in the comment box opens the same list a note gets,
  drawn above the box rather than at the caret, and the same keys drive it
  (<kbd>↑</kbd><kbd>↓</kbd> pick, <kbd>Enter</kbd>/<kbd>Tab</kbd> accept,
  <kbd>Esc</kbd> dismiss). It works in the phone's comment sheet too. In
  the move list a link reads as a link — brackets hidden, the display text
  of `[[Target|shown]]` shown — and opens what it names. And they count:
  the document a link points at lists it under “Linked mentions”, so a note
  can now see that a study's twelfth move is what refers to it. A backlink
  from a study opens the chapter the comment is in, not the study's first;
  the chapter is worked out fresh each time the list is opened, so
  reordering or deleting chapters cannot leave it pointing at the wrong
  one. Renaming a document rewrites the links in comments exactly as it
  already rewrote the ones in notes — without that a rename would break
  every link written on a move, silently, which is the failure that rewrite
  exists to prevent. The hunt for a document's name written in prose
  without brackets reads comments too, and the **Link** button beside one
  writes the brackets into the comment. What it deliberately does not read
  is the moves: only the text inside `{...}` is scanned, because a study
  called `Nf3` searched across whole game files would be “mentioned” by
  every game in the vault. Nor does it quote the machinery a comment
  carries beside the words — `[%eval]`, `[%clk]`, an import's leftovers —
  so the sentence shown is the sentence the move shows.
- **A link that names nothing offers to make it, in any of the three
  kinds.** Pressing a link with nothing behind it opened a window offering
  one thing: write a NOTE by that name. That was right while a note was the
  only document that could hold a link, and wrong the moment a comment on a
  move could name a study nobody had started — answering that with “shall I
  make a note?” resolves the link to the wrong kind of document quietly and
  for good, since from then on it resolves. The window now offers a game, a
  study or a note, in the order the sidebar already uses, each with the
  icon that section is known by. Two smaller dead ends went with it. A name
  the vault cannot hold — one with a colon in it, a reserved word, one far
  too long — used to get the sentence and no offer at all, an empty window;
  it now says why there is nothing to make. And `[[ ]]`, a link made out of
  a space, is no longer a link: it resolved to nothing, had nothing to
  choose between and could not be created either, so pressing it opened a
  window with nothing in it. It reads as the text it is, which is what
  `[[]]` always did.

- **The Games browser leads with your own games.** The tab strip ran
  Databases · Collection · Chess.com · Lichess, while the pane opened on
  Collection whenever the collection held anything — so the default was
  the second tab, and every visit looked like something had been skipped
  past. The strip is now Collection · Databases · Chess.com · Lichess:
  the same four tabs, ordered by how close the games are to the reader —
  yours, then the reference databases, then the two online archives.
  Nothing else moved; the default was already the collection, and it is
  now also where the strip starts. An empty collection still opens on
  Databases, which is the one case where the opening tab is not the
  leading one, and there the leading one has nothing to show.
- **A comment says what it cannot keep, while it is still being typed.**
  Two things typed into a move's comment used to be eaten between the box
  and the file, and neither said so. A `}` was deleted outright, because a
  PGN comment ends at one and has no way to escape it: `Bad } here` was
  saved as `Bad here`. Anything shaped like `[%eval 9.9]` was worse than
  deleted — the four commands PGN uses for machine annotation are READ, so
  prose came back as a +9.9 evaluation on the move, and `[%cal Ra1a8]` as
  a red arrow nobody had drawn. Both are now rewritten as they are typed,
  under the caret and in front of whoever typed them: a `}` becomes a `)`,
  and one space breaks the command shape while keeping every character. A
  line under the box says why, and goes away by itself. Neither was ever a
  way out of the comment and into the moves — ten payloads, braces and
  parentheses through `1-0` and a full `[Event "x"]` line, left the move
  list untouched — so this is about a note surviving intact, not about
  safety. What was rewritten now round-trips byte for byte: what the box
  holds is what the file holds is what opens again.
- **The panes under a board turn with a swipe.** On a phone the panels
  beside a board are one pane at a time behind a strip of tabs — Moves,
  Engine, Explorer, a study's Chapters, a trainer's Puzzle — and reaching
  that strip meant taking the thumb off what it was reading and back up to
  the top of the column, on every page with a board (the board page,
  studies and games, the repertoire, both puzzle trainers). Swiping the
  panel sideways now turns to the next tab where the thumb already is:
  left for the next pane, right for the one before, 56px to commit. It
  stops at both ends rather than wrapping, because nothing else on the
  page says the row of tabs is a ring. The strip is unchanged and is still
  the switcher — a swipe and a tap do the same thing, instantly, with no
  animation between them. What it deliberately does NOT take: gestures on
  the board (those move pieces), gestures that are more vertical than
  horizontal (those are the scroll the panes exist to be read by),
  gestures that start on a screen edge (the platform's own Back), and
  gestures that start on something that already handles sideways
  movement — a row that scrolls sideways, a text field, the review strip
  and the resize grips, which declare it in CSS. Measured in the demo at
  375x812: the board page's three panes and a study's four turn in both
  directions and stop at each end; a 55px drag does nothing and a 56px one
  turns; the same drag across the board, from either screen edge, or
  running 120px across and 160px down leaves the pane alone; and a probe
  box added to the live column turns the pane in a plain box while the
  identical drag inside a sideways-scrolling one and inside a
  `touch-action: none` one is ignored.
- **The Games page stops paying for a details panel nobody asked for.**
  The column stood beside the list at every width wide enough to hold it,
  whether or not a game was selected — and the table beside it never
  sheds columns, it scrolls sideways to reach them. On a 1440-wide window
  that cost 236 pixels of table (790 shown of the 1026 it asks for) to
  keep a column reading "No game selected" on screen. The column now
  carries a switch in its own header: kept open, it holds its place as
  before; let go, it arrives with the game you select and leaves on the ×
  beside the pin (or on Esc, which clears the selection either way), and
  the table has every column back — 1174 of 1174, nothing
  behind a scroll. The default follows the window rather than a taste. At
  1680 and wider the panel is free (the table measures 1030 against 1030
  beside it) and stays open as it always has; below that it starts closed.
  What it costs is the selection: at 1440 the click that opens the panel
  narrows the table by 368 pixels and refolds the pane's toolbar 34 pixels
  taller. That cost is why this is a switch and not simply the new
  behaviour — a window wide enough to want the panel keeps it.
- **The move buttons stopped moving.** They lived at the foot of the Moves
  panel — and under the board instead whenever the Moves panel was behind
  another tab, which on a tablet meant they jumped a couple of hundred
  pixels every time you switched to Engine or Explorer and back. Every
  pane carries them at its own foot now, Moves, Engine, Explorer and a
  study's Chapters alike, and the row under the board is gone. Where the
  panes are tabs the buttons are pinned to the foot of the COLUMN rather
  than to each panel's own floor — the panels are not all the same height,
  and pinning them to the panel put the buttons at a different height on a
  chapter list than on the move list. A phone is unchanged: the bottom bar
  carries them there, and the panels keep theirs hidden so the same four
  arrows are never drawn twice.

- **The names line up with the board.** The player bars above and below it
  were as wide as the board's COLUMN, and the column is the board plus the
  evaluation bar's lane — so a name and its colour swatch started a bar's
  width to the left of the board they describe, lined up with nothing. They
  now sit over the board itself, and they round and centre by the same rule
  the board does rather than by an approximation of it, so the swatch starts
  on the a-file and a clock ends on the h-file whatever the window is doing.
  Every row that stands over a board does this now, not just the Board
  page's: the repertoire's two side slots, the line under the book
  trainer's entry board, and the placeholder rows a page draws while it is
  still loading — which had the board 36px wider than the one about to
  replace it.

- **The evaluation bar prints its number.** It was a gauge and nothing
  else: a position was "about half white", and the score itself lived in
  the engine panel, which is not where you are looking while you play
  through a game. It is now square-cornered rather than a pill, 28px wide
  instead of 12, and prints the score to one decimal at the leading side's
  end of it in that side's own colour — unsigned, because where the number
  sits and what colour it is already say whose advantage it is. Its tooltip
  still carries the signed, two-decimal figure. The red line across the
  middle went with the change: it was there so that a nearly even bar could
  be read at all, and a printed number does that better than a marker to
  measure the split against. The wider bar costs each
  board 16px of width, and costs it on every page that reserves the bar's
  lane, so no board changes size against another. A tablet held upright now
  gets the bar beside the board as well: the page still stacks its panels
  below, but the board there is bound by height and had 150px of unused
  column either side of it, so the bar stands in that margin and the board
  is the same size with it as without. The board is centred in its column
  while the engine is off, and the board and its bar are centred together
  once it is on — which is an 18px step sideways at the moment of
  switching, and the price of not sitting a board off-centre in an empty
  column for the sake of a bar that is not there. Narrower than
  that — a phone — the bar still lies along the top of the board, prints the
  same number at the leading end, and grew from 12px to 20px tall to hold
  it, out of the empty half of a row it was already sitting in rather than
  out of the board. The repertoire's assessment keeps the bar it had: the
  score is already printed beside that one, twice the size.

- **And every piece set shows its knight.** The same problem one row
  down, with the same fix: ten set names, and no way to tell Fantasy from
  Celtic without wearing each of them for a moment. Each row now carries
  that set's knight — the piece the sets disagree about most — standing on
  a square of the board you have chosen, which is the background the art
  was drawn to be legible on. The knights are generated beside the piece
  stylesheets rather than taken from them, so showing a set costs one
  piece instead of its other eleven: the settings page grew 12 KB
  compressed, against 340 KB for the ten full sets.

- **Every board theme shows itself in the list.** Choosing one meant
  reading ten colour names — "Slate", "Rosewood", "Blue" — and then
  picking one to find out what it was, because the only swatch on the
  page showed the theme already in use, which is the one theme you could
  already see on the board. Each row of the list now carries a swatch
  painted in its own theme, the closed control wears the same one, and
  the separate preview is gone: it had become the selected row drawn
  twice. The swatches read the same palette table the real board does,
  so there is no second copy of the colours to fall out of step.

- **Asking for less motion now quiets the board, and stops breaking the
  spinners.** The setting was honoured by one blanket rule that cut every
  animation to nothing, and it was wrong at both ends. It never reached
  the board at all — pieces are animated from JavaScript, frame by frame,
  where a stylesheet cannot follow — so a piece still slid across the
  board for someone who had asked it not to. Meanwhile it was flattening
  the two animations that mean something: a spinner and the puzzle
  build's progress bar loop for ever, and an animation cut to nothing
  does not stop, it restarts hundreds of times a second, so both
  flickered instead of turning. Now the board simply places the piece —
  the last-move highlight already says which move it was — and the
  spinner and the bar keep going, slower. Everything decorative still
  stops.

- **The colours that carry meaning can be read, and High contrast
  improves them instead of spoiling them.** Green, amber, blue and red
  mean solved, careful, trusted and wrong all through the app, and they
  alone stayed put while every surface behind them moved with the
  appearance settings. Turning on High contrast therefore darkened the
  panels and left those four where they were, closing the gap it was
  chosen to open — the one setting picked for legibility made exactly
  the colours that carry meaning harder to read. They now follow the
  same knob. Separately, the red used for text was lightened past
  comfort on its own faint background: the button that erases a vault,
  in Settings, was the one label in the app that fell below the
  readability floor, and it now clears it.

- **The opening map's lines weigh the same as one another.** Colour was
  spread around the wheel to tell lines and opening families apart, in a
  form whose lightness number is not a lightness anyone can see: across
  the hues the map draws, one line was nearly six times brighter than
  another. The yellow shouted and the blue whispered, on a map whose
  whole claim is that no line ranks above the rest. They are now within
  a seventh of each other, with the same hues, and they follow the light
  and dark themes rather than ignoring both. The frame drawn around a
  board found in a photo has likewise stopped being a colour from
  nowhere, and is the same blue the app uses elsewhere for what it has
  read.

- **The site reads Korean in the app's own typeface.** The landing page
  and the docs borrowed the app's colours, spacing and corners but not
  its lettering, so their Korean fell to whatever the machine happened
  to have and the letterforms changed under you on the way into the
  demo. Both pages now use Pretendard, served from the site itself
  rather than fetched from anywhere else, and only the pieces of it a
  given page needs.

- **A line nested in another can be lifted one step, instead of all the
  way.** Promotion was one verb, `Make mainline`, and it hoisted a line
  past every line containing it — so a variation inside a variation
  could be left alone or made the main game, and nothing in between.
  The move tree gains **Promote this line**, which moves the line the
  cursor stands on one place up among the lines it sits beside; press it
  again and the next branch out moves, so the mainline is where it ends
  rather than where it starts. Right-click any side-line move for both
  verbs (long-press on a phone). Deeply nested lines are the case this
  was missing: the cursor is almost never on the move a variation begins
  with, and acting on that move alone did nothing at all.

  Both also sit at the top of the Moves panel's ⋯ at every width, acting
  on the move you are standing on — a tablet is wide enough for the
  right-click route and has no right-click to give. Phones additionally
  get the `Make mainline` strip's line of the list back: the banner now
  shows from tablet width up, where there is room for it.

- **The repertoire drill remembers on a schedule, and home says when.**
  A position you fumbled used to sit in the drill's review pool for
  ever, and one scraped recall retired it for good. It now rides the
  ladder the puzzle trainer already uses (`shared/review.ts`): due
  again tomorrow, then 3, 7 and 21 days out after each clean recall,
  then graduated out of rotation. The idle panel counts what is due
  today, says when the next position comes back if none is, and
  **Drill a position due for review** deals the most overdue first —
  with a position fumbled minutes ago still drillable before its date
  arrives, which is the trainer's own bargain: the schedule decides the
  order and the count, the pool decides what may be served. Home's
  Training panel gains a row for it beside the puzzles', and a phone —
  which has no Training panel — gets a "Repertoire review" row in
  Continue whenever something is due.

  Nothing new is stored: the schedule is derived from
  `history.jsonl` on every read, so records written before this
  release fall onto the ladder as they are, and forgetting the drill
  record still forgets the schedule with it. This was deferred for a
  while on the argument that a repertoire position gets rehearsed by
  routes a scheduler cannot see — but the drill records a recall for
  *every* prepared move played, not only where something was fumbled,
  so a whole-study drill walking the same first plies each session
  pushes those positions up the ladder itself. The case the objection
  feared does not arise.

- **A wood board, with the grain drawn rather than photographed.**
  Settings → Appearance → Board gains "Wood grain": the rust brown of a
  printed diagram, and the first theme with a texture. The grain is an
  SVG turbulence filter stretched hard along one axis and blended
  soft-light over the checkerboard already there, which matters for more
  than tidiness — soft-light leaves the mean untouched, so the two board
  tokens still describe the squares, and everything that derives from
  them keeps working without knowing a texture arrived: the coordinate
  labels pick their contrast from the square they sit on, the mini boards
  stay flat where flat is right at that size, and the editor's piece tray
  still takes its backdrop from the light square. It is drawn in 64
  cells rather than one, because turbulence is evaluated in the image's
  own coordinates: each cell clips a different patch of one noise field,
  so all 64 squares differ and the grain breaks at every seam the way an
  inlaid board does. One cell would run the grain straight across the
  seams and read as a painted panel. Its detail stops at three octaves
  because a fourth put the finest band at one device pixel per cycle on a
  small board — aliasing by definition, and it shimmered hardest beside
  the pieces' outlines, where it read as though the pieces were at fault.
  The whole texture is 474 bytes gzipped — the CSS bundle is 61592 with
  it and 61118 without — against 138 KB for the photographic wood board
  it stands in for, and it brings no third-party artwork to carry a
  licence notice for.
- **One header across the site, and the manual's file is renamed too.**
  The docs page still wore the old chrome — an outline demo button and a
  segmented English/한국어 track — so the two pages of one site disagreed
  about the only thing on screen at both. It now has the landing page's
  bar exactly: `EN / KO` in mono, the demo as the one button, and 61px of
  height at every width (which cost the docs page a token — its sidebar
  sticks under the header, so `--header-h` had to move from 3.5rem to
  3.75rem to arrive at the same number the landing page reaches by
  addition). Its phone bar no longer drops the demo either; it shortens to
  "Demo" the way the landing one does. And `manual.html` is `docs.html`,
  with every reference followed: the landing's two links, the page's own
  og:url, the site build, `check:repo` (the path, its identifiers, and the
  prose describing check 6) and this file's own release checklist. The
  published /manual.html is not dropped, because it is in whatever links
  to it — the build now writes a redirect stub there pointing at the
  canonical /docs.html, so the source folder holds two pages and the
  deploy holds three.
- **The opening screenshot joins the column it interrupts.** It ran to
  76rem against a 62rem page so it would break the reading line, which
  only made the board too big to take in and put the page's first two
  vertical rules somewhere nothing else returns to. It is on the column
  now: the shot, the index and the download table all span the same 144px
  to 1136px at 1280.
- **The header lost its boxes, and the manual is the docs.** The bar held
  two boxed controls — an outline Manual button and a segmented language
  track — competing for one corner of a 60px strip, on a page whose whole
  argument is that a box is for something that needs a frame. The two that
  are not actions gave up their chrome: Docs is a link because it is a
  link, and the language switch is `EN / KO` in the same mono the vault
  paths and the figure numbers are set in. What stays a button is the one
  thing that is an action, and it is now the demo — which is the reason the
  bar is sticky at all. Separately, every user-facing "Manual" is "Docs"
  (설명서 → 문서): the landing header and footer, and the docs page's own
  title, social cards, masthead and heading. The app's own "manual entry"
  and "manual key" mean by hand, not documentation, and are untouched.
  The cost was the phone: the new row did not fit one. At 320px it ran 21px
  past the viewport and at 390px the wordmark broke after "Chess", taking
  the header to 73px — so the label shortens to "Demo" below 30rem, the gap
  tightens with it, and below 22rem the wordmark goes and the hex stays.
  The header is 61px at every width now, and a coarse pointer gets the
  primary button's height on a language code that is otherwise a 26px
  target.
- **The landing page is rebuilt around the vault.** It had the shape every
  project's front page has — a centred hero, a grid of six bordered cards,
  four alternating image rows — which said nothing about this one. It is
  now built out of the product's own claim: the opening is two unequal
  columns, the headline beside a listing of the vault as it sits on disk
  (`studies/`, `notes/`, `games/collection/`, and what each one holds), so
  "plain files" is shown in the same eyeful it is asserted in. The six
  cards became a printed index — a hairline between entries, the labels in
  one column, the prose starting on one line down the page — and the four
  feature rows became numbered figures hung off a continuous rail, which
  reads as a series rather than as four unrelated bands. Download's three
  cards are three rows of a table, so a row can be as tall as its own
  content instead of every card growing to the tallest. Same palette, same
  tokens, same screenshots; the index copy was tightened in both languages.
  Two bugs fell out of the rebuild and are fixed for the whole page: a grid
  column defaults to `min-width: auto`, so the clone command's `pre` had
  been sizing its column to its longest line and taking the page 66px wider
  than a 390px phone; and Korean was breaking mid-eojeol without
  `word-break: keep-all` — the headline read "평범 / 한 파일로".
- **The workspace: every analysis surface on one page.** A new
  wide-screen page under Tools — the board, the moves panel with the
  engine docked, the explorer with an Analysis panel under it, and the
  whole games browser as a full-width band underneath. Selecting any
  band row previews the game on the board in place (archive games from
  your side; ↑/↓ walk the rows, each game taking the board in turn),
  the explorer's position hunt fills the band instead of leaving, and a
  collection game's double-click opens its document page, because
  annotating is a document's work and a throwaway board is what keeps
  browsing free. Nothing on it is new by design: every pane is the
  component some other page shows one at a time, driven by the same
  stores — which is also why a position follows you between the Board
  page and the workspace. On a window too narrow for its panes the page
  steps aside with a card, and the sidebar row is not drawn at all; the
  Games page's tabbed browser was extracted into a component
  (GamesBrowser) to make the band possible, proved byte-identical on
  the page it came from.
- **The games tables' chrome folds to one row where the pane holds
  one.** Search, the filter selects and the count stood as three
  stacked bands over every list — in the workspace's band that was half
  the height showing controls. Where the measured pane is wide enough
  they fold into a single row (each tab's own arrangement: the
  databases with their search, the collection ending on Import, the
  archives on the count and Select…, whose selection controls now
  appear as a band only while the mode is on); narrower panes keep the
  stacked bands, and the ragged in-between wrap never exists. The row's
  icons follow one rule now — stateful toggles wear the box of the
  fields they stand among, verbs that navigate away stay quiet — and
  the position hunt runs from Enter in its FEN field, its button an ↵
  at the row's end.
- **A review dies with the tree it judged, and the arrow keys come
  back.** Reviewing a game, leaving, and returning with another left
  the old evaluation graph drawn over the new game with every click
  silently dead — the review store now clears itself the moment the
  tree is replaced. The arrow keys had died across every board page in
  the nav-row consolidation (the one listener lived on a row that
  stopped rendering on desktops); they live on the board itself now.
  And the graph got legible: the move under the pointer marks itself
  with a blue dot and a guide line, the cursor is a pointer, a folded
  graph takes no room, and the strip compresses on short windows
  instead of clipping the navigation bar under it.
- **The moves menu stops repeating its own header.** On a desktop the
  moves panel's ⋯ listed Engine review, Clear all moves and Clear the
  board one icon away from the buttons that already offer them — a
  leftover from the menu going every-width when Copy FEN/PGN moved in.
  Those rows are phone-only again, where the buttons they stand in for
  are hidden; a page without a review button of its own (the trainers,
  studies, the book reader) keeps the review row everywhere. Alongside,
  four strings on the board pages — the collect button's three tooltips
  and the phone pane tabs' Engine and Explorer labels — finally reach
  `t()`; their Korean entries had been sitting unused in the dictionary.
  And Clear all moves draws an eraser again: it shared the reset's
  arrow, so a loaded position with moves put two identical arrows side
  by side — one keeping that position, one throwing it away, told apart
  only by tooltip.
- **A release's installers land on one release.** Cutting 0.6.0 found the
  desktop workflow racing itself: three package jobs each look for the
  draft to upload into and create one if it is missing, and two of them
  found none in the same second. Linux's AppImage, deb and
  `latest-linux.yml` went to one release object, the Windows and macOS
  installers and their two manifests to the other — both tagged `v0.6.0`,
  both drafts. `gh release view v0.6.0` resolves to one of a pair, so the
  release read as having lost the exe, the dmg and two of the three
  updater manifests, which is indistinguishable from the 0.4.9
  empty-draft failure until you list the releases by API. Nothing was
  lost; it was somewhere nobody looks. The draft is created once now, by
  a job that runs before any packaging, and a check after it fails the
  run if the tag has anything other than exactly one release — listed by
  API, because a lookup by tag is precisely what cannot see this. 0.6.0's
  own assets were merged onto one release before it was published, so the
  release you can download was never affected.
- **The Korean dictionary drops 138 dead entries, and the manual stops
  being checked against it.** Auditing the manual turned up one
  translation key left behind by a menu 0.6.0 removed; there were 138 of
  1585, including a whole vocabulary — "trade queens", "Temporary
  sacrifice" — from the heuristic engine explanations that
  [explaining.md](explaining.md) records as tried and removed. Nothing on
  screen changes, proved by capturing the Korean text of all sixteen
  routes before and after, 969 lines, against the noise floor of the same
  build captured twice.
  Separately, `check:repo` held the manual's quoted strings against a
  haystack that included the dictionary, so a key outliving its call site
  could vouch for a label the screen had stopped showing. It is checked
  against the app alone now.

## 0.6.0

One game browser at every width, a query language both search boxes
speak, and deep search that answers under a second at ten million games.

- **The Games pane is one browser at every width.** Databases,
  Collection, Chess.com and Lichess were tabs on a wide screen and
  something else entirely below it: the collection was the page, and the
  other three hid behind an Add games menu as sheets. The tabs are the
  page now at every width, and width changes only the dressing — a
  desktop adds the details column and the dense table, a phone gives the
  same tabs card rows and opens details from a row's own menu. The
  phone's separate apparatus went with the split (the archive sheets and
  the slot that held them, the Add games menu, the under-title finders
  row), and the create button became one press straight to import, since
  everything else it used to offer is a tab. The page leads with the
  databases as a table with a game beside it, the table answers the
  keyboard, and a position handed over from the explorer lands on the
  Databases tab on a phone exactly as on a desktop.
- **One query language, spoken by both boxes and taught by a panel.**
  The language lives in `shared/searchQuery.ts` — one parser the server
  compiles to SQL for the reference databases and the browser answers in
  the page for your own collection, the two written in the same file so
  they are reviewed together. Both boxes speak all of it: `player:`,
  `opponent:`, `eco:`, `event:`, `year:`, `result:`, `elo:`. Finished
  terms become chips, the field colours itself as you type and waits
  until you pause to warn, suggestions open unprompted and answer the
  keyboard, and names and tournaments complete from the database's own
  derived lookups. A query that cannot match anything says so rather
  than returning nothing, and a term the surrounding filters leave no
  room for — a disjoint rating band, an outcome its result contradicts —
  warns instead of quietly finding zero. A panel teaches the language
  with a live example per field; `vs` is gone, because an infix
  qualifier was the one piece that could never be completed like the
  rest.
- **Deep search answers under a second at ten million games.** Three
  rungs, each measured on `lumbras_otb` (10.36M games), warm: the scan
  loop compiled to flat scalars once per hunt rather than run as the
  readable spec, the packed index moved into `SharedArrayBuffer`s with a
  fixed shard set scanning contiguous ranges, and a count envelope that
  turns exact search into a lookup. An exact deep hunt went 4.53s →
  2.57s → 0.75s, the pawn-structure rung 5.37s → 2.76s → 1.47s, the
  files rung 3.90s → 2.27s → 1.28s, with matched counts identical at
  every step. The shard width is set by the machine once at load, never
  by request volume — still one worker owning one structure, which is
  the shape `deferred.md` settled on. Two residual floors are recorded
  rather than pulled: the relaxed rungs spend their remainder verifying
  candidates on the main thread, and a filtered hunt spends it
  materialising its id list from SQL.
- **Fast search is a switch on the database, and it states its cost.** A
  worker holds one database's packed index whole in memory — lazy on the
  first hunt, evicted after thirty minutes idle, terminated when the
  database is deleted or the API closes. Opting in is a toggle on the
  Databases page, refused where no full index pass has written the
  packs, and it loads immediately so the answer arrives with the price
  attached: 280k games cost 1.0s and 120MB, 1.12M cost 3.0s and 481MB,
  5.04M cost 12–17s and 2.17GB. Against the replay path on the same
  machine, an exact deep hunt at 5.04M runs 2.0–2.6s where replay takes
  192s. Every failure falls through to a path that answers identically,
  and an end-to-end test holds eight hunts to identical game frames
  before and after enabling it.
- **A position can be searched loosely, or not given at all.** The scan
  climbs Scid's relaxation ladder — exact, pawns, files, material, the
  same position loosened by degrees with the side to move kept
  throughout — and runs ChessTempo's material search with no position at
  all: per-piece count ranges, white-minus-black differences with minor
  and major aggregates, and a stability length in plies. Pawn structure
  is a rung of its own, carried by one byte per position. A hunt takes
  its position from a board rather than only from a pasted FEN, a
  material hunt can be built by hand instead of picked off the shelf,
  and the relaxed rungs accept a kingless sketch, since a pawn structure
  is a real query. The Rust twin climbs the same ladder, pinned by
  exported goldens, and declares which hunts it supports before it is
  trusted with any — so a binary that has not caught up simply leaves
  those hunts on the JS path.
- **The site has a manual, and it is a reference.** Twenty-two pages
  with a navigation tree, one page at a time and prev/next at each foot:
  five to start, one per tool, one per shelf, the training four, and
  reference. Each page goes past the overview down to the controls
  themselves — every button, toggle and menu item named by its own UI
  string, with the tooltip text where a control is icon-only. It keeps
  the landing page's mechanics: one self-contained file, no build step,
  Korean switched by the same stored key. `check:repo` now holds its
  quoted strings to account against the app's source, and the release
  routine gained a pass that walks it control by control, because a
  manual is the document most able to rot.
- **Density.** The app could recolour itself eleven ways and round its
  corners four, and had nothing to say about how much of your vault fits
  on a screen — the setting a tool ships and a toy does not. Three
  custom properties on the root, read by the three surfaces every list
  here is made of, so a density is three declarations rather than a
  sweep of call sites. It reaches the game rows, the panel rows, the
  cards they sit in, the move list, the explorer's tables and the
  studies chapter list.
- **The editor's position chain stops blinking.** Opening a window over
  a window to set up a position always cost a frame somewhere, because
  two dialog elements trading places always do. The Position and Load
  pages are content of the one embedded editor now, keyed so each
  arrival slides — forward from the right, back from the left — inside a
  frame that never moves, with the host window's own title row turning
  to name the page. Measured through the whole chain: one dialog element
  at every step, the same rect byte-identical from board to Position to
  Load and back. The board column steps aside but stays mounted, so
  nothing rebuilds and the way back is instant. The picture flow joined
  the chain as its fourth page, and `float` — a prop that existed to let
  a page hover over a parent it turned out never to have — retired with
  the pattern.
- **A window's X means out, and never back.** Every page of a nested
  chain is its own window here, and the X shut exactly one of them — so
  three pages deep it uncovered the page beneath and read as a second
  back chevron, with leaving costing three presses that each looked like
  the last. It walks the chain now, and the footer's Cancel is the same
  verb in words. A confirmation's own buttons deliberately stay where
  they were: answering a question hands you back what asked it, which is
  an answer and not an exit.
- **The reader survives a pinch, and a rotation.** A pinch on iOS
  scrolled instead of zooming — the touch arithmetic depends on
  cancelling two-finger moves, and iOS hands the touches to a native pan
  the moment one finger moves before the second lands, after which
  cancelling is silently ignored. WebKit's own gesture events carry the
  pinch now; they fire with the recognised scale whatever the scroller
  is doing. Releasing one no longer flickers: the page under it stays
  mounted and each page canvas keeps its own compositor layer. A
  rotation turns the stale bitmap rather than smearing it, holds the
  rendered range and corrects the scroll before paint, and the fresh
  raster reaches the screen together with the styles that present it.
  The reader's editor became a tab beside the book and the board, and
  the PDF cap is 500 MB.
- **Notation is prose, and a rating is a column.** Moves were set in a
  terminal face in six places and in prose everywhere else; SAN is prose
  everywhere now, said explicitly with `--font-moves`. Ratings are
  columns wherever they appear, so they are monospaced wherever they
  appear. `check:repo` watches both roles.
- **The icons say what the thing is.** Games wore crossed swords, the
  explorer a compass, the repertoire a swatch book, and "index this
  database" a hammer — a games console, an expedition, a paint shop and
  a building site, for a folder of games, a table of continuations, a
  stack of prepared lines and a scan of games already on disk. Nothing
  is magic either, so nothing wears sparkles: growing an opening map
  reads the games already in your vault, and optimizing states its three
  steps before it runs. The mark stands bare everywhere the app wears
  it, the favicon and the home header included.
- **Home opens into your work.** It led with the app's own name and, on
  a desktop, redrew the sidebar beside it; it reports the vault now, and
  a phone gets the header every other page opens with. The puzzle
  dashboard reads its numbers instead of scoring them — the run of
  consecutive correct answers is gone, because a count that survives
  only while you do not fail is a reason to pick puzzles you will get
  right, and the useful session is the one you fail in. The trainers
  report a result rather than congratulating you, and mark a wrong move
  in chess notation rather than with a quiz mark.

## 0.5.0

The Games menu unified, the reference layer built for millions of
games, and databases that grow instead of being rebuilt.

- **One shell under every game list.** The collection, the online
  archive and the reference browser assembled the same bands — toolbar,
  filter row, count band, list, empty state — by hand, and had drifted
  apart on border sides, count-band heights, skeleton placement and the
  phone sheets. `GameListShell` now owns the stack with one border rule
  and one shape vocabulary (framed / panel / sheet); reference rows are
  the shared `GameRow` (ratings no longer clip behind long names, the
  touch preview lives in the ⋯ sheet everywhere), every list wears the
  zebra stripe, the sheets bleed to their card's real edges, both
  sheets survive a trip to the Board, and search-comes-back-empty
  finally says so with a way out. The orphaned `#/games/elite` page is
  gone.
- **"Elite games" is called what it is: Databases.** The browser shows
  whichever databases you built — elite or otherwise — and the tab, the
  Add-games pill and the sheet now say so, matching the page that
  manages them.
- **The database search scales.** Player and opening text search runs
  over small derived lookup tables instead of every row's text (a
  keystroke stopped costing a scan that grows with the corpus), pages
  seek by keyset instead of OFFSET (70 ms → 0.1 ms at depth 224k,
  measured), and filtered counts stop at "10,000+" instead of walking
  two million rows to finish the digit.
- **Databases grow in place.** Building under an existing name offers
  "Add to it": only the games it does not already hold are indexed (an
  index-seeked dedup on players, result, date and movetext), and the
  position index extends from its high-water mark instead of
  rebuilding. An interrupted append leaves the database served but
  marked "index behind", and the new per-database Optimize heals it —
  and sweeps exact duplicates, re-derives everything, and compacts.
- **The explorer answers at your level.** The per-move sums carry a
  200-point rating-bucket dimension, so a "Level" band (1200–1599 …
  2400+) in the reference filters reads precomputed rows — statistics
  from players at your strength rather than the corpus's strongest.
  The index pass itself dropped from 105 s to 78 s on an Elite month
  (the sums no longer join), and stores 92% fewer rows by answering
  thin positions live.
- **Any position, hunted through every game.** When the explorer runs
  out — the index stops at ply 30 — it offers to search every game's
  movetext for the current position, streaming progress and hits (9–13 s
  across 280k games unfiltered, seconds with filters, measured).
- **Your games, diffed against a database.** `/api/mygames/compare`
  flags the positions where your move is rare among what a reference
  corpus answers — at your level, when a band is given — aggregated
  across your recent games, strongest habit first. The first sync of a
  big vault also stopped stalling the request that triggered it. The
  opening map carries the report: **Compare my moves with a database**
  picks the corpus and the level, reads your habits strongest-first,
  and opens any flagged line on the board at the decision point.
- **A native fast path for the heavy jobs, optional by construction.**
  `native/` holds `chessvault-core`, a Rust binary mirroring the build,
  index, optimize and deep-search jobs byte-for-byte — golden-tested
  against the JS pipeline's own fixtures, and proven by rebuilding an
  Elite month to zero differing rows. When a build of it is present the
  server spawns it instead of the JS children (same argv shape, same
  progress lines, same ndjson frames; `CHESS_NATIVE=0` forces the JS
  path): measured on 280k games, a full build drops from ~180 s to
  71.8 s and the whole-database position search from 12.7 s to 1.3 s,
  at a quarter of the memory. At that speed the explorer stops asking:
  past the index's thirty plies it starts the scan itself, debounced so
  arrow-keying through a game never launches one per ply, and cancelled
  the moment the position moves on — the button remains the face of the
  slower JS scan. **The desktop installer carries it**, built for each
  platform on that platform's own runner, so an installed app is fast
  without anyone typing `cargo`; a server or a checkout gets the same
  speed from one `cargo build --release`. Without it — the demo, the
  tests, an install that lost it — everything runs exactly as before,
  and `CHESS_NATIVE=0` forces that path on purpose, which is how the
  two are compared. Its 47 crates join the licence inventory the way
  everything else does, except that no npm walk can see cargo: the
  notice is generated from the lockfile and `check:repo` fails if the
  two ever disagree.
- **Two things that were invisible are visible again.** A window opened
  from inside another window rendered nothing on a desktop — pasting an
  image into the position loader looked like the loader simply closing,
  and every other window-inside-a-window was equally blank. And the
  opening map's catalogue names were painted in a colour that no longer
  exists, which resolves to black: unreadable on the dark theme,
  off-palette on the light one. Both had been shipped for a release or
  more; both are one line, and the repo check now greps for the retired
  colour names in the `var()` form that hid this one.

## 0.4.9

The Woodpecker method for the books, a schedule for the tactics, and
Base UI under every control.

- **Woodpecker cycles for puzzle books.** A tactics book is a finite,
  curated set, and the method it is written for cycles that set rather
  than drip-feeding it. The book page grows a Cycles panel: start a
  pass, continue into the first puzzle it has not reached, stop it, and
  read the finished passes as rows with their solved/failed bars. While
  a pass runs the whole grid — tiles, bar, filter counts — reads
  through the pass's window, so starting a cycle visibly clears the
  board and stopping one hands the all-time record back; the trainer's
  done row offers exactly one way forward, Next in cycle; and the shelf
  card says where each book's rotation stands ("Cycle 2 — 412/959"). A
  pass closes itself on the attempt that completes it, and a pass
  nobody attempted never happened. Only the pass windows are stored:
  attempts, wins and the next puzzle all derive from the progress
  record, so there is no score to fall out of agreement with it.
- **Tactics learn a review schedule.** Both trainers remembered what
  was missed but never *when* to ask again — a failed puzzle sat
  reviewable for ever, and one scraped through once was done for good.
  A shared ladder (1, 3, 7, 21 days, keyed to clean solves since the
  last fail) now schedules every puzzle: review mode serves due puzzles
  first, most overdue first; a book's due count sits on its shelf card
  and its trainer chains Next review through the queue; the dashboard
  and hub lead with what is due, and when nothing is they say when the
  next review lands, so an empty queue reads as earned, not gone. A
  fixed ladder rather than SM-2, deliberately: tactics grade
  themselves, and ease buttons would hand the solver a verdict to
  self-assign.
- **A sacrifice is read from the position, not the opponent's reply.**
  The game review used to flag one by counting material two plies after
  a move, which answers "did the opponent take something": a quiet move
  followed by the opponent grabbing a defended piece earned a
  brilliancy, and a genuine offer the opponent declined went unmarked.
  Sacrifices are now settled with a material-only quiescence search on
  the position the move created. On Kasparov–Topalov 1999 the flags are
  exactly the immortal combination.
- **The explorer's players database takes a rating band.** The filters
  window the pane already has opens for the players source too, with
  the band chips the coverage dialog offers; the choice persists like
  every other filter. Masters keeps no window: its population is who
  qualifies, not a group.
- **The editor keeps its bearings.** Analyse now hands the board your
  flip along with the position; the browser's Back returns you to the
  position, tool and orientation you left; and opening the editor
  fresh — a tab, the More tile, a bookmark — starts clean. The online
  archive window learned the same lesson: opening a game navigates to
  the Board, and coming back now lands beside the window still open.
- **The last hand-rolled controls compose the registry.** Native
  checkboxes, radios and range inputs, raw `<hr>`s, hand-spun spinners,
  hand-labelled fields and hand-drawn empty states became the
  registry's Checkbox, RadioGroup, Slider, Separator, Spinner, Field
  and Empty; panels take the registry's own spacing model back off
  their call sites; icons beside button text declare themselves the
  registry's way. The knight plates retire — each empty shelf wears its
  own section's icon instead of a mascot.
- Smaller: the opening map's arrangement switch no longer redraws every
  dot where a drag had left it, and a cache-key mismatch that could
  freeze the page during the online mainline chase is fixed; the
  deviations list lines up as the table it is, with a draw as one ½
  glyph on the same chip the explorer uses; a refused upload no longer
  leaves a stray `.part` behind, and every rename in the vault retries
  the transient Windows error that once cost an upload.
- **The component layer stands on Base UI.** Every primitive under the
  shadcn/ui components — dialogs, menus, selects, tooltips, tabs,
  toggles, switches, sliders and the rest — is `@base-ui/react` now,
  from the maintainers Radix's own team moved on to become; `radix-ui`
  is gone from the tree. Nothing the app had learned on a device was
  thrown away: every window is still a bottom sheet on a phone, the back
  chevron, the keyboard band, the sole-field focus and Android's Back
  through CloseWatcher all survive, and a 48-shot screenshot grid against
  the old build came back 42/48 byte-identical with the rest explained
  (anti-aliasing noise, and the puzzle pages drawing a random puzzle by
  design).
- **The sheet's swipe physics are Base UI's Drawer now.** On a phone
  every window rides `Drawer` instead of `Dialog`, and the app's own
  235-line drag hook is retired: the swipe-from-anywhere gesture, the
  "your drag is a scroll until the scroller under your finger is at its
  top" arbitration and Android's Back all come from the primitive. What
  stayed app-owned, because no primitive has it: the page/layer parking
  and the chevron, the keyboard band, the sole-field focus, the rule
  that a touch on a text field or a canvas never becomes a drag, and
  the no-animation-on-phones rule (only the swipe's 180ms snap-back
  animates). Proved with real trusted input: swipe moves, short swipes
  snap back, long swipes dismiss, scrim taps and Escape still close.

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
  once with the importer's own detector and CellNet worker pool — when
  the book arrives, as a background job, or from the card's "Read
  diagrams" — and kept on the server per page. The pass is mandatory and
  resumable: a book opened before it is through has it started, or
  carried on from the pages already read, with its progress shown over
  the page; books asked for together are read one after another. A
  puzzle book imported from its PDF is not read twice — the import's own
  scan files every page's diagrams in the library copy as it goes. A
  322-page puzzle book reads in about three minutes on a 12-core machine;
  the first cut read boards one at a time on the main thread and took
  five seconds a page. The button asks White or Black to move
  rather than guessing — or
  opens the position in the editor, for a diagram it misread; the board's
  own header has the same way out for whatever is on it. The book scrolls
  as one column, page after page, with only the pages in view rendered;
  the reader fits the page to the pane's width or shows the whole page on
  one toggle, and goes to a page by number; a pinch on a phone follows
  the fingers and re-rasters once when they lift, and every zoom holds
  the point under them (or under the pane's centre) still instead of
  jumping to the page's top. The diagram buttons can be hidden from the
  toolbar, for books that print a caption where they sit. Beside the PDF, the moves
  panel sits next to the board where there is room and under it where
  there is not; on a phone the reader is the Board page's own shape —
  board on top, then Book, Moves and Engine as panes.
- **Books file into collections**, as studies and notes do: a heading
  per collection on the shelf, the shelf's own books first; "New
  collection" under Create, "Move to a collection" on a card, a target
  collection in the upload window, and the heading's menu to rename or
  (once empty) delete. A collection is a name on the book, not a folder
  on disk, so a book's id — and the puzzle book pointing at it — never
  moves.
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
- **Smaller things.** Both shelves' thumbnails arrive together on every
  path, not only the first cold load. Opening a book shows one loading
  treatment, kept up until the first page has actually painted. The
  reader's toolbar folds its view controls into a "…" menu where the
  pane is too narrow for the row. The colour scheme dropdown shows each
  scheme's dot. The gate's authenticator code is six proper slots. A
  sideline step no longer scrolls the moves panel to the top.

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
