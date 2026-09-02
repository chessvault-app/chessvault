/**
 * Cross-implementation fuzzing: the JS and Rust REPLAY scanners are the
 * pair the golden corpus only samples, and the route's per-hit re-check
 * (server/refgames.ts) can overrule a wrong hit but never see a game
 * the binary MISSED; this widens the sampling on demand, and in CI.
 *
 *   npm run fuzz:parity            (defaults: 200 games, seed from run)
 *   npm run fuzz:parity -- 500 7   (games, seed)
 *
 * Seeded and deterministic per (games, seed): capture- and
 * promotion-hungry self-play becomes a PGN corpus, both pipelines
 * build the first two thirds of it fresh from two source files (a
 * file boundary is where one shared parser loses the next file's
 * headers) and append the rest, every table is byte-compared (games,
 * plies, move_counts, scan_pack, key_index, players, openings,
 * events) and so is the schema — the indexes and lookup tables a data
 * diff cannot see. Each lookup is then held against the games table it
 * summarises: the append re-derives them by dropping and recreating,
 * and one that both sides forget to drop is stale on both at once,
 * which no cross-pipeline diff can see. Then a spread of deep hunts,
 * positions sampled from the corpus at several plies and rungs plus
 * material specs, runs three ways:
 *
 *  - the JS route over the JS build, the reference answer;
 *  - the native CLI over the Rust build, its hit frames against the
 *    reference's game frames — the replay pair head to head;
 *  - the JS route MOUNTED ON the Rust build with the binary spawned
 *    for real: the production arrangement, frame for frame, and
 *    asserted to have actually taken the native path (the response
 *    says which path answered) rather than quietly fallen through to
 *    the JS scan, which would compare JS with JS and prove nothing.
 *    Exact-rung hunts on a packed database go to the key index before
 *    the binary is considered, so those are asserted as key-index and
 *    the binary meets them only in the CLI comparison.
 *
 * Needs the release binary (`npm run build:native`); refuses to guess
 * without it, and refuses a build that does not declare the hit-frame
 * contract. Exits non-zero on the first divergence, printing the seed
 * to replay it.
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
import { canonicalMaterial, parseMaterialSpec } from '../shared/scanMatch.ts';

// Not from server/paths.ts: that module reads CHESS_VAULT_DATA when it
// is imported, and this script sets it (to the Rust build) before the
// server is imported at all, so the route mounts the Rust build as its
// real data directory — the one condition under which it spawns.
const REPO_ROOT = resolve(import.meta.dirname, '..');

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
{
  const declared = JSON.parse(execFileSync(binary, ['capabilities'], { encoding: 'utf8' })) as {
    deep?: unknown;
  };
  if (declared.deep !== 'hits') {
    console.error(`the binary declares deep-search output ${JSON.stringify(declared.deep ?? null)}, not "hits" — rebuild it`);
    process.exit(2);
  }
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
  return `[Event "Fuzz ${at % 5}"]\n[White "W${at}"]\n[Black "B${at}"]\n[Result "${result}"]\n[WhiteElo "${1000 + (at % 1800)}"]\n[BlackElo "${1100 + (at % 1700)}"]\n\n${tokens.join(' ')} ${result}\n`;
}

type Frame = Record<string, unknown> & { type: string };

/** The frames of one streamed answer, split into what every path must
    agree on: the game frames whole, and the done frame's verdicts.
    Progress frames and the done frame's scanned/total are each path's
    own bookkeeping (the key index counts candidates, a scan counts
    rows) and are not compared. */
function answerOf(text: string): string {
  const frames = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Frame);
  const games = frames.filter((f) => f.type === 'game').map((f) => JSON.stringify(f));
  const done = frames.find((f) => f.type === 'done');
  if (!done) return `NO DONE FRAME; ${games.length} games`;
  return `${games.join('\n')}\ndone matched=${done.matched} exhaustive=${done.exhaustive}`;
}

const fail = (why: string): never => {
  console.error(`DIVERGED ${why} — replay with: npm run fuzz:parity -- ${GAMES} ${SEED}`);
  process.exit(1);
};

