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
 *
 * AND ONE THING THE COMPILER DOES SILENTLY EVEN WHEN IT COMPILES. It does
 * not cache a value on which render later calls a method (a chessops
 * position, a Map, a Set): it takes the value for possibly mutated, its
 * scope cannot close before the JSX, and the value is recomputed on
 * every render, where a hand useMemo on the same expression IS preserved.
 * Seventy-five hand memos were retired on 2026-09-14 on the premise that
 * the compiler owned them, and fifteen files had to be restored once the
 * compiled output was read. So this also reads the compiled output: a
 * render-level `const x = f(...)` where f comes from the shared chess
 * core (@shared/*, chessops) and is not inside a cache slot is reported
 * and fails the check. Those are the calls that replay positions, walk
 * trees and parse PGN; a per-render one is a real cost (positionAt on
 * every engine tick was the case that started it). Wrap it in useMemo,
 * which the compiler preserves, or move the call where it belongs.
 */
import { transformSync } from '@babel/core';
import { parse } from '@babel/parser';
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

/**
 * The shared chess core's calls that replay, walk or parse: a position
 * rebuilt from the root, a line walked to its end, a PGN read. Never per
 * render. The core's lookups (getNode, moveSquares, moveNumberLabel) are
 * a map read or a string and are not listed.
 */
const COSTLY_CALLS = new Set([
  'positionAt',
  'legalDests',
  'pathTo',
  'mainlineFrom',
  'collectSubtree',
  'isOnMainline',
  'pgnToChapters',
  'chaptersToPgn',
  'treeToPgn',
  'gameToTree',
  'mainlineEndFen',
  'commentSpans',
]);
const costlyModule = (source: string): boolean => source.startsWith('@shared/');

// Babel's AST, typed loosely: this walks a handful of node kinds.
interface Node {
  type: string;
  [key: string]: unknown;
}

/**
 * Render-level calls into the chess core that the compiler left outside a
 * cache slot. A compiled component's body is a flat list: `const $ = _c(n)`,
 * then `let tN; if ($[i] !== dep) { tN = ...; $[i] = tN } else tN = $[i]`
 * for everything it caches, and plain statements for what it does not. So
 * a `const x = costly(...)` sitting directly in that list is a per-render
 * call, and that is what this returns, by name and compiled line.
 */
function uncachedCostlyCalls(compiledCode: string): string[] {
  const ast = parse(compiledCode, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const program = ast.program as unknown as { body: Node[] };
  const costly = new Set<string>();
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (!costlyModule((node.source as { value: string }).value)) continue;
    for (const spec of node.specifiers as Node[]) {
      const imported = (spec.imported as { name?: string } | undefined)?.name;
      if (imported && COSTLY_CALLS.has(imported)) costly.add((spec.local as { name: string }).name);
    }
  }
  if (costly.size === 0) return [];
  const found: string[] = [];
  const judge = (body: Node[]): void => {
    // A compiled function opens with `const $ = _c(n)`; anything else is
    // not a component or hook the compiler took, and is not judged here.
    const first = body[0];
    const init = first?.type === 'VariableDeclaration' ? ((first.declarations as Node[])[0]?.init as Node | undefined) : undefined;
    if (!init || init.type !== 'CallExpression' || (init.callee as { name?: string }).name !== '_c') return;
    for (const statement of body) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const decl of statement.declarations as Node[]) {
        const value = decl.init as Node | null | undefined;
        if (!value || value.type !== 'CallExpression') continue;
        const callee = value.callee as { type: string; name?: string };
        if (callee.type !== 'Identifier' || !callee.name || !costly.has(callee.name)) continue;
        const id = decl.id as { name?: string };
        const line = (statement.loc as { start: { line: number } } | null)?.start.line;
        found.push(`${id.name ?? '?'} = ${callee.name}(...) (compiled line ${line ?? '?'})`);
      }
    }
  };
  const walk = (node: Node): void => {
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      const body = node.body as Node;
      if (body.type === 'BlockStatement') judge(body.body as Node[]);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && 'type' in child) walk(child as Node);
      } else if (value && typeof value === 'object' && 'type' in (value as object)) {
        walk(value as Node);
      }
    }
  };
  walk(ast.program as unknown as Node);
  return found;
}

let compiled = 0;
let skipped = 0;
const failures: string[] = [];
const perRender: string[] = [];
const files = sources(SRC);
for (const file of files) {
  const events: CompilerEvent[] = [];
  const result = transformSync(readFileSync(file, 'utf8'), {
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
  if (result?.code && events.some((e) => e.kind === 'CompileSuccess')) {
    for (const call of uncachedCostlyCalls(result.code)) perRender.push(`${rel}: ${call}`);
  }
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

console.log(
  `react compiler: ${files.length} files, ${compiled} functions compiled, ${skipped} skipped by directive, ${failures.length} refused, ${perRender.length} chess-core calls left per render`,
);
if (failures.length > 0) {
  console.log('\nRefused (the compiler leaves these as written; fix the shape, see docs/deferred.md and the patterns in git log):');
  for (const f of failures) console.log(`  ${f}`);
}
if (perRender.length > 0) {
  console.log('\nCalled on every render (the compiler did not cache the value; wrap it in useMemo, which it preserves):');
  for (const f of perRender) console.log(`  ${f}`);
}
if (failures.length > 0 || perRender.length > 0) process.exit(1);
