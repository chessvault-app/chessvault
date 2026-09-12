# Contributing

Issues and pull requests are welcome. Before either, the short version
of how this repository works:

- **Run the checks.** `npm run verify` is what CI runs on every push:
  typecheck, lint, tests and `check:repo`. A change that does not pass
  it is not ready.
- **Read `CLAUDE.md`.** It is the repository's standing rules, written
  for anyone working here, human or agent: what belongs in the repo,
  where behaviour belongs, and how a change is proved. Every rule in it
  exists because ignoring it once produced something that had to be
  undone.
- **Design decisions are written down.** `DESIGN.md` and
  `docs/design-principles.md` say why the UI looks and behaves as it
  does; `docs/architecture.md` says how the pieces fit. A change that
  argues with one of them should argue with the document, not around it.
- **One verified change per commit,** with a message that says why it
  was needed and what it cost, not just what changed. Behaviour-neutral
  refactors and behaviour changes go in separate commits so the neutral
  one stays provable.
- **Measure, do not assert.** Anything visible is proved with
  `npm run shots:grid` against a baseline; anything fast is proved with
  the number that was measured.

Bugs go in [Issues](https://github.com/chessvault-app/chessvault/issues)
with the version, the platform, and what you did. Security problems go
through `SECURITY.md` instead.
