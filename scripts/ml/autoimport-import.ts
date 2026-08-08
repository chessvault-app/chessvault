// Import the 1001 book's puzzles into the vault, three fidelity tiers:
//
//   book-parsed          position + side + solution all verified by replaying
//                        the book's own line (autoimport-measure output)
//   engine-corroborated  Stockfish solves from the read position; the squares
//                        the book's entry mentions overlap the engine line —
//                        the text corroborates the POSITION even though its
//                        movetext was unparseable
//   engine-only          Stockfish alone (lanph3re's accepted fallback): legal
//                        position, decisive line, no text to corroborate
//
// Anything left (illegal position, nothing decisive) becomes a draft with the
// CNN's read prefilled. Every imported puzzle carries evidence images: its
// aligned board crop AND the full source page.
//
// Inputs: data/ml/autoimport-report.json (+ read cache), the --emit dir of
// board/page grays from autoimport-measure, and Node-spawned Stockfish.
// Usage: npx tsx scripts/ml/autoimport-import.ts <emit_dir>
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';

const REPO = resolve(import.meta.dirname, '..', '..');
// --book <config> mirrors autoimport-measure; defaults = the 1001 book.
const bookAt = process.argv.indexOf('--book');
const CFG = {
  title: '1001 Chess Exercises for Beginners',
  report: 'data/ml/autoimport-report.json',
  ...(bookAt > 0
    ? (JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as object)
    : {}),
};
const BOOK = resolve(REPO, 'vault', 'puzzlebooks', CFG.title);
const emitDirArg = process.argv[2];
if (!emitDirArg) throw new Error('usage: autoimport-import <emit_dir>');
const emitDir: string = emitDirArg;

interface ReportEntry {
  number: number;
  page: number;
  fen?: string;
  uncertain?: number;
  side?: 'w' | 'b';
  sans?: string[];
  status: string;
  mateIn?: number;
  squares?: string[];
  rect?: { x: number; y: number; w: number; h: number };
  repairCandidates?: { fen: string; side: 'w' | 'b'; sans: string[]; edits: number }[];
}

const report = JSON.parse(
  readFileSync(resolve(REPO, CFG.report), 'utf-8'),
) as ReportEntry[];

// --- engine -------------------------------------------------------------------

interface EngineResult {
  bestmove: string | null;
  mate: number | null;
  cp: number | null;
  pv: string[];
}

class Engine {
  private proc: ChildProcess;
  private buffer = '';
  private resolvers: ((line: string) => boolean)[] = [];

  constructor() {
    this.proc = spawn(
      process.execPath,
      [resolve(REPO, 'node_modules', 'stockfish', 'bin', 'stockfish-18-lite-single.js')],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    this.proc.stdout!.on('data', (d: Buffer) => {
      this.buffer += d.toString();
      let at;
      while ((at = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, at).trim();
        this.buffer = this.buffer.slice(at + 1);
        this.resolvers = this.resolvers.filter((r) => !r(line));
      }
    });
  }

  private send(cmd: string): void {
    this.proc.stdin!.write(`${cmd}\n`);
  }

  private waitFor(pred: (line: string) => boolean): Promise<string> {
    return new Promise((res) => {
      this.resolvers.push((line) => {
        if (!pred(line)) return false;
        res(line);
        return true;
      });
    });
  }

  async init(): Promise<void> {
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.send('setoption name Hash value 64');
  }

  /**
   * Search a position; go until bestmove, remembering the last info line.
   * NEVER issue `go mate N` here — Stockfish searches FOREVER when no mate
   * exists (this hung a whole import run). Callers pass movetime and read
   * the mate score from the info lines instead. A watchdog `stop` guards
   * against any other stall.
   */
  async search(fen: string, go: string): Promise<EngineResult> {
    let mate: number | null = null;
    let cp: number | null = null;
    let pv: string[] = [];
    const onInfo = (line: string): boolean => {
      if (line.startsWith('info') && line.includes(' pv ')) {
        const m = /score (cp|mate) (-?\d+)/.exec(line);
        if (m) {
          mate = m[1] === 'mate' ? Number(m[2]) : null;
          cp = m[1] === 'cp' ? Number(m[2]) : null;
        }
        pv = line.slice(line.indexOf(' pv ') + 4).trim().split(/\s+/);
      }
      return false; // keep listening until bestmove
    };
    this.resolvers.push(onInfo);
    this.send(`position fen ${fen}`);
    this.send(`go ${go}`);
    const watchdog = setTimeout(() => this.send('stop'), 15_000);
    const best = await this.waitFor((l) => l.startsWith('bestmove'));
    clearTimeout(watchdog);
    this.resolvers = this.resolvers.filter((r) => r !== onInfo);
    const bestmove = best.split(/\s+/)[1] ?? null;
    return { bestmove: bestmove === '(none)' ? null : bestmove, mate, cp, pv };
  }

  quit(): void {
    this.send('quit');
    this.proc.kill();
  }
}

// --- helpers ------------------------------------------------------------------

function castlingRights(placement: string): string {
  const expand = (rank: string): string[] => {
    const out: string[] = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') out.push(...Array(Number(ch)).fill(''));
      else out.push(ch);
    }
    return out;
  };
  const ranks = placement.split('/');
  const r1 = expand(ranks[7]!);
  const r8 = expand(ranks[0]!);
  let rights = '';
  if (r1[4] === 'K' && r1[7] === 'R') rights += 'K';
  if (r1[4] === 'K' && r1[0] === 'R') rights += 'Q';
  if (r8[4] === 'k' && r8[7] === 'r') rights += 'k';
  if (r8[4] === 'k' && r8[0] === 'r') rights += 'q';
  return rights || '-';
}

