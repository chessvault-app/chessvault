// Import the 1001 book's puzzles into the vault.
//
// Tier one is this file's own: book-parsed, where the position, the side
// and the solution were all verified by replaying the book's printed line
// (autoimport-measure's output).
//
// Every tier below that — engine-corroborated, engine-only,
// engine-unverified — is shared/bookEngine.ts's decision, not this
// script's. That module exists so the browser import and this pipeline
// answer identically, with the engine as a parameter; this file's job is
// to hand it a Stockfish it spawned itself. Do not re-derive a tier here.
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
import { bookDirFor } from '../../server/puzzlebooks.ts';
import {
  engineTier,
  fullFen,
  overlap,
  positionOf,
  type EngineLine,
  type EngineSearch,
} from '../../shared/bookEngine.ts';
import { parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';

const REPO = resolve(import.meta.dirname, '..', '..');
// --book <config> is required, mirroring autoimport-measure: the title
// and report path are book facts, and book facts are data, not code.
const bookAt = process.argv.indexOf('--book');
if (bookAt < 0 || !process.argv[bookAt + 1]) {
  throw new Error('--book <scripts/ml/books/*.json> is required — book facts are data, not code');
}
const CFG = JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as {
  title: string;
  report: string;
};
// A book's folder is an id, not its title, so it is looked up rather
// than built — by the same function the app uses, because a second
// answer to "where does this book live" is a second copy of the book.
const BOOK = bookDirFor(CFG.title, resolve(REPO, 'vault', 'puzzlebooks'));
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

/**
 * The bar a repair candidate must clear to be worth considering.
 *
 * Deliberately NOT bookEngine's DECISIVE_CP. That one asks "is this line
 * good enough to be the answer"; this asks "is this board reading the real
 * one", and the filtering there is done by uniqueness — exactly one
 * candidate may pass — plus the overlap with the squares the book printed.
 * A candidate scoring +1.5 is already saying something about the reading.
 *
 * It is lower than 250 because it was written before bookEngine existed
 * and has never been re-examined against it; it is preserved rather than
 * unified because raising it would change which repairs settle, and
 * nothing has been measured that says it should.
 */
const REPAIR_CP = 150;

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
   *  so the UI highlights exactly where this puzzle came from. solutionPage
   *  is stamped later by enrich_solution_pages.py — this step only carries
   *  an existing stamp across (see the vault-write section). */
  evidence: { page: string; rect: { x: number; y: number; w: number; h: number }; solutionPage?: string };
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

  /**
   * The spawned Stockfish as shared/bookEngine's EngineSearch.
   *
   * That module takes the engine as a parameter precisely so this pipeline
   * and the browser can run one tiering rule; this is the whole of what it
   * needs from us. Still memoized, so the cache keeps working. No bestmove
   * means the engine had no answer, which is the null the tiers expect.
   */
  const searchFor =
    (engine: Engine): EngineSearch =>
    async (fen: string, moveMs: number): Promise<EngineLine | null> => {
      const r = await search(engine, fen, `movetime ${moveMs}`);
      return r.bestmove ? { cp: r.cp, mate: r.mate, pv: r.pv } : null;
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
      fen: string,
      line: { uci: string[]; san: string[] },
      wildcards: number[],
    ): void => {
      counts[provenance]++;
      puzzles.push({
        id: `n${entry.number}`,
        fen,
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
          !!result.bestmove &&
          ((result.mate !== null && result.mate > 0) ||
            (result.cp !== null && result.cp >= REPAIR_CP));
        const corroborated =
          (entry.squares?.length ?? 0) < 2 || overlap(result.pv.slice(0, 6), entry.squares!) >= 0.5;
        if (decisiveCand && corroborated) passing.push(cand);
      }
      if (passing.length === 1) {
        const line = lineFromSans(fullFen(passing[0]!.fen, passing[0]!.side), passing[0]!.sans);
        if (line) {
          entry.fen = passing[0]!.fen;
          settledAmbiguous++;
          push('book-parsed', fullFen(passing[0]!.fen, passing[0]!.side), line, []);
          return;
        }
      }
    }

    // Tier 1: the book's own line already replayed.
    if (entry.status === 'validated') {
      const line = lineFromSans(fullFen(entry.fen!, entry.side!), entry.sans!);
      if (line) {
        push('book-parsed', fullFen(entry.fen!, entry.side!), line, []);
        return;
      }
    }
    if (!entry.fen || entry.status === 'illegal-position') {
      leftovers.push(entry);
      counts.draft++;
      return;
    }

    /**
     * Engine tiers: shared/bookEngine.ts's decision, on this script's
     * Stockfish.
     *
     * This block used to re-derive the whole thing — its own trySide, its
     * own decisive/margin thresholds, its own unverified fallback — and it
     * had drifted from the module that was extracted to own it: the
     * fallback searched the SAME position a second time for the SAME budget
     * to get a line the first search had already returned, which
     * bookEngine.ts removed deliberately. A book imported here and in the
     * app could be tiered differently, silently, while the docs said the
     * two ran one rule.
     */
    const solved = await engineTier(
      {
        number: entry.number,
        placement: entry.fen,
        ...(entry.side ? { side: entry.side } : {}),
        squares: entry.squares ?? [],
        ...(entry.mateIn ? { mateIn: entry.mateIn } : {}),
      },
      searchFor(engine),
    );
    if (!solved) {
      leftovers.push(entry);
      counts.draft++;
      return;
    }
    push(solved.provenance, solved.fen, { uci: solved.uci, san: solved.san }, solved.wildcards ?? []);
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
  // The solutions-chapter enrichment (enrich_solution_pages.py) lives in the
  // very files this section rebuilds: puzzles/drafts carry the stamp, the
  // diagrams dir holds the rendered solution pages. Carry both across, or
  // every re-import silently kills the Solutions pane (it did, once).
  const oldSolutionPage = new Map<number, string>();
  for (const file of ['puzzles.json', 'drafts.json']) {
    const path = resolve(BOOK, file);
    if (!existsSync(path)) continue;
    const old = JSON.parse(readFileSync(path, 'utf-8')) as {
      number?: number;
      evidence?: { solutionPage?: string };
    }[];
    for (const p of old) {
      if (p.number != null && p.evidence?.solutionPage) {
        oldSolutionPage.set(p.number, p.evidence.solutionPage);
      }
    }
  }

  const diagrams = resolve(BOOK, 'diagrams');
  const stashedPages = new Map<string, Buffer>();
  for (const img of new Set(oldSolutionPage.values())) {
    const path = resolve(diagrams, img);
    if (existsSync(path)) stashedPages.set(img, readFileSync(path));
  }
  rmSync(diagrams, { recursive: true, force: true });
  mkdirSync(diagrams, { recursive: true });
  for (const [img, bytes] of stashedPages) writeFileSync(resolve(diagrams, img), bytes);

  for (const p of puzzles) {
    const sp = oldSolutionPage.get(p.number);
    if (sp) p.evidence.solutionPage = sp;
  }

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
      ...(oldSolutionPage.has(entry.number)
        ? { solutionPage: oldSolutionPage.get(entry.number) }
        : {}),
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
