/**
 * Stages the engine builds into `web/public/engine/`.
 *
 * They can't be bundled: both kinds of build resolve their `.wasm` (and
 * the Lichess build its pthread workers) at runtime relative to their own
 * URL, so each has to sit beside its siblings as plain static files. Run
 * automatically before `dev` and `build`.
 *
 * Two sources:
 *  - `@lichess-org/stockfish-web`: Stockfish 19 as an ES module, network
 *    NOT included. The network is fetched from the Stockfish project's
 *    own net server, once, and checked against the SHA-256 prefix its
 *    name carries. The small net is 1 MB; the official one, `--full`
 *    only, is 79 MB.
 *  - `stockfish` (nmrugg): Stockfish 18 with the network embedded, used
 *    only for the single-threaded fallback where the page cannot get a
 *    SharedArrayBuffer. 7 MB; the `--full` variant 113 MB.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const TARGET = resolve(REPO_ROOT, 'web/public/engine');
const NET_SERVER = 'https://tests.stockfishchess.org/api/nn/';

const LICHESS = resolve(REPO_ROOT, 'node_modules/@lichess-org/stockfish-web');
const CLASSIC = resolve(REPO_ROOT, 'node_modules/stockfish/bin');

/** Keep these in step with BUILDS in web/src/engine/StockfishEngine.ts. */
const LITE = {
  lichess: ['sf_dev_smallnet.js', 'sf_dev_smallnet.wasm'],
  nets: ['nn-61e7af4bb97d.nnue'],
  classic: ['stockfish-18-lite-single.js', 'stockfish-18-lite-single.wasm'],
};
const FULL = {
  lichess: ['sf_dev.js', 'sf_dev.wasm'],
  nets: ['nn-1a298aa575a0.nnue'],
  classic: ['stockfish-18-single.js', 'stockfish-18-single.wasm'],
};

const full = process.argv.includes('--full');
const sets = full ? [LITE, FULL] : [LITE];

for (const [source, name] of [
  [LICHESS, '@lichess-org/stockfish-web'],
  [CLASSIC, 'stockfish'],
] as const) {
  if (!existsSync(source)) {
    console.error(`${name} not found at ${source} — run \`npm install\` first.`);
    process.exit(1);
  }
}

mkdirSync(TARGET, { recursive: true });

let copied = 0;
let skipped = 0;
let bytes = 0;

function stage(from: string, name: string): void {
  const to = resolve(TARGET, name);
  if (!existsSync(from)) {
    console.warn(`  missing in package, skipping: ${name}`);
    return;
  }
  const size = statSync(from).size;
  // Skip unchanged files so `npm run dev` doesn't recopy megabytes every start.
  if (existsSync(to) && statSync(to).size === size) {
    skipped++;
    return;
  }
  copyFileSync(from, to);
  copied++;
  bytes += size;
}

/** The name IS the checksum: `nn-<first 12 hex of sha256>.nnue`. */
const checksumOk = (name: string, data: Uint8Array): boolean =>
  createHash('sha256').update(data).digest('hex').startsWith(name.slice(3, 15));

async function fetchNet(name: string): Promise<void> {
  const to = resolve(TARGET, name);
  if (existsSync(to) && checksumOk(name, readFileSync(to))) {
    skipped++;
    return;
  }
  const res = await fetch(NET_SERVER + name);
  if (!res.ok) throw new Error(`${res.status} fetching ${NET_SERVER}${name}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (!checksumOk(name, data)) throw new Error(`checksum mismatch for ${name}`);
  writeFileSync(to, data);
  copied++;
  bytes += data.byteLength;
}

for (const set of sets) {
  for (const name of set.lichess) stage(resolve(LICHESS, name), name);
  for (const name of set.classic) stage(resolve(CLASSIC, name), name);
  for (const name of set.nets) await fetchNet(name);
}

const mb = (n: number): string => `${(n / 1e6).toFixed(1)} MB`;
console.log(
  `  engine: ${copied} copied (${mb(bytes)}), ${skipped} already current -> web/public/engine/`,
);

/**
 * pdf.js image decoders, same static-sibling story as the engine: the worker
 * resolves `${wasmUrl}<codec>` at runtime, so the files must be served as-is.
 * npm's pdfjs-dist ships NO .wasm binaries — only the JS fallback decoders —
 * which is why PdfImport passes `useWasm: false`. Without these, JBIG2/JPX
 * scans (most scanned books) silently render as smears.
 */
const PDFJS_SOURCE = resolve(REPO_ROOT, 'node_modules/pdfjs-dist/wasm');
const PDFJS_TARGET = resolve(REPO_ROOT, 'web/public/pdfjs-wasm');
const DECODERS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js', 'quickjs-eval.js'];

mkdirSync(PDFJS_TARGET, { recursive: true });
let pdfjsCopied = 0;
for (const name of DECODERS) {
  const from = resolve(PDFJS_SOURCE, name);
  const to = resolve(PDFJS_TARGET, name);
  if (!existsSync(from)) {
    console.warn(`  missing in pdfjs-dist, skipping: ${name}`);
    continue;
  }
  if (existsSync(to) && statSync(to).size === statSync(from).size) continue;
  copyFileSync(from, to);
  pdfjsCopied++;
}
console.log(`  pdfjs: ${pdfjsCopied} decoder(s) copied -> web/public/pdfjs-wasm/`);