async function main(): Promise<void> {
  console.log(`fuzz-parity: ${GAMES} games, seed ${SEED}`);
  const corpus = Array.from({ length: GAMES }, () => selfPlay(12 + randInt(140))).filter(
    (m) => m.split(' ').length >= 2,
  );
  const dir = mkdtempSync(join(tmpdir(), 'fuzz-parity-'));
  // The server, imported only now: its data directory is the Rust build.
  process.env.CHESS_VAULT_DATA = join(dir, 'rs');
  const { refGamesApi } = await import('../server/refgames.ts');
  let jsApi: ReturnType<typeof refGamesApi> | null = null;
  let rsApi: ReturnType<typeof refGamesApi> | null = null;
  try {
    // Three files: the first two are built fresh in one pass (each
    // ends on its last result line with no blank line after it, the
    // shape that made one parser swallow the next file's headers), the
    // third appended, so the append path — dedup, index extension,
    // lookup re-derivation — is exercised on both sides too.
    const pgns = corpus.map((m, at) => pgnOf(m, at));
    const third = Math.max(1, Math.floor(pgns.length / 3));
    const files = [
      [join(dir, 'fuzz-a.pgn'), pgns.slice(0, third)],
      [join(dir, 'fuzz-b.pgn'), pgns.slice(third, third * 2)],
      [join(dir, 'fuzz-extra.pgn'), pgns.slice(third * 2)],
    ] as const;
    for (const [path, games] of files) writeFileSync(path, games.join('\n'));
    const [a, b, extra] = files.map(([path]) => path) as [string, string, string];
    for (const side of ['js', 'rs']) {
      const dataDir = join(dir, side);
      for (const [sources, flags] of [
        [[a, b], []],
        [[extra], ['--append']],
      ] as const) {
        if (side === 'js') {
          execFileSync(
            process.platform === 'win32' ? 'npx.cmd' : 'npx',
            ['tsx', 'scripts/build-refgames.ts', ...sources, '--name', 'fuzz', ...flags],
            { cwd: REPO_ROOT, env: { ...process.env, CHESS_VAULT_DATA: dataDir }, shell: true, stdio: 'ignore' },
          );
        } else {
          execFileSync(binary!, ['build', ...sources, '--name', 'fuzz', ...flags, '--data', dataDir], {
            stdio: 'ignore',
          });
        }
      }
    }
    const jsFile = join(dir, 'js', 'refgames', 'fuzz.sqlite');
    const rsFile = join(dir, 'rs', 'refgames', 'fuzz.sqlite');
    const js = new Database(jsFile, { readonly: true });
    const rs = new Database(rsFile, { readonly: true });
    const collapse = (row: Record<string, unknown>): Record<string, unknown> =>
      typeof row.sql === 'string' ? { ...row, sql: row.sql.split(/\s+/).join(' ') } : row;
    for (const [table, q] of [
      ['games', 'SELECT * FROM games ORDER BY id'],
      ['plies', 'SELECT * FROM plies ORDER BY game_id, ply'],
      ['move_counts', 'SELECT * FROM move_counts ORDER BY pos, uci, eb'],
      ['scan_pack', 'SELECT game_id, hex(pack) p FROM scan_pack ORDER BY game_id'],
      ['key_index', 'SELECT bucket, hex(entries) e FROM key_index ORDER BY bucket'],
      ['players', 'SELECT * FROM players ORDER BY name'],
      ['openings', 'SELECT * FROM openings ORDER BY opening, eco'],
      ['events', 'SELECT * FROM events ORDER BY event'],
      [
        'schema',
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      ],
    ] as const) {
      const a = JSON.stringify((js.prepare(q).all() as Record<string, unknown>[]).map(collapse));
      const b = JSON.stringify((rs.prepare(q).all() as Record<string, unknown>[]).map(collapse));
      if (a !== b) fail(`in ${table}`);
      console.log(`  ${table}: identical`);
    }
    // The lookups summarise the games table, and the append re-derives
    // them by dropping and recreating. A table both sides forget to
    // drop is identical across pipelines AND stale, so each is also
    // held against a fresh derivation from the games it summarises.
    for (const [table, stored, derived] of [
      [
        'players',
        'SELECT * FROM players ORDER BY name',
        `SELECT name, COUNT(*) AS games, SUM(w) AS as_white, SUM(b) AS as_black, MAX(elo) AS max_elo
         FROM (
           SELECT white AS name, 1 AS w, 0 AS b, white_elo AS elo FROM games
           UNION ALL
           SELECT black AS name, 0 AS w, 1 AS b, black_elo AS elo FROM games
         ) GROUP BY name ORDER BY name`,
      ],
      [
        'openings',
        'SELECT * FROM openings ORDER BY opening, eco',
        `SELECT opening, eco, COUNT(*) AS games FROM games
         WHERE opening IS NOT NULL OR eco IS NOT NULL GROUP BY opening, eco ORDER BY opening, eco`,
      ],
      [
        'events',
        'SELECT * FROM events ORDER BY event',
        `SELECT event, COUNT(*) AS games FROM games
         WHERE event IS NOT NULL GROUP BY event ORDER BY event`,
      ],
    ] as const) {
      for (const [side, db] of [
        ['js', js],
        ['rs', rs],
      ] as const) {
        const a = JSON.stringify(db.prepare(stored).all());
        const b = JSON.stringify(db.prepare(derived).all());
        if (a !== b) fail(`— ${table} is stale after the append (${side})`);
      }
      console.log(`  ${table}: current after append`);
    }
    js.close();
    rs.close();

    // The hunts, three ways. The JS route over the JS build is the
    // reference; the CLI over the Rust build is the replay pair head to
    // head; the route over the Rust build is production.
    jsApi = refGamesApi(jsFile);
    rsApi = refGamesApi();
    const jsApp = new Hono().route('/api', jsApi);
    const rsApp = new Hono().route('/api', rsApi);
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
      const rung = ['', '&match=pawns', '&match=files', '&match=material', '&match=structure'][at % 5]!;
      // Every third hunt filtered, so the filter negotiation and the
      // binary's games_where run too — an event the corpus has, a
      // result, a floor most games clear.
      const filter = ['', '&event=Fuzz%201', '&result=1-0', '&minElo=1200'][at % 4]!;
      hunts.push(`fen=${fen}${rung}${filter}`);
    }
    hunts.push(
      `material=${encodeURIComponent('{"diff":{"q":[1,9]},"stable":2}')}`,
      `material=${encodeURIComponent('{"white":{"q":[0,0]},"black":{"q":[0,0]},"stable":4}')}`,
      `material=${encodeURIComponent('{"white":{"r":[1,2]},"stable":3}')}&result=0-1`,
    );
    let compared = 0;
    const paths = new Map<string, number>();
    for (const hunt of hunts) {
      const res = await jsApp.request(`/api/refgames/deep-search?${hunt}`);
      if (res.status !== 200) continue;
      const reference = answerOf(await res.text());
      const params = new URLSearchParams(hunt);

      // The CLI: its hits against the reference's games.
      const argv = ['deep-search', 'fuzz', '--data', join(dir, 'rs')];
      const filters: Record<string, string> = {};
      for (const key of ['event', 'result', 'minElo']) {
        const value = params.get(key);
        if (value !== null) filters[key] = value;
      }
      argv.push('--filters', JSON.stringify(filters));
      // The CLI parses only the canonical serialisation — the server
      // validates for it, so the fuzz must too.
      if (params.get('material'))
        argv.push('--material', canonicalMaterial(parseMaterialSpec(params.get('material')!)!));
      else {
        argv.push('--fen', params.get('fen')!);
        if (params.get('match')) argv.push('--match', params.get('match')!);
      }
      const out = execFileSync(binary!, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const cliHits = out
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Frame)
        .filter((f) => f.type === 'hit')
        .map((f) => `${f.id}:${f.ply}`)
        .join(',');
      const referenceHits = reference
        .split('\n')
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l) as Frame)
        .map((f) => `${f.id}:${f.ply}`)
        .join(',');
      if (cliHits !== referenceHits) fail(`between the CLI and the JS route on hunt ${hunt}`);

      // Production: the route over the Rust build, binary spawned. An
      // exact position hunt is answered by the key index before the
      // binary is asked; everything else must have reached it.
      const expectedPath = params.has('fen') && !params.has('match') ? 'key-index' : 'native';
      const live = await rsApp.request(`/api/refgames/deep-search?db=fuzz&${hunt}`);
      if (live.status !== 200) fail(`the route over the Rust build answered ${live.status} on hunt ${hunt}`);
      const took = live.headers.get('x-scan-path');
      if (took !== expectedPath) {
        fail(`the route over the Rust build took the ${took ?? 'unknown'} path, not ${expectedPath}, on hunt ${hunt}`);
      }
      paths.set(expectedPath, (paths.get(expectedPath) ?? 0) + 1);
      if (answerOf(await live.text()) !== reference) {
        fail(`between the route over the Rust build and over the JS build on hunt ${hunt}`);
      }
      compared += 1;
    }
    console.log(
      `  hunts: ${compared} compared three ways, identical (route over the Rust build: ${[...paths]
        .map(([path, n]) => `${n} ${path}`)
        .join(', ')})`,
    );
    console.log('fuzz-parity: clean');
  } finally {
    jsApi?.closeDb();
    rsApi?.closeDb();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

void main();