function fullFen(placement: string, side: 'w' | 'b'): string {
  return `${placement} ${side} ${castlingRights(placement)} - 0 1`;
}

function positionOf(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.unwrap());
  return pos.isErr ? null : pos.unwrap();
}

/** SAN mainline -> uci+san arrays via replay (report stores SAN only). */
function lineFromSans(fen: string, sans: string[]): { uci: string[]; san: string[] } | null {
  const pos = positionOf(fen);
  if (!pos) return null;
  const uci: string[] = [];
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) return null;
    uci.push(makeUci(move));
    pos.play(move);
  }
  return { uci, san: sans };
}

/** UCI pv -> san line, trimmed to `plies`, stopping cleanly at mate. */
function lineFromPv(fen: string, pv: string[], plies: number): { uci: string[]; san: string[] } | null {
  const pos = positionOf(fen);
  if (!pos) return null;
  const uci: string[] = [];
  const san: string[] = [];
  for (const u of pv.slice(0, plies)) {
    const move = parseUciMove(u);
    if (!move || !pos.isLegal(move)) break;
    san.push(makeSanAndPlay(pos, move));
    uci.push(u);
    if (pos.isCheckmate()) break;
  }
  return uci.length > 0 ? { uci, san } : null;
}

function parseUciMove(u: string): { from: number; to: number; promotion?: 'queen' | 'rook' | 'bishop' | 'knight' } | null {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) return null;
  const sq = (s: string): number => (s.charCodeAt(0) - 97) + (s.charCodeAt(1) - 49) * 8;
  const promos = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' } as const;
  return {
    from: sq(u.slice(0, 2)),
    to: sq(u.slice(2, 4)),
    promotion: u[4] ? promos[u[4] as keyof typeof promos] : undefined,
  };
}

/** Defender plies (odd indices) become wildcards for forced-mate lines. */
function defenderWildcards(count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < count - 1; i += 2) out.push(i);
  return out;
}

const overlap = (line: string[], squares: string[]): number => {
  const dests = new Set(line.map((u) => u.slice(2, 4)));
  let hit = 0;
  for (const d of dests) if (squares.includes(d)) hit++;
  return dests.size === 0 ? 0 : hit / dests.size;
};

// --- main ---------------------------------------------------------------------

interface ImportedPuzzle {
  id: string;
  fen: string;
  uci: string[];
  san: string[];
  wildcards?: number[];
  added: string;
  number: number;
  /** Section goal (e.g. 2 = "Mate in two") when the page header names one. */
  mateIn?: number;
  /** engine-unverified = legal position + side, but the engine found
   *  nothing DECISIVE — lanph3re's import-everything tier; badge + evidence
   *  make opportunistic review cheap. */
  provenance: 'book-parsed' | 'engine-corroborated' | 'engine-only' | 'engine-unverified';
  /** One source-page image; rect = the diagram's bounds as page fractions,
   *  so the UI highlights exactly where this puzzle came from. */
  evidence: { page: string; rect: { x: number; y: number; w: number; h: number } };
}

