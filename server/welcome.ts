import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT, VAULT_NOTES, VAULT_STUDIES } from './paths.ts';

/**
 * Onboarding as content: a fresh vault opens with one study and one note
 * already in it, each teaching the thing it is.
 *
 * A tour explains an app; a document IS the app being used, learnable by
 * clicking the thing itself — the pattern Obsidian seeded its own vaults
 * with, and this vault's whole ancestry. Both documents say plainly that
 * deleting them is fine.
 *
 * Seeded exactly once per vault, recorded in `.welcomed` beside the
 * folders. The marker — not "seed whenever empty" — is what makes
 * deletion stick: without it, deleting the welcome note in an otherwise
 * empty vault would resurrect it on the next restart, which is the
 * behaviour of a haunted house. A vault that already has documents gets
 * the marker and no seed: its owner needs no welcome.
 */

const MARKER = resolve(VAULT, '.welcomed');

const hasDocs = (dir: string, ext: string): boolean => {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf-8' }).some((f) => f.endsWith(ext));
  } catch {
    return false;
  }
};

/**
 * Three chapters of ordinary PGN — comments, a variation, a set-up
 * position — so the study demonstrates the file format it is stored in.
 */
export const WELCOME_STUDY = `[Event "Welcome to Chess Vault: A study, in chapters"]
[StudyName "Welcome to Chess Vault"]
[ChapterName "A study, in chapters"]
[Result "*"]

{ Welcome. A study is a set of chapters — moves, comments and side lines, kept as a plain PGN file in your vault. Step through this one with the arrow keys or by clicking moves. }
1. e4 { Comments sit on moves. Select a move and write your own in the panel beside the board. } 1... e5 2. Nf3 Nc6 3. Bb5 { The Ruy Lopez. Side lines live in parentheses — click into one and the board follows. } (3. Bc4 { The Italian, as a side line. Any legal move you play on the board becomes a line like this one, to keep or to prune. } 3... Bc5) 3... a6 *

[Event "Welcome to Chess Vault: Make it yours"]
[StudyName "Welcome to Chess Vault"]
[ChapterName "Make it yours"]
[Result "*"]

{ Play any legal move on the board — it becomes a new line at once. Rename this study from its own header, add chapters from the chapter list, and bookmark it on the shelf if it earns a place. }
1. d4 d5 2. c4 { A position worth keeping? The share menu exports the chapter or the whole study as PGN. } *

[Event "Welcome to Chess Vault: Where things live"]
[StudyName "Welcome to Chess Vault"]
[ChapterName "Where things live"]
[Result "*"]

{ Everything here is a plain file: this study is vault/studies/Welcome to Chess Vault.pgn, readable by any chess tool and synced by anything that syncs files. Lichess studies import whole from the shelf's Create menu. Delete this study whenever you like — it will not come back. }
1. Nf3 *
`;

export const WELCOME_NOTE = `# Welcome to Chess Vault

Notes are plain markdown with live boards anywhere in the text. This one is an ordinary \`.md\` file in \`vault/notes\`.

- Press **Edit**, then type \`/board\` at the start of a line — or press the knight in the toolbar — and a board drops in.
- Boards are real: play moves on them and the moves save with the note.
- \`[[Double brackets]]\` link notes to each other, Obsidian-style.

\`\`\`chess
1. e4 c5 (1... e5 2. Nf3 { Boards carry whole lines, comments included. }) *
\`\`\`

Delete this note whenever you like — it will not come back.
`;

export function seedWelcomeDocs(): void {
  if (existsSync(MARKER)) return;
  const fresh = !hasDocs(VAULT_STUDIES, '.pgn') && !hasDocs(VAULT_NOTES, '.md');
  if (fresh) {
    try {
      writeFileSync(resolve(VAULT_STUDIES, 'Welcome to Chess Vault.pgn'), WELCOME_STUDY);
      writeFileSync(resolve(VAULT_NOTES, 'Welcome.md'), WELCOME_NOTE);
    } catch {
      // A vault that cannot be written will fail louder on first real use;
      // the welcome is not the place to crash the server from.
      return;
    }
  }
  // Written for lived-in vaults too: their owners need no welcome, and the
  // marker records the decision so nothing re-asks it.
  writeFileSync(MARKER, `${JSON.stringify({ seeded: fresh, at: new Date().toISOString() })}\n`);
}
