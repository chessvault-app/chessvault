# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: serious chess improvers who self-host. Club and tournament
players who want their analysis, repertoire work, annotated games and
puzzle training kept in files they own, and who will run an installer or
stand up a small server to get that. They are comfortable with the idea
of a folder on disk being the source of truth; they are not necessarily
comfortable with a terminal, and are never required to use one.

They arrive with material already: Chess.com and Lichess accounts with
years of games, PGNs collected from elsewhere, and physical or scanned
chess books. The product's job starts by taking that in, not by asking
them to begin again.

A second, factual audience: the same person on a phone. The vault lives
on one device or one server, and every other device is a client of it.

## Product Purpose

A private, self-hosted chess workbench. It holds the whole of one
player's chess work — engine analysis, opening explorer, studies, notes,
a curated game collection, database search, book reading and puzzle
training — and stores all of it as PGN, markdown and JSON in a single
folder the user owns.

Success is a complete workbench that does not rot: correct, thorough,
self-consistent, and still true years from now. When completeness and
reach conflict, completeness wins. Adoption is welcome and is not the
measure.

## Positioning

The mechanism a neighbouring product could not truthfully copy is the
vault itself, taken from Obsidian and applied to chess:

*Everything is a plain file.* The vault is a folder any editor can open
and any backup tool can copy. There is no database holding the work
hostage, no export step, and nothing that stops being readable if this
app does. The parts that genuinely are databases — the puzzle pool,
reference games, indexes — are all derived, live outside the vault, and
can be deleted and rebuilt.

*Everything points at everything else.* A note links a study, a study
links a game, a game links back to the note, using the same
`[[wiki-links]]` Obsidian uses, resolved across all three. Chess material
is treated as one connected body of work rather than a pile of separate
documents.

Neither claim is marketing: both are load-bearing on how the product is
built, and either would be expensive for a cloud-hosted competitor to
adopt.

## Operating Context

Two deployments of the same code, differing only in where the vault
lives:

- **On this computer.** A desktop installer for Windows, macOS and Linux.
  The app starts its own server; nothing leaves the device; updates
  arrive through the app.
- **On a server.** One small Linux box owns the vault; phone, laptop and
  desktop are all clients over HTTPS. Chosen only when the same vault is
  wanted from more than one device.

The app is HTTP-API-only. The desktop shell and any phone client are
clients of the same API, and no behaviour may assume local disk.

Typical sessions: reviewing a game just played against the engine and
the explorer; building or drilling a repertoire against a real field of
games; working a tactics book in cycles; keeping notes and studies that
link back to both. On a phone, the bottom bar becomes the open page's
controls, Chess.com/Lichess-style.

The interface is bilingual English and Korean throughout, including the
docs and the public site. Both languages ship together; neither is a
translation layer bolted on later.

## Capabilities and Constraints

Sections of the app: home, board, workspace, editor, studies, notes,
games, books, puzzles, repertoire, opening map, databases, settings.

Confirmed capabilities include Stockfish 18 in the browser (WASM,
multi-threaded) with move trees, comments, NAGs and arrows; game review
with accuracy and brilliancy detection; an opening explorer over local
reference databases, Lichess, and the user's own games; database search
by query language, by position (exact through progressively loosened, to
bare material) and by material situation; PDF book reading beside the
board with a board button on printed diagrams; a puzzle trainer with a
spaced review ladder (a day, then 3, 7 and 21) and Woodpecker-style book
cycles; an opening map of the user's preparation, derived live from the
studies it links; a PWA and desktop installers.

Durable constraints future work must preserve:

- **Every user action must be possible in the app.** Nothing may require
  a shell, a script, or file access. A missing UI for something a user
  needs to do is a bug, not a documentation gap.
- **The vault is user data and is never committed** to the repository:
  games, notes, studies, imported books, and the config that holds
  tokens.
- **No rating for the solver.** Difficulty is reported as a word. A
  rating is how the trainer picks a puzzle, not a verdict handed back to
  whoever solved it. A game's own header Elo is the record of that game
  and is shown as the date is.
- **Nothing is imported on trust.** A position, a side to move and a
  solution are accepted together only when replaying that solution in
  that position is legal. What fails degrades to a lower fidelity tier or
  a draft; it is never guessed at.
- **Every book-specific fact is data, never code.** No per-book scripts;
  a book that fits no existing style is handled by supplying a pattern.
- **Book content extracted from commercial PDFs is not redistributed.**
  No book is bundled; users supply the PDF of a book they own, and what
  it yields stays in their vault.
- **A second, native implementation exists** (a Rust core mirroring four
  jobs that also exist in TypeScript) and the two must answer
  identically; both are pinned to shared fixtures.
- **UI text is sentence case.**

Terminology used consistently by the product and its docs: *vault*,
*study*, *note*, *collection*, *reference database*, *field*, *band*
(difficulty), *fidelity tier*, *draft*, *opening map*, *import*.

*Import* is the verb for bringing outside material in — a PDF, a PGN, a
Lichess or Chess.com account — and it is in this list because it had
drifted into three words for one act: the Books shelf, then still called
a library, said "Upload PDF", its dialog said "Add a book" and then "Add
to library", while the puzzle shelf and every document in the repository
said import. Upload is what
the network does and is fine in a progress line; import is what the user
did.

## Brand Commitments

Name: **Chess Vault**. Tagline: "Your chess, in plain files."

Licence: GPL-3.0-only. The repository is public.

Voice, as established across the README, the docs and the landing page:
plain, specific, and unwilling to overclaim. Numbers are quoted with what
measured them, limitations are stated rather than omitted, and a
paragraph explains why a thing is the way it is rather than only what it
does. Marketing register and superlatives are absent by choice.

The interface is English and Korean; both are maintained in step, and a
new user-facing string is not finished in one language alone.

## Evidence on Hand

- A public landing page and docs site, both bilingual.
- A live browser demo running the whole app on a seeded vault, needing
  no install and no account.
- Real screenshots and a recorded book-to-board interaction, captured
  from the built demo by a committed script rather than mocked.
- Measured performance figures for database search on a ten-million-game
  corpus, published with the hardware they were measured on.
- Design and architecture documentation, in both languages.

There are no testimonials, no customers, no press, no pricing and no
usage numbers. Future work must not fabricate any of these.

## Product Principles

1. **The vault outlives the app.** Anything that cannot be reconstructed
   is a plain file the user owns; anything derived is disposable and
   rebuildable. No format may hold the work hostage.
2. **Every action belongs in the app.** If a user needs to do it, the
   interface can do it — no shell, no script, no file manager.
3. **Nothing is accepted or presented on trust.** Imports are verified by
   replay, claims are quoted with their measurement, and what could not
   be verified is labelled honestly rather than dropped or dressed up.
4. **It is one connected body of work.** Notes, studies, games and
   preparation link to each other and derive from each other; features
   that would isolate a document are working against the product.
5. **Completeness over reach.** Depth, correctness and self-consistency
   settle tradeoffs against growth, novelty or breadth of audience.

## Accessibility & Inclusion

**Open — deliberately undecided.** No conformance target has been set.
The existing code shows consistent care (aria labels across the
component layer, `prefers-reduced-motion` honoured including in the
animated opening map, a documented full-keyboard shortcut set, and
coarse-pointer hit areas for touch), but no standard has been adopted
that future work is held to, and none should be asserted until the user
settles it.
