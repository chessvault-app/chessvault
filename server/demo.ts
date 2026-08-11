import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MiddlewareHandler } from 'hono';
import { VAULT, REPO_ROOT } from './paths.ts';

/**
 * Public demo mode.
 *
 * One shared vault that anybody may edit and that resets itself, so a
 * visitor can try every editing flow — rename, annotate, delete, import a
 * PGN — without a password and without being able to leave the next
 * visitor a ruined app.
 *
 * The threat model is not a determined attacker with an exploit; it is the
 * internet finding an unauthenticated write endpoint. Two things follow:
 * storage must be bounded no matter what is posted, and the surface must
 * be an ALLOWLIST. Enumerating what to block is how a demo ends up serving
 * a token endpoint nobody remembered — every new route would have to be
 * considered against a list that lives somewhere else. Here a route that
 * nobody has thought about is closed.
 */

export const DEMO = process.env.CHESS_DEMO === '1';

/** Where the pristine copy lives. Never written to. */
const SEED = process.env.CHESS_DEMO_SEED ?? resolve(REPO_ROOT, 'demo-seed');

/** Vault subdirectories the demo owns: wiped and restored on reset. */
const MANAGED = ['studies', 'notes', 'games', 'puzzles'] as const;

/** Total bytes the demo vault may occupy before it is reset. */
const MAX_BYTES = Number(process.env.CHESS_DEMO_MAX_BYTES ?? 64 * 1024 * 1024);

/** Entries one directory may hold. Stops a loop that creates studies. */
const MAX_ENTRIES = Number(process.env.CHESS_DEMO_MAX_ENTRIES ?? 400);

/** How often the vault goes back to the seed regardless of what happened. */
const RESET_MS = Number(process.env.CHESS_DEMO_RESET_MINUTES ?? 60) * 60_000;

/**
 * The only routes a demo visitor may change anything through. Matched
 * against `<METHOD> <path>` with `:id` standing for one path segment and
 * `*` for the rest.
 *
 * Deliberately absent, and each for its own reason:
 *  - /puzzlebooks/*  — book puzzles come from commercial PDFs and are not
 *    ours to hand out. Blocked for READS too, below; the demo ships none.
 *  - /settings/*     — password, 2FA and the Lichess token live there.
 *  - /books/build    — minutes of CPU and an unbounded index, per request.
 *  - /lichess/studies/import — pulls an arbitrary remote study into the
 *    vault using OUR token: an open import proxy.
 */
const WRITABLE: string[] = [
  'POST /api/studies',
  'PUT /api/studies/*',
  'DELETE /api/studies/*',
  'POST /api/studies/folders',
  'POST /api/studies/move',
  'POST /api/studies/folders/move',
  'DELETE /api/studies/folders/*',
  'POST /api/notes',
  'PUT /api/notes/*',
  'DELETE /api/notes/*',
  'POST /api/notes/folders',
  'POST /api/notes/move',
  'POST /api/notes/folders/move',
  'DELETE /api/notes/folders/*',
  'POST /api/games/docs',
  'PUT /api/games/docs/*',
  'DELETE /api/games/docs/*',
  'POST /api/games/docs/folders',
  'POST /api/games/docs/move',
  'POST /api/games/docs/folders/move',
  'DELETE /api/games/docs/folders/*',
  'POST /api/games/collect-pgn',
  'POST /api/games/bookmarks/toggle',
  'POST /api/puzzles/attempt',
  'POST /api/puzzles/reset',
];

/**
 * Whole surfaces closed to READS as well.
 *
 * /api/lichess is not about storage. The explorer proxy attaches the
 * DEPLOYMENT'S Lichess token to every upstream call, so on a public demo a
 * stranger's query is made as the owner's account from the owner's server:
 * their rate limit spent by anybody who finds the URL, and an
 * unauthenticated endpoint turned into an outbound amplifier. The demo has
 * local opening books and the reference-game database, which is what the
 * explorer is for anyway.
 */
const UNREADABLE = ['/api/puzzlebooks', '/api/lichess'];