async function main(): Promise<void> {
  // --jobs N runs a pool of N engines over the entry list; every search
  // is memoized to <report>-engine-cache.json so re-imports skip the
  // engine entirely for unchanged positions.
  const poolAt = process.argv.indexOf('--jobs');
  const poolN = poolAt > 0 ? Math.max(1, Number(process.argv[poolAt + 1])) : 1;
  const engines: Engine[] = [];
  for (let i = 0; i < poolN; i++) {
    const e = new Engine();
    await e.init();
    engines.push(e);
  }
  const engineCachePath = resolve(REPO, CFG.report.replace(/[.]json$/, '-engine-cache.json'));
  const engineCache: Record<string, EngineResult> = existsSync(engineCachePath)
    ? (JSON.parse(readFileSync(engineCachePath, 'utf-8')) as Record<string, EngineResult>)
    : {};
  const search = async (engine: Engine, fen: string, arg: string): Promise<EngineResult> => {
    const key = `${fen}|${arg}`;
    const hit = engineCache[key];
    if (hit) return hit;
    const result = await engine.search(fen, arg);
    engineCache[key] = result;
    return result;
  };

  const puzzles: ImportedPuzzle[] = [];
  const leftovers: ReportEntry[] = [];
  const counts = {
    'book-parsed': 0,
    'engine-corroborated': 0,
    'engine-only': 0,
    'engine-unverified': 0,
    draft: 0,
  };
  const now = new Date().toISOString();
  let settledAmbiguous = 0;

  let processed = 0;
  const processEntry = async (entry: ReportEntry, engine: Engine): Promise<void> => {
    processed++;
    if (processed % 100 === 0) console.log(`${processed}/${report.length}…`);
    const evidence = {
      page: `page${String(entry.page).padStart(3, '0')}.jpg`,
      rect: entry.rect ?? { x: 0, y: 0, w: 1, h: 1 },
    };
    const push = (
      provenance: ImportedPuzzle['provenance'],
      side: 'w' | 'b',
      line: { uci: string[]; san: string[] },
      wildcards: number[],
    ): void => {
      counts[provenance]++;
      puzzles.push({
        id: `n${entry.number}`,
        fen: fullFen(entry.fen!, side),
        uci: line.uci,
        san: line.san,
        ...(wildcards.length > 0 ? { wildcards } : {}),
        added: now,
        number: entry.number,
        provenance,
        evidence,
        ...(entry.mateIn ? { mateIn: entry.mateIn } : {}),
      });
    };

    // Tie-broken repairs: several board readings replayed the book's
    // line; the engine settles which position is REAL — a decisive line
    // overlapping the squares the book's entry mentions. Exactly one
    // winner imports as a book solution (line replayed + engine agreed);
    // anything else falls through to the normal tiers.
    if (entry.status === 'replay-failed' && entry.repairCandidates?.length) {
      const passing: { fen: string; side: 'w' | 'b'; sans: string[] }[] = [];
      for (const cand of entry.repairCandidates) {
        const fen = fullFen(cand.fen, cand.side);
        if (!positionOf(fen)) continue;
        const result = await search(engine, fen, 'movetime 500');
        const decisiveCand =
          !!result.bestmove && ((result.mate !== null && result.mate > 0) || (result.cp !== null && result.cp >= 150));
        const corroborated =
          (entry.squares?.length ?? 0) < 2 || overlap(result.pv.slice(0, 6), entry.squares!) >= 0.5;
        if (decisiveCand && corroborated) passing.push(cand);
      }
      if (passing.length === 1) {
        const line = lineFromSans(fullFen(passing[0]!.fen, passing[0]!.side), passing[0]!.sans);
        if (line) {
          entry.fen = passing[0]!.fen;
          settledAmbiguous++;
          push('book-parsed', passing[0]!.side, line, []);
          return;
        }
      }
    }

    // Tier 1: the book's own line already replayed.
    if (entry.status === 'validated') {
      const line = lineFromSans(fullFen(entry.fen!, entry.side!), entry.sans!);
      if (line) {
        push('book-parsed', entry.side!, line, []);
        return;
      }
    }
    if (!entry.fen || entry.status === 'illegal-position') {
      leftovers.push(entry);
      counts.draft++;
      return;
    }

    // Engine tiers. Side: from the text when parsed; otherwise inferred by
    // unique decisiveness.
    const trySide = async (side: 'w' | 'b'): Promise<EngineResult & { side: 'w' | 'b' } | null> => {
      const fen = fullFen(entry.fen!, side);
      if (!positionOf(fen)) return null;
      const goal = entry.mateIn ?? 0;
      // Fixed-time search; the mate score (if any) arrives in the info
      // lines. Mate-in-N is trivial for the engine inside this budget.
      const result = await search(engine, fen, `movetime ${goal > 0 ? 800 : 500}`);
      if (!result.bestmove) return null;
      return { ...result, side };
    };

    const decisive = (r: EngineResult | null): boolean =>
      !!r && ((r.mate !== null && r.mate > 0) || (r.cp !== null && r.cp >= 250));

    let solved: (EngineResult & { side: 'w' | 'b' }) | null = null;
    if (entry.side) {
      const r = await trySide(entry.side);
      if (decisive(r)) solved = r;
    } else {
      const w = await trySide('w');
      const b = await trySide('b');
      const wOk = decisive(w);
      const bOk = decisive(b);
      if (wOk && !bOk) solved = w;
      else if (bOk && !wOk) solved = b;
      else if (wOk && bOk) {
        const margin = (r: EngineResult): number => (r.mate !== null ? 100000 - r.mate : r.cp!);
        if (Math.abs(margin(w!) - margin(b!)) >= 300) solved = margin(w!) > margin(b!) ? w : b;
      }
    }

    // Import-everything tier: no decisive line, but the position is legal
    // and the text told us the side — take the engine's best line anyway,
    // clearly badged. (Without a side there is nothing sane to import.)
    if (!solved && entry.side) {
      const fen = fullFen(entry.fen, entry.side);
      if (positionOf(fen)) {
        const best = await search(engine, fen, 'movetime 500');
        const line = best.pv.length > 0 ? lineFromPv(fen, best.pv, 6) : null;
        if (line) {
          push('engine-unverified', entry.side, line, []);
          return;
        }
      }
    }
    if (!solved) {
      leftovers.push(entry);
      counts.draft++;
      return;
    }
    const isMate = solved.mate !== null && solved.mate > 0;
    const plies = isMate ? solved.mate! * 2 - 1 : Math.min(solved.pv.length, 6);
    const line = lineFromPv(fullFen(entry.fen, solved.side), solved.pv, Math.max(plies, 1));
    if (!line) {
      leftovers.push(entry);
      counts.draft++;
      return;
    }
    const corroborated =
      (entry.squares?.length ?? 0) >= 2 && overlap(line.uci, entry.squares!) >= 0.5;
    push(
      corroborated ? 'engine-corroborated' : 'engine-only',
      solved.side,
      line,
      isMate ? defenderWildcards(line.uci.length) : [],
    );
  };

  const queue = report.sort((a, b) => a.number - b.number);
  let cursor = 0;
  await Promise.all(
    engines.map(async (engine) => {
      for (;;) {
        const entry = queue[cursor++];
        if (!entry) return;
        await processEntry(entry, engine);
      }
    }),
  );
  // Concurrency scrambles completion order; the vault files stay sorted.
  puzzles.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  leftovers.sort((a, b) => a.number - b.number);
  writeFileSync(engineCachePath, JSON.stringify(engineCache));
  for (const e of engines) e.quit();

  // --- write the vault book ---------------------------------------------------
  const diagrams = resolve(BOOK, 'diagrams');
  rmSync(diagrams, { recursive: true, force: true });
  mkdirSync(diagrams, { recursive: true });

  // First import of a new book: the server only lists books that have a
  // book.json — create one, but never overwrite lanph3re's own edits.
  if (!existsSync(resolve(BOOK, 'book.json'))) {
    mkdirSync(BOOK, { recursive: true });
    writeFileSync(
      resolve(BOOK, 'book.json'),
      `${JSON.stringify({ title: CFG.title, createdAt: now }, null, 1)}\n`,
    );
  }
  writeFileSync(resolve(BOOK, 'puzzles.json'), `${JSON.stringify(puzzles, null, 1)}\n`);
  const drafts = leftovers.map((entry) => ({
    id: `d${entry.number}`,
    image: `n${entry.number}.jpg`,
    fen: entry.fen ? fullFen(entry.fen, entry.side ?? 'w') : null,
    added: now,
    number: entry.number,
    evidence: {
      page: `page${String(entry.page).padStart(3, '0')}.jpg`,
      rect: entry.rect ?? { x: 0, y: 0, w: 1, h: 1 },
    },
  }));
  writeFileSync(resolve(BOOK, 'drafts.json'), `${JSON.stringify(drafts, null, 1)}\n`);

  // Manifest for the python step that converts emitted grays to jpegs:
  // one page image per source page, board crops only for leftover drafts.
  const wanted = new Set<string>();
  for (const p of puzzles) wanted.add(p.evidence.page.replace('.jpg', ''));
  for (const d of leftovers) {
    wanted.add(`n${d.number}`);
    wanted.add(`page${String(d.page).padStart(3, '0')}`);
  }
  writeFileSync(
    resolve(REPO, 'data', 'ml', 'evidence-manifest.json'),
    JSON.stringify({ emitDir, target: diagrams, names: [...wanted] }),
  );

  console.log('\n=== import complete ===');
  console.log(`book-parsed:         ${counts['book-parsed']} (${settledAmbiguous} ambiguity settled by engine)`);
  console.log(`engine-corroborated: ${counts['engine-corroborated']}`);
  console.log(`engine-only:         ${counts['engine-only']}`);
  console.log(`engine-unverified:   ${counts['engine-unverified']}`);
  console.log(`drafts (leftover):   ${counts.draft}`);
  console.log(`total imported:      ${puzzles.length}`);
  const available = readdirSync(emitDir).length;
  console.log(`evidence grays available: ${available} (jpeg conversion is the next step)`);
}

void main();
