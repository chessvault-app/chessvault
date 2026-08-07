/**
 * Copies the Stockfish 18 WASM builds into `web/public/engine/`.
 *
 * They can't be bundled: the Emscripten loader resolves its `.wasm` sibling at
 * runtime relative to the worker's own URL, so the pair has to sit together as
 * plain static files. Run automatically before `dev` and `build`.
 *
 * Only the "lite" flavours are copied by default — 7 MB each, versus 113 MB for
 * the full build. Pass `--full` to add the large ones.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const SOURCE = resolve(REPO_ROOT, 'node_modules/stockfish/bin');
const TARGET = resolve(REPO_ROOT, 'web/public/engine');

/** Lite is multi-threaded; lite-single is the fallback without SharedArrayBuffer. */
const LITE = [
  'stockfish-18-lite.js',
  'stockfish-18-lite.wasm',
  'stockfish-18-lite-single.js',
  'stockfish-18-lite-single.wasm',
];

const FULL = [
  'stockfish-18.js',
  'stockfish-18.wasm',
  'stockfish-18-single.js',
  'stockfish-18-single.wasm',
];

const wanted = process.argv.includes('--full') ? [...LITE, ...FULL] : LITE;

if (!existsSync(SOURCE)) {
  console.error(`Stockfish not found at ${SOURCE} — run \`npm install\` first.`);
  process.exit(1);
}

mkdirSync(TARGET, { recursive: true });

let copied = 0;
let skipped = 0;
let bytes = 0;

for (const name of wanted) {
  const from = resolve(SOURCE, name);
  const to = resolve(TARGET, name);
  if (!existsSync(from)) {
    console.warn(`  missing in package, skipping: ${name}`);
    continue;
  }
  const size = statSync(from).size;
  // Skip unchanged files so `npm run dev` doesn't recopy 14 MB every start.
  if (existsSync(to) && statSync(to).size === size) {
    skipped++;
    continue;
  }
  copyFileSync(from, to);
  copied++;
  bytes += size;
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
