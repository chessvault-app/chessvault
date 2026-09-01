/**
 * Do your own tables answer what the reference server answers?
 *
 *   npm run check:tablebase -- --tables data/syzygy
 *   npm run check:tablebase -- --tables /mnt/syzygy --positions 200
 *
 * The app can take its endgame verdicts from three places now — the
 * public server, a lila-tablebase of your own, or the native prober
 * reading `.rtbz` files directly — and a user is entitled to assume all
 * three say the same thing. Two of them are somebody else's code; the
 * third is ours, and this is how it earns the same trust.
 *
 * It walks random legal endings, asks the native prober and
 * tablebase.lichess.ovh about each, and compares the verdict for the
 * position AND for every legal move. Any disagreement is printed and
 * exits non-zero.
 *
 * Needs the release binary (`npm run build:native`) and a directory of
 * Syzygy files; it refuses to guess at either. It also needs the
 * network, and it is deliberately slow — one upstream request per
 * position, paced — because the reference here is somebody else's
 * server and hammering it to check our own work would be rude.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';

const UPSTREAM = 'https://tablebase.lichess.ovh/standard';
/** Politeness, in milliseconds between upstream requests. */
const PACE = 350;

interface Move {
  uci: string;
  category: string;
}
interface Answer {
  category: string;
  moves: Move[];
}

const arg = (name: string, fallback?: string): string | undefined => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};

/**
 * Endings to start from, and the walk that varies them.
 *
 * Seeds rather than random placement: a randomly filled board is mostly
 * illegal and, where legal, mostly a position no ending ever reaches.
 * Walking a few plies from real material balances samples what people
 * actually look up, and every position on the way is legal by
 * construction.
 */
const SEEDS = [
  '8/8/8/4k3/8/8/8/K1Q5 w - - 0 1', // KQ v K
  '8/8/8/4k3/8/8/8/K1R5 w - - 0 1', // KR v K
  '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', // KP v K
  '8/8/8/3k4/8/8/3PK3/8 w - - 0 1', // KP v K, another shape
  '8/8/4k3/8/8/4K3/4B3/6N1 w - - 0 1', // KBN v K
  '8/8/8/4k3/7r/8/8/K1Q5 w - - 0 1', // KQ v KR
  '8/8/5k2/8/8/5K2/4PP2/8 w - - 0 1', // KPP v K
  '8/6p1/5k2/8/8/5K2/4P3/8 w - - 0 1', // KP v KP
];

/** A seeded generator, so a divergence can be replayed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Random legal positions reachable from the seeds, ≤7 pieces, no castling. */
function positions(count: number, seed: number): string[] {
  const random = rng(seed);
  const out = new Set<string>();
  let guard = 0;
  while (out.size < count && guard++ < count * 50) {
    const from = SEEDS[Math.floor(random() * SEEDS.length)]!;
    let pos = Chess.fromSetup(parseFen(from).unwrap()).unwrap();
    const plies = Math.floor(random() * 8);
    let dead = false;
    for (let i = 0; i < plies; i++) {
      const legal = [...pos.allDests()].flatMap(([f, to]) => [...to].map((t) => ({ from: f, to: t })));
      if (legal.length === 0 || pos.isEnd()) {
        dead = true;
        break;
      }
      pos.play(legal[Math.floor(random() * legal.length)]!);
    }
    // A finished position has nothing to compare: no moves, and both
    // sources report the terminal verdict by rule rather than by table.
    if (dead || pos.isEnd()) continue;
    out.add(makeFen(pos.toSetup()));
  }
  return [...out];
}

/** Ask the native prober, keeping one process for the whole run. */
function askNative(binary: string, tables: string, fens: string[]): Promise<Answer[]> {
  return new Promise((done, fail) => {
    const child = spawn(binary, ['tablebase', '--tables', tables], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const answers: Answer[] = [];
    let buffer = '';
    let ready = false;
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        if (!ready) {
          ready = true; // the handshake line
          continue;
        }
        answers.push(JSON.parse(line) as Answer);
        if (answers.length === fens.length) child.stdin.end();
      }
    });
    child.on('error', fail);
    child.on('close', () => done(answers));
    child.stdin.write(`${fens.join('\n')}\n`);
  });
}

async function askUpstream(fen: string): Promise<Answer> {
  const res = await fetch(`${UPSTREAM}?fen=${encodeURIComponent(fen)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`upstream answered ${res.status} for ${fen}`);
  return (await res.json()) as Answer;
}

const main = async (): Promise<void> => {
  const tables = resolve(arg('tables') ?? 'data/syzygy');
  const count = Number(arg('positions', '60'));
  const seed = Number(arg('seed', '1'));
  const binary = resolve(
    'native/target/release',
    process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core',
  );

  if (!existsSync(binary)) {
    console.error(`no native binary at ${binary} — run: npm run build:native`);
    process.exit(2);
  }
  if (!existsSync(tables)) {
    console.error(`no tables at ${tables} — pass --tables <dir>`);
    process.exit(2);
  }
  execFileSync(binary, ['capabilities'], { stdio: 'ignore' });

  const fens = positions(count, seed);
  console.log(`${fens.length} positions, seed ${seed}, tables ${tables}`);
  const ours = await askNative(binary, tables, fens);

  let checked = 0;
  let skipped = 0;
  const problems: string[] = [];
  for (const [i, fen] of fens.entries()) {
    const mine = ours[i];
    if (!mine) {
      problems.push(`${fen}\n  native returned nothing`);
      continue;
    }
    const theirs = await askUpstream(fen);
    await new Promise((r) => setTimeout(r, PACE));

    // A position past OUR tables (a 3-4-5 set asked about six pieces) is
    // not a disagreement — it is a smaller set of tables, which is the
    // normal case for anyone self-hosting.
    if (mine.category === 'unknown') {
      skipped += 1;
      continue;
    }
    checked += 1;

    if (mine.category !== theirs.category) {
      problems.push(`${fen}\n  position: ours ${mine.category}, theirs ${theirs.category}`);
      continue;
    }
    const byUci = new Map(theirs.moves.map((m) => [m.uci, m.category]));
    for (const move of mine.moves) {
      const other = byUci.get(move.uci);
      if (other !== undefined && other !== move.category) {
        problems.push(`${fen}\n  ${move.uci}: ours ${move.category}, theirs ${other}`);
      }
    }
    if (mine.moves.length !== theirs.moves.length) {
      problems.push(
        `${fen}\n  move count: ours ${mine.moves.length}, theirs ${theirs.moves.length}`,
      );
    }
  }

  console.log(`compared ${checked}, skipped ${skipped} past our tables`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} disagreement(s):`);
    for (const problem of problems) console.error(problem);
    process.exit(1);
  }
  console.log('every verdict agrees');
};

void main();
