/**
 * Build opening books from PGN files.
 *
 *   npm run build:book                          all vault/sources/*.pgn, one book per file
 *   npm run build:book -- elite-*.pgn --name elite    merge files into one book
 *   flags: --name --max-ply 24 --min-games 2 --top-games 3
 *
 * Books land in data/books/<name>.sqlite. Sources may be absolute paths,
 * cwd-relative, or names of files in vault/sources/.
 */
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DATA_BOOKS, VAULT_SOURCES } from '../server/paths.ts';
import { buildBook } from './lib/book-builder.ts';

const { values, positionals } = parseArgs({
  options: {
    name: { type: 'string' },
    'max-ply': { type: 'string' },
    'min-games': { type: 'string' },
    'top-games': { type: 'string' },
  },
  allowPositionals: true,
});

function resolveSource(arg: string): string {
  for (const candidate of [
    isAbsolute(arg) ? arg : resolve(process.cwd(), arg),
    resolve(VAULT_SOURCES, arg),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  console.error(`source not found: ${arg} (looked in cwd and vault/sources)`);
  process.exit(1);
}

const sources = positionals.map(resolveSource);

// With no sources given, index everything in vault/sources, one book each.
const jobs: { name: string; sources: string[] }[] = [];
if (sources.length === 0) {
  const all = readdirSync(VAULT_SOURCES)
    .filter((f) => f.toLowerCase().endsWith('.pgn'))
    .map((f) => resolve(VAULT_SOURCES, f));
  if (all.length === 0) {
    console.error(`no .pgn files in ${VAULT_SOURCES} — drop PGN collections there first`);
    process.exit(1);
  }
  for (const file of all) jobs.push({ name: basename(file, '.pgn'), sources: [file] });
} else {
  jobs.push({
    name: values.name ?? (sources.length === 1 ? basename(sources[0]!, '.pgn') : 'book'),
    sources,
  });
}

const numberFlag = (raw: string | undefined, label: string): number | undefined => {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error(`--${label} must be a non-negative integer, got ${raw}`);
    process.exit(1);
  }
  return n;
};

mkdirSync(DATA_BOOKS, { recursive: true });

for (const job of jobs) {
  const out = resolve(DATA_BOOKS, `${job.name}.sqlite`);
  // Build beside the target and rename over it, so a server holding the old
  // book open never reads a half-written file during a rebuild.
  const building = `${out}.building`;
  console.log(`\nbook "${job.name}" ← ${job.sources.map((s) => basename(s)).join(', ')}`);
  let result;
  try {
    result = await buildBook({
      ...job,
      out: building,
      maxPly: numberFlag(values['max-ply'], 'max-ply'),
      minGames: numberFlag(values['min-games'], 'min-games'),
      topGames: numberFlag(values['top-games'], 'top-games'),
      onProgress: (p) => {
        const rate = Math.round(p.games / p.seconds);
        console.log(`  ${p.games.toLocaleString()} games  (${rate.toLocaleString()}/s, ${p.parseErrors} errors)`);
      },
    });
    try {
      renameSync(building, out);
    } catch (error) {
      // Windows: a server holding the old book open blocks the rename
      // (EPERM). Leave the .building file — the server that spawned this
      // build closes its handle and finishes the swap itself.
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      console.log('  rename deferred (target busy) — server will swap the file in');
    }
  } catch (error) {
    rmSync(building, { force: true });
    throw error;
  }
  console.log(
    `  done: ${result.games.toLocaleString()} games → ${result.positions.toLocaleString()} positions / ` +
    `${result.rows.toLocaleString()} rows, ${(result.bytes / 1e6).toFixed(1)} MB in ${result.seconds.toFixed(1)}s` +
    (result.skipped ? ` (${result.skipped.toLocaleString()} skipped)` : '') +
    (result.parseErrors ? ` (${result.parseErrors} parse errors)` : ''),
  );
}
