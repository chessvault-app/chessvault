/**
 * Is this the demo?
 *
 * Two ways it can be, and the app should not care which: the static build
 * (`__DEMO__`, decided at compile time, so a normal build tree-shakes every
 * demo branch away) and a server running with CHESS_DEMO=1, which announces
 * itself on /api/health.
 *
 * What this is FOR: a demo that quietly lacks things reads as a broken app.
 * Every feature the demo cannot offer should say it is the demo talking —
 * an explorer with no online side, settings that cannot save, a book that
 * ends. Naming the limit turns a fault into a boundary.
 */
const BUILT_AS_DEMO = typeof __DEMO__ !== 'undefined' && __DEMO__;

let serverSaysDemo = false;

export function isDemo(): boolean {
  return BUILT_AS_DEMO || serverSaysDemo;
}

/**
 * WHICH demo, because the two promise opposite things.
 *
 * 'static' — the published build. Each visitor has their own vault, in
 *   their own tab, gone on reload. Nothing is shared with anybody.
 * 'server' — a deployment running with CHESS_DEMO=1: one vault everyone
 *   edits, restored from the seed on a timer.
 *
 * Telling a visitor of the static demo that "everyone shares this vault" is
 * not a harmless simplification. It is the reverse of the truth, and it
 * warns them off typing into an app that is entirely their own.
 */
export function demoKind(): 'static' | 'server' | null {
  if (BUILT_AS_DEMO) return 'static';
  return serverSaysDemo ? 'server' : null;
}

/** Called once, with what /api/health reported. */
export function noteServerDemo(demo: boolean): void {
  serverSaysDemo = demo;
}

/** How deep the demo's curated opening book goes, in plies. */
export const DEMO_BOOK_PLIES = 16;
