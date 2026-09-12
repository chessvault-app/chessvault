# Security

Chess Vault is a self-hosted app: the server holds your vault and, when a
token is set, answers to anyone who has it. A flaw that exposes a vault,
its token, or the machine it runs on is what this file is for.

**Report it privately.** Use GitHub's private vulnerability reporting on
this repository (Security tab, "Report a vulnerability"). Do not open a
public issue for it. Include the version (Settings shows it), how the
app was running (desktop installer, or the server on its own), and the
steps that reproduce it.

**What to expect.** An acknowledgement within a week. A fix ships as a
patch release with a line in `docs/update-log.md` that says what was
wrong, once the fix is out.

**In scope:** the server (`server/`), the desktop shell (`desktop/`),
the web client, and the book importer's handling of uploaded PDFs.

**Out of scope:** the public demo, which runs entirely in the browser
on a synthetic vault and holds nothing of anyone's; and Stockfish,
pdf.js and the other bundled third-party code, which have their own
channels (see `THIRD-PARTY.md`).
