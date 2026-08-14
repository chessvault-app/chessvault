/**
 * Is this the demo?
 *
 * One kind, decided at compile time: the static build (`__DEMO__`), where
 * the vault routes run in the page over an in-memory filesystem. Each
 * visitor gets their own vault, in their own tab, gone on reload — nothing
 * is shared with anybody. A normal build tree-shakes every demo branch
 * away.
 *
 * What this is FOR: a demo that quietly lacks things reads as a broken app.
 * Every feature the demo cannot offer should say it is the demo talking —
 * an explorer with no online side, settings that cannot save, a book that
 * ends. Naming the limit turns a fault into a boundary.
 */
export function isDemo(): boolean {
  return typeof __DEMO__ !== 'undefined' && __DEMO__;
}

