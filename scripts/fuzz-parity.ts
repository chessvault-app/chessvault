/**
 * Cross-implementation fuzzing: the one pair of implementations with
 * no runtime tether is the JS and Rust REPLAY scanners (when the Rust
 * spawn path answers, JS never re-checks it), and the golden corpus
 * samples them; this widens the sampling on demand.
 *
 *   npm run fuzz:parity            (defaults: 200 games, seed from run)
 *   npm run fuzz:parity -- 500 7   (games, seed)
 *
 * Seeded and deterministic per (games, seed): capture- and
 * promotion-hungry self-play becomes a PGN corpus, both pipelines
 * build it, every table is byte-compared (games, plies, move_counts,
 * scan_pack, key_index), and a spread of deep hunts — positions
 * sampled from the corpus at several plies and rungs, plus material
 * specs — runs through the JS route AND the native deep-search CLI,
 * frames compared. Needs the release binary
 * (`npm run build:native`); refuses to guess without it. Exits
 * non-zero on the first divergence, printing the seed to replay it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { Chess, normalizeMove } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import type { NormalMove, Role } from 'chessops/types';
import { refGamesApi } from '../server/refgames.ts';
import { canonicalMaterial, parseMaterialSpec } from '../shared/scanMatch.ts';
import { REPO_ROOT } from '../server/paths.ts';

const GAMES = Number(process.argv[2]) || 200;
const SEED = BigInt(Number(process.argv[3]) || Date.now() % 1_000_000);

const exe = process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core';
const binary = [
  resolve(REPO_ROOT, 'server', exe),
  resolve(REPO_ROOT, 'native', 'target', 'release', exe),
].find(existsSync);
if (!binary) {
  console.error('no native binary — npm run build:native first');
  process.exit(2);
}

const MASK64 = (1n << 64n) - 1n;
let state = (SEED * 0x9e3779b97f4a7c15n) & MASK64;
const rng = (): bigint => {
  state = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = state;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
};
const randInt = (n: number): number => Number(rng() % BigInt(n));

const legalMoves = (pos: Chess): NormalMove[] => {
  const out: NormalMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from);
      if (piece?.role === 'pawn' && (to >= 56 || to <= 7)) {
        for (const promotion of ['queen', 'knight', 'rook', 'bishop'] as Role[]) {
          out.push({ from, to, promotion });
        }
      } else {
        out.push({ from, to });
      }
    }
  }
  return out;
};

const selfPlay = (targetPlies: number): string => {
  const pos = Chess.default();
  const sans: string[] = [];
  for (let ply = 0; ply < targetPlies; ply += 1) {
    const moves = legalMoves(pos);
    if (moves.length === 0) break;
    const hungry = moves.filter(
      (m) => m.promotion !== undefined || pos.board.get(m.to) !== undefined,
    );
    const pool = hungry.length > 0 && randInt(3) !== 0 ? hungry : moves;
    sans.push(makeSanAndPlay(pos, normalizeMove(pos, pool[randInt(pool.length)]!)));
  }
  return sans.join(' ');
};

function pgnOf(moves: string, at: number): string {
  const tokens: string[] = [];
  moves.split(' ').forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
  });
  const result = ['1-0', '0-1', '1/2-1/2'][at % 3]!;
  return `[Event "Fuzz"]\n[White "W${at}"]\n[Black "B${at}"]\n[Result "${result}"]\n[WhiteElo "${1000 + (at % 1800)}"]\n[BlackElo "${1100 + (at % 1700)}"]\n\n${tokens.join(' ')} ${result}\n`;
}

async function main(): Promise<void> {
  console.log(`fuzz-parity: ${GAMES} games, seed ${SEED}`);
  const corpus = Array.from({ length: GAMES }, () => selfPlay(12 + randInt(140))).filter(
    (m) => m.split(' ').length >= 2,
  );
  const dir = mkdtempSync(join(tmpdir(), 'fuzz-parity-'));
  try {
    const pgn = join(dir, 'fuzz.pgn');
    writeFileSync(pgn, corpus.map((m, at) => pgnOf(m, at)).join('\n'));
    for (const side of ['js', 'rs']) {
      const dataDir = join(dir, side);
      if (side === 'js') {
        execFileSync(
          process.platform === 'win32' ? 'npx.cmd' : 'npx',
          ['tsx', 'scripts/build-refgames.ts', pgn, '--name', 'fuzz'],
          { cwd: REPO_ROOT, env: { ...process.env, CHESS_VAULT_DATA: dataDir }, shell: true, stdio: 'ignore' },
        );
      } else {
        execFileSync(binary!, ['build', pgn, '--name', 'fuzz', '--data', dataDir], {
          stdio: 'ignore',
        });
      }
    }
    let api: ReturnType<typeof refGamesApi> | null = null;
    const js = new Database(join(dir, 'js', 'refgames', 'fuzz.sqlite'), { readonly: true });
    const rs = new Database(join(dir, 'rs', 'refgames', 'fuzz.sqlite'), { readonly: true });
    for (const [table, q] of [
      ['games', 'SELECT * FROM games ORDER BY id'],
      ['plies', 'SELECT * FROM plies ORDER BY game_id, ply'],
      ['move_counts', 'SELECT * FROM move_counts ORDER BY pos, uci, eb'],
      ['scan_pack', 'SELECT game_id, hex(pack) p FROM scan_pack ORDER BY game_id'],
      ['key_index', 'SELECT bucket, hex(entries) e FROM key_index ORDER BY bucket'],
    ] as const) {
      const a = JSON.stringify(js.prepare(q).all());
      const b = JSON.stringify(rs.prepare(q).all());
      if (a !== b) {
        console.error(`DIVERGED in ${table} — replay with: npm run fuzz:parity -- ${GAMES} ${SEED}`);
        process.exit(1);
      }
      console.log(`  ${table}: identical`);
    }
    js.close();

    // The replay pair, head to head: hunts through the JS route (the
    // scratch mount never spawns native) against the deep-search CLI.
    rs.close();
    api = refGamesApi(join(dir, 'js', 'refgames', 'fuzz.sqlite'));
    const app = new Hono().route('/api', api);
    const positionAt = (moves: string, ply: number): Chess | null => {
      const pos = Chess.default();
      let at = 0;
      for (const san of moves.split(' ')) {
        if (at === ply) return pos;
        const move = parseSan(pos, san);
        if (!move) return null;
        pos.play(move);
        at += 1;
      }
      return at === ply ? pos : null;
    };
    const hunts: string[] = [];
    for (let at = 0; at < 24; at += 1) {
      const moves = corpus[randInt(corpus.length)]!;
      const pos = positionAt(moves, randInt(Math.max(1, moves.split(' ').length)));
      if (!pos) continue;
      const fen = encodeURIComponent(makeFen(pos.toSetup()));
      const rung = ['', '&match=pawns', '&match=files', '&match=material'][at % 4]!;
      hunts.push(`fen=${fen}${rung}`);
    }
    hunts.push(
      `material=${encodeURIComponent('{"diff":{"q":[1,9]},"stable":2}')}`,
      `material=${encodeURIComponent('{"white":{"q":[0,0]},"black":{"q":[0,0]},"stable":4}')}`,
    );
    let compared = 0;
    for (const hunt of hunts) {
      const res = await app.request(`/api/refgames/deep-search?${hunt}`);
      if (res.status !== 200) continue;
      const jsFrames = (await res.text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((f) => f.type === 'game')
        .map((f) => `${f.id}:${f.ply}`)
        .join(',');
      const params = new URLSearchParams(hunt);
      const argv = ['deep-search', 'fuzz', '--filters', '{}', '--data', join(dir, 'rs')];
      // The CLI parses only the canonical serialisation — the server
      // validates for it, so the fuzz must too.
      if (params.get('material'))
        argv.push('--material', canonicalMaterial(parseMaterialSpec(params.get('material')!)!));
      else {
        argv.push('--fen', params.get('fen')!);
        if (params.get('match')) argv.push('--match', params.get('match')!);
      }
      const out = execFileSync(binary!, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const rsFrames = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .filter((f) => f.type === 'game')
        .map((f) => `${f.id}:${f.ply}`)
        .join(',');
      if (jsFrames !== rsFrames) {
        console.error(`DIVERGED on hunt ${hunt} — replay with: npm run fuzz:parity -- ${GAMES} ${SEED}`);
        process.exit(1);
      }
      compared += 1;
    }
    console.log(`  hunts: ${compared} compared, identical`);
    console.log('fuzz-parity: clean');
    api?.closeDb();
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

void main();
