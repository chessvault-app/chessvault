# Update log

What changed, newest first. Feature-level entries, not a commit ledger —
`git log` has the full detail.

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
