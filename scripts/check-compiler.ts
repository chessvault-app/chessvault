/**
 * The React Compiler's census, as a gate.
 *
 *   npm run check:compiler          (part of `npm run verify`)
 *   VERBOSE=1 npm run check:compiler  lists every function it compiled
 *
 * Every component and hook under web/src compiles since 2026-09-14 (620
 * functions, none refused); the one deliberate opt-out is lib/lazyRoute's
 * Route, which says why in a 'use no memo'. That state was a day's work to
 * reach and nothing else holds it: a suppressed `react-hooks/exhaustive-deps`
 * rule, a ref read during render, a `finally`, a conditional inside a
 * `try` or a module variable read through an alias each make the compiler
 * decline a function SILENTLY (it runs as written, slower, beside compiled
 * neighbours), and typecheck, lint, the tests and the pixel grid all pass
 * over it. So this runs the compiler's own Babel plugin over every source
 * file, the way the build does, and fails on the first refusal, naming the
 * function and the statement. Seconds per run, no build needed.
 *
 * Skips are allowed only where the source asks for them ('use no memo');
 * the count of those is printed so a new one is noticed.
 */
import { transformSync } from '@babel/core';
import ReactCompiler from 'babel-plugin-react-compiler';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const SRC = join(REPO_ROOT, 'web', 'src');
const VERBOSE = process.env.VERBOSE === '1';

/** Every .ts/.tsx under web/src except the demo's in-page server and tests. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'demo') continue;
      sources(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

interface Loc {
  start: { line: number };
}
interface CompilerEvent {
  kind: string;
  fnLoc?: Loc | null;
  fnName?: string | null;
  reason?: string;
  detail?: {
    reason?: string;
    description?: string | null;
    loc?: Loc | null;
    details?: { loc?: Loc | null }[];
  };
}

const plugin = (ReactCompiler as unknown as { default?: unknown }).default ?? ReactCompiler;
let compiled = 0;
let skipped = 0;
const failures: string[] = [];
const files = sources(SRC);
for (const file of files) {
  const events: CompilerEvent[] = [];
  transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ['jsx', 'typescript'] },
    plugins: [
      [
        plugin,
        {
          compilationMode: 'infer',
          panicThreshold: 'none',
          logger: { logEvent: (_file: string | null, event: CompilerEvent) => events.push(event) },
        },
      ],
    ],
  });
  const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
  for (const event of events) {
    const fn = event.fnLoc ? `line ${event.fnLoc.start.line}` : 'unknown line';
    if (event.kind === 'CompileSuccess') {
      compiled++;
      if (VERBOSE) console.log(`  ok    ${rel} ${fn} ${event.fnName ?? ''}`);
    } else if (event.kind === 'CompileSkip') {
      skipped++;
      if (VERBOSE) console.log(`  skip  ${rel} ${fn} ${event.reason ?? ''}`);
    } else if (event.kind === 'CompileError') {
      const d = event.detail ?? {};
      const at = d.loc ?? d.details?.find((x) => x.loc)?.loc ?? null;
      failures.push(
        `${rel} (function at ${fn}${at ? `, at line ${at.start.line}` : ''}): ${d.reason ?? ''}${d.description ? ` — ${d.description}` : ''}`,
      );
    }
  }
}

console.log(`react compiler: ${files.length} files, ${compiled} functions compiled, ${skipped} skipped by directive, ${failures.length} refused`);
if (failures.length > 0) {
  console.log('\nRefused (the compiler leaves these as written; fix the shape, see docs/deferred.md and the patterns in git log):');
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