function matches(pattern: string, method: string, path: string): boolean {
  const [wantMethod, wantPath] = pattern.split(' ') as [string, string];
  if (wantMethod !== method) return false;
  if (wantPath.endsWith('/*')) return path.startsWith(wantPath.slice(0, -1));
  return path === wantPath;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Bytes under a directory, following nothing and counting files only. */
function sizeOf(dir: string): number {
  let total = 0;
  const walk = (at: string): void => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          // Raced with a delete; it is not in the vault any more either.
        }
      }
    }
  };
  walk(dir);
  return total;
}

function tooMany(dir: string): boolean {
  try {
    return readdirSync(dir).length > MAX_ENTRIES;
  } catch {
    return false;
  }
}

/**
 * Put the managed directories back to the seed.
 *
 * Each is built beside its target and renamed into place, so a reader that
 * arrives mid-reset sees the old directory or the new one, never a
 * half-copied one.
 */
export function resetDemoVault(): void {
  if (!DEMO) return;
  for (const name of MANAGED) {
    const target = resolve(VAULT, name);
    const staging = `${target}.new`;
    rmSync(staging, { recursive: true, force: true });
    const source = resolve(SEED, name);
    if (existsSync(source)) cpSync(source, staging, { recursive: true });
    else mkdirSync(staging, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    renameSync(staging, target);
  }
  lastReset = Date.now();
}

let lastReset = Date.now();

/** Reset when the clock says so, or when the vault has grown too big. */
function resetIfDue(): void {
  if (Date.now() - lastReset > RESET_MS || sizeOf(VAULT) > MAX_BYTES) resetDemoVault();
}

/**
 * A crude per-address write budget.
 *
 * Not a security boundary — an attacker has more addresses than we have
 * memory — but it is what turns "a script fills the disk in a second" into
 * "a script fills it slower than the reset empties it", which is the whole
 * job. The window is fixed rather than sliding because a demo does not
 * need the precision and a sliding window needs per-request storage.
 */
const WRITE_LIMIT = Number(process.env.CHESS_DEMO_WRITES_PER_MINUTE ?? 60);
let windowStart = Date.now();
let writes = new Map<string, number>();

function overBudget(who: string): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    writes = new Map();
  }
  const used = (writes.get(who) ?? 0) + 1;
  writes.set(who, used);
  return used > WRITE_LIMIT;
}

export function demoGuard(): MiddlewareHandler {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method;

    if (UNREADABLE.some((prefix) => path.startsWith(prefix))) {
      return c.json({ error: 'not available in the demo' }, 404);
    }

    if (!MUTATING.has(method)) return next();

    if (!WRITABLE.some((pattern) => matches(pattern, method, path))) {
      return c.json({ error: 'the demo is read-only here' }, 403);
    }

    const who =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? 'anon';
    if (overBudget(who)) {
      return c.json({ error: 'too many changes at once — try again in a minute' }, 429);
    }

    // Size is checked BEFORE the write, so the cap is what the vault may
    // reach rather than what it may be left at.
    if (sizeOf(VAULT) > MAX_BYTES) {
      resetDemoVault();
      return c.json({ error: 'the demo vault was full and has been reset' }, 507);
    }
    for (const name of MANAGED) {
      if (tooMany(resolve(VAULT, name))) {
        return c.json({ error: 'the demo has enough of those already' }, 507);
      }
    }

    return next();
  };
}

/** Start the reset timer. Safe to call when the demo is off; does nothing. */
export function startDemoResets(): void {
  if (!DEMO) return;
  if (!existsSync(SEED)) {
    console.warn(`demo: no seed at ${SEED} — the vault will not be restored`);
    return;
  }
  resetDemoVault();
  // unref: a demo server should still exit on a signal rather than being
  // held open by its own housekeeping.
  setInterval(resetIfDue, 60_000).unref();
  console.log(
    `demo: shared vault, reset every ${RESET_MS / 60_000} min or at ${Math.round(MAX_BYTES / 1024 / 1024)} MB`,
  );
}
