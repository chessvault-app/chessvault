# Update log

*English · [한국어](update-log.ko.md)*

What changed, newest first. Feature-level entries, not a commit ledger —
`git log` has the full detail.

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
  packages, and Electron's 773 Chromium components — each opening to its
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

- **Second and third books imported** — per-book import configs, an
  engine pool with a persistent search cache, and solution-constrained
  board repair (the book's own line fixes misread diagrams). The
  Complete Chess Workout and The Woodpecker Method joined the shelf,
  ~3,150 verified puzzles across three books.
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
