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
 *
 * AND A COPY IT FOLDS AWAY. The compiler takes any variable declared
 * outside the component (a module `let`, a factory's) for a constant, so
 * inside a component or hook it compiles, and inside every callback and
 * effect in it, `const left = lastBoard` is folded back into `lastBoard`
 * at each use: a write to the variable between the copy and the use, or
 * a call or an await that writes it, now reaches the use, where the
 * source plainly reads the old value. It compiles, nothing warns, the
 * tests run the source uncompiled, and the Board's restore offer never
 * fired in 0.11.0 to 0.11.4 because of it (lib/router.ts met it
 * earlier, as every Back measuring as a turn to the same page). So a
 * compiled function that copies a variable it does not own, and that
 * something reassigns, fails the check by line. Measured forms it folds:
 * `const x = v`, `const x = v!` and `x = v` into a local; forms it keeps:
 * `v as T`, and anything computed (`v ?? d`, `v || w`, a destructure).
 * Take the value through a function call (AnalysisView's takeLastBoard),
 * or compute what you need from it before the write (the router).
 */
import { transformSync, traverse, type NodePath } from '@babel/core';
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
  start: { line: number; index?: number };
  end?: { line: number; index?: number };
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

/**
 * Copies the compiler folds back into the variable they copy (see the
 * header), by source line.
 *
 * `compiledFns` is where each function the compiler took sits in the
 * source. A copy counts when its target is a local of that function and
 * what it copies is declared outside it and reassigned somewhere; a
 * variable nothing reassigns is a constant, and folding it changes
 * nothing. Read from the source rather than the output, because the copy
 * is what has to be named and the output has already lost it.
 */
function foldedCopies(code: string, compiledFns: { start: number; end: number }[]): string[] {
  if (compiledFns.length === 0) return [];
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  const found: string[] = [];
  traverse(ast, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;
      // `v!` folds exactly like `v`; `v as T` compiles to a cast, which
      // the compiler keeps, so it is not unwrapped.
      let read: NodePath = path;
      while (read.parentPath?.isTSNonNullExpression()) read = read.parentPath;
      const parent = read.parentPath;
      let target: NodePath | null = null;
      if (parent?.isVariableDeclarator() && read.key === 'init') target = parent.get('id');
      else if (parent?.isAssignmentExpression({ operator: '=' }) && read.key === 'right') target = parent.get('left');
      if (!target?.isIdentifier()) return;
      const at = path.node.start ?? -1;
      const fn = compiledFns.find((f) => at >= f.start && at < f.end);
      if (!fn) return;
      const inside = (pos: number | null | undefined): boolean => pos != null && pos >= fn.start && pos < fn.end;
      const copied = path.scope.getBinding(path.node.name);
      if (!copied || copied.constantViolations.length === 0 || inside(copied.identifier.start)) return;
      // A store into another outside variable (the router's
      // `arrivedByNavigate = pendingNavigate`) reads the value there and
      // then; only a local carries the stale name forward.
      const local = target.scope.getBinding(target.node.name);
      if (!local || !inside(local.identifier.start)) return;
      found.push(`line ${path.node.loc?.start.line ?? '?'}: \`${target.node.name}\` copies \`${path.node.name}\``);
    },
  });
  return found;
}

let compiled = 0;
let skipped = 0;
const failures: string[] = [];
const perRender: string[] = [];
const folded: string[] = [];
const files = sources(SRC);
for (const file of files) {
  const events: CompilerEvent[] = [];
  const code = readFileSync(file, 'utf8');
  const result = transformSync(code, {
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
  const compiledFns = events.flatMap((e) =>
    e.kind === 'CompileSuccess' && e.fnLoc?.start.index != null && e.fnLoc.end?.index != null
      ? [{ start: e.fnLoc.start.index, end: e.fnLoc.end.index }]
      : [],
  );
  for (const copy of foldedCopies(code, compiledFns)) folded.push(`${rel} ${copy}`);
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
  `react compiler: ${files.length} files, ${compiled} functions compiled, ${skipped} skipped by directive, ${failures.length} refused, ${perRender.length} chess-core calls left per render, ${folded.length} ${folded.length === 1 ? 'copy' : 'copies'} folded`,
);
if (failures.length > 0) {
  console.log('\nRefused (the compiler leaves these as written; fix the shape, see docs/deferred.md and the patterns in git log):');
  for (const f of failures) console.log(`  ${f}`);
}
if (perRender.length > 0) {
  console.log('\nCalled on every render (the compiler did not cache the value; wrap it in useMemo, which it preserves):');
  for (const f of perRender) console.log(`  ${f}`);
}
if (folded.length > 0) {
  console.log(
    '\nCopied out of a variable the compiler takes for a constant (it folds the copy back into the variable, so a write in between reaches it; take the value through a function call, see the header):',
  );
  for (const f of folded) console.log(`  ${f}`);
}
if (failures.length > 0 || perRender.length > 0 || folded.length > 0) process.exit(1);
