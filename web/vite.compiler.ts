import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import type { Plugin, PluginOption } from 'vite';

/**
 * The React Compiler, as a build step both configs share.
 *
 * The compiler memoises at build time what the app memoised by hand: 139
 * useMemo, 113 useCallback and 8 memo() across 60 files, and the rows
 * that redraw on a keystroke or a map layout are exactly where a missed
 * one shows. It runs through Babel: @vitejs/plugin-react 6 transforms
 * with oxc and carries no Babel of its own, so @rolldown/plugin-babel
 * runs the compiler's plugin beside it, and the plugin-react preset
 * brings the compiler's filter (component and hook files only).
 * plugin-react's own `compiler: true` is a Rust port the plugin still
 * calls experimental; the Babel plugin is the 1.0 the React team ships.
 *
 * Adopted file by file, not all at once (SOURCES below): a component that
 * breaks the Rules of React is skipped silently, not broken, and the
 * only way to know is to count. CHESS_COMPILER_LOG=1 prints, at the end
 * of a build, every file the compiler looked at with what it did to each
 * function: compiled, skipped and why, or failed and where. The build
 * still fails on nothing the compiler finds, since a skipped component
 * runs exactly as it did before.
 */

/**
 * Every component file under web/src. It started 2026-09-14 as a list of
 * five (the densest in hand memoisation), then eleven (the lists a search
 * field narrows), each joining once its refusals were fixed and the
 * change measured; with 129 of 176 files compiling clean as they stood,
 * the list stopped earning its keep, and a refused component costs
 * nothing (it is skipped, not broken; the log below names it). The
 * census of what is still refused, and why, is `CHESS_COMPILER_LOG=1`.
 */
const norm = (p: string): string => p.replace(/\\/g, '/');

export function reactCompiler(srcRoot: string): PluginOption[] {
  // CHESS_COMPILER=0 builds without it, which is how the two are compared
  // (build time, bundle size, a keystroke's cost), the way CHESS_NATIVE=0
  // runs the JS path beside the native core.
  if (process.env.CHESS_COMPILER === '0') return [];
  const src = norm(srcRoot).replace(/\/?$/, '/');
  const log = process.env.CHESS_COMPILER_LOG === '1';
  const tally = new Map<string, { ok: number; skip: string[]; fail: string[] }>();
  const preset = reactCompilerPreset({
    compilationMode: 'infer',
    // The in-page demo server (web/src/demo) is server code run in the
    // browser, not components; the compiler has nothing to do there.
    sources: (filename: string) => {
      const f = norm(filename);
      return f.startsWith(src) && !f.startsWith(`${src}demo/`);
    },
    logger: log
      ? {
          logEvent(filename, event) {
            if (!filename) return;
            const file = norm(filename).replace(src, '');
            const row = tally.get(file) ?? { ok: 0, skip: [], fail: [] };
            const at = (loc: { start: { line: number } } | null): string => (loc ? `line ${loc.start.line}` : 'unknown line');
            if (event.kind === 'CompileSuccess') row.ok++;
            else if (event.kind === 'CompileSkip') row.skip.push(`${at(event.fnLoc)}: ${event.reason}`);
            else if (event.kind === 'CompileError') {
              // The function's line, then the offending statement's, which
              // is the one worth reading when the function is 900 lines.
              const d = event.detail as {
                reason?: string;
                description?: string | null;
                loc?: { start: { line: number } } | null;
                details?: { loc?: { start: { line: number } } | null }[];
              };
              const where = d.loc ?? d.details?.find((x) => x.loc)?.loc ?? null;
              row.fail.push(
                `${at(event.fnLoc)}${where ? `, at ${at(where)}` : ''}: ${d.reason ?? ''}${d.description ? `, ${d.description}` : ''}`,
              );
            } else return;
            tally.set(file, row);
          },
        }
      : null,
  });
  const report: Plugin = {
    name: 'react-compiler-report',
    closeBundle() {
      if (!log) return;
      const rows = [...tally].sort(([a], [b]) => a.localeCompare(b));
      let ok = 0, skip = 0, fail = 0;
      for (const [file, r] of rows) {
        ok += r.ok; skip += r.skip.length; fail += r.fail.length;
        console.log(`react-compiler: ${file}: ${r.ok} compiled${r.skip.length ? `, ${r.skip.length} skipped` : ''}${r.fail.length ? `, ${r.fail.length} failed` : ''}`);
        for (const s of r.skip) console.log(`  skipped ${s}`);
        for (const f of r.fail) console.log(`  failed  ${f}`);
      }
      console.log(`react-compiler: ${rows.length} files, ${ok} functions compiled, ${skip} skipped, ${fail} failed`);
    },
  };
  return [babel({ presets: [preset] }), report];
}
