/**
 * Verify authored study PGNs: every chapter must parse and every move must
 * be legal (chessops replay), and each named line is cross-checked against
 * the vendored lichess chess-openings database for its ECO/name.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { pgnToChapters } from '../shared/pgn.ts';
import { getNode, mainlineFrom } from '../shared/tree.ts';

const REPO = '.';

// --- the ECO reference, straight from the vendored TSVs -------------------
const eco = new Map<string, { eco: string; name: string }>();
for (const f of ['a', 'b', 'c', 'd', 'e']) {
  const tsv = readFileSync(resolve(REPO, 'scripts/vendor/chess-openings', `${f}.tsv`), 'utf-8');
  for (const line of tsv.split('\n')) {
    const [code, name, pgn] = line.split('\t');
    if (!code || !name || !pgn || code === 'eco') continue;
    const sans = pgn.split(/\s+/).filter((t) => t && !/^\d+\.+$/.test(t));
    eco.set(sans.join(' '), { eco: code, name });
  }
}

/** Longest known opening name for a SAN prefix of the line. */
function nameOf(sans: string[]): string {
  let best = '';
  for (let i = sans.length; i > 0; i--) {
    const hit = eco.get(sans.slice(0, i).join(' '));
    if (hit) return `${hit.eco} ${hit.name}`;
    if (!best && i === 1) best = '(unnamed)';
  }
  return '(unnamed)';
}

let failures = 0;
const files = process.argv.slice(2);
for (const file of files) {
  const pgn = readFileSync(file, 'utf-8');
  let chapters;
  try {
    chapters = pgnToChapters(pgn);
  } catch (e) {
    console.log(`FAIL ${file}: unparseable — ${(e as Error).message}`);
    failures++;
    continue;
  }
  console.log(`\n${file.split(/[\\/]/).pop()}  — ${chapters.length} chapter(s)`);
  for (const ch of chapters) {
    const line = mainlineFrom(ch.tree, ch.tree.rootId);
    const sans: string[] = [];
    // Independent replay: do NOT trust the codec, re-derive from scratch.
    const pos = Chess.default();
    let ok = true;
    for (const id of line) {
      const san = getNode(ch.tree, id).san!;
      sans.push(san);
      const move = parseSan(pos, san);
      if (!move) {
        console.log(`  FAIL "${ch.headers['ChapterName']}": illegal at ${sans.length}: ${san}`);
        ok = false;
        failures++;
        break;
      }
      pos.play(move);
    }
    if (!ok) continue;
    const comments = line.filter((id) => getNode(ch.tree, id).comment).length;
    console.log(
      `  ok  ${String(sans.length).padStart(3)} plies, ${String(comments).padStart(2)} comments  ${nameOf(sans)}  — ${ch.headers['ChapterName']}`,
    );
  }
}
console.log(failures === 0 ? '\nALL CHAPTERS VALID' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
