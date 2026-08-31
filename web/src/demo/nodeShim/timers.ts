/**
 * `setImmediate`, which the browser has not got.
 *
 * The vault's index walks its files a slice at a time and reschedules the
 * remainder with `setImmediate` (`server/myGames.ts`), so that lookups keep
 * being answered in between. In the page that identifier is undefined: the
 * first walk threw `ReferenceError` after one 50 ms slice, and — because the
 * throw happened AFTER the walker had set its `walking` flag — no later sync
 * ever scheduled another. The index froze wherever that slice ended, at 9 of
 * the demo's 30 games, and the explorer went on reporting confidently on a
 * third of the vault. Nothing said so; the count is just a smaller number.
 *
 * Installed as a global by `demo/server.ts` for the same reason `Buffer` is:
 * the routes reference it free rather than importing it, which no alias can
 * intercept.
 */

/**
 * `setTimeout(…, 0)`, NOT `queueMicrotask`.
 *
 * The point of the reschedule is to give the page its turn back — a fetch
 * has to be answerable between two slices of the walk. A microtask runs
 * before the browser does anything at all, so a walk that rescheduled
 * itself that way would spin the tab for the whole index instead of
 * yielding, which is the opposite of what the call means.
 */
export function installSetImmediate(): void {
  const target = globalThis as typeof globalThis & { setImmediate?: unknown };
  // Cast through `unknown` the way the Buffer shim does: this is the call
  // signature the routes use, not Node's whole `setImmediate` down to its
  // `__promisify__`, and pretending otherwise would only be a claim the
  // shim cannot keep.
  target.setImmediate ??= ((fn: (...args: unknown[]) => void, ...args: unknown[]) =>
    setTimeout(() => fn(...args), 0)) as unknown as typeof setImmediate;
}
