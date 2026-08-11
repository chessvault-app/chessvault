import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

/**
 * The demo guard is the whole security boundary of a public deployment, so
 * it is tested for what it REFUSES, not for what it allows. A regression
 * here does not break a feature — it silently opens a write endpoint to
 * the internet.
 *
 * demo.ts reads its configuration at import time, so each test imports it
 * fresh with the environment already set.
 */

let vault: string;
let seed: string;

async function loadDemo() {
  vi.resetModules();
  process.env.CHESS_DEMO = '1';
  process.env.CHESS_VAULT_DIR = vault;
  process.env.CHESS_DEMO_SEED = seed;
  return import('./demo.ts');
}

beforeEach(() => {
  vault = mkdtempSync(resolve(tmpdir(), 'demo-vault-'));
  seed = mkdtempSync(resolve(tmpdir(), 'demo-seed-'));
  mkdirSync(resolve(seed, 'studies'), { recursive: true });
  writeFileSync(resolve(seed, 'studies', 'Example.pgn'), '[Event "Example"]\n\n*\n');
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
  rmSync(seed, { recursive: true, force: true });
  delete process.env.CHESS_DEMO;
  delete process.env.CHESS_VAULT_DIR;
  delete process.env.CHESS_DEMO_SEED;
});

/** Drive the middleware directly: it is a pure function of method + path. */
async function ask(method: string, path: string): Promise<number> {
  const { demoGuard } = await loadDemo();
  const { Hono } = await import('hono');
  const app = new Hono();
  app.use('/api/*', demoGuard());
  app.all('/api/*', (c) => c.json({ ok: true }));
  const res = await app.request(`http://localhost${path}`, { method });
  return res.status;
}

describe('demo guard', () => {
  it('allows the editing flows a visitor is there to try', async () => {
    for (const [method, path] of [
      ['POST', '/api/studies'],
      ['PUT', '/api/studies/My%20Study'],
      ['DELETE', '/api/studies/My%20Study'],
      ['POST', '/api/notes'],
      ['PUT', '/api/notes/A%20Note'],
      ['POST', '/api/games/docs'],
      ['POST', '/api/games/collect-pgn'],
      ['POST', '/api/puzzles/attempt'],
    ] as const) {
      expect(await ask(method, path), `${method} ${path}`).toBe(200);
    }
  });

  it('refuses every write that is not on the list', async () => {
    for (const [method, path] of [
      // Secrets.
      ['POST', '/api/settings/password'],
      ['POST', '/api/settings/2fa/enable'],
      ['PUT', '/api/settings/lichess'],
      ['PUT', '/api/settings/profile'],
      // Minutes of CPU per request.
      ['POST', '/api/books/build'],
      // An open import proxy using our token.
      ['POST', '/api/lichess/studies/import'],
      // Book puzzles are not ours to hand out.
      ['POST', '/api/puzzlebooks'],
      ['POST', '/api/puzzlebooks/slug/puzzles'],
      // A route nobody has thought about yet.
      ['POST', '/api/something-added-later'],
      ['DELETE', '/api/vault'],
    ] as const) {
      const status = await ask(method, path);
      expect([403, 404], `${method} ${path} was ${status}`).toContain(status);
    }
  });

  it('hides book puzzles from reads as well as writes', async () => {
    expect(await ask('GET', '/api/puzzlebooks')).toBe(404);
    expect(await ask('GET', '/api/puzzlebooks/some-book')).toBe(404);
  });

  it("never lets a stranger spend the deployment's Lichess token", async () => {
    // The proxy authenticates upstream as the owner, so an open demo would
    // hand out their rate limit and their IP.
    expect(await ask('GET', '/api/lichess/explorer')).toBe(404);
    expect(await ask('GET', '/api/lichess/studies/someone')).toBe(404);
    expect(await ask('POST', '/api/lichess/studies/import')).toBe(404);
  });

  it('leaves ordinary reads alone', async () => {
    for (const path of ['/api/studies', '/api/games', '/api/puzzles/next', '/api/settings']) {
      expect(await ask('GET', path), path).toBe(200);
    }
  });

  it('restores the vault from the seed, replacing whatever is there', async () => {
    const { resetDemoVault } = await loadDemo();
    mkdirSync(resolve(vault, 'studies'), { recursive: true });
    writeFileSync(resolve(vault, 'studies', 'Vandalised.pgn'), 'junk');
    rmSync(resolve(vault, 'studies', 'Example.pgn'), { force: true });

    resetDemoVault();

    expect(existsSync(resolve(vault, 'studies', 'Vandalised.pgn'))).toBe(false);
    expect(readFileSync(resolve(vault, 'studies', 'Example.pgn'), 'utf-8')).toContain('Example');
  });

  it('resets rather than growing when the vault is over its size cap', async () => {
    process.env.CHESS_DEMO_MAX_BYTES = '1024';
    const { demoGuard, DEMO } = await loadDemo();
    expect(DEMO).toBe(true);
    mkdirSync(resolve(vault, 'studies'), { recursive: true });
    writeFileSync(resolve(vault, 'studies', 'Huge.pgn'), 'x'.repeat(4096));

    const { Hono } = await import('hono');
    const app = new Hono();
    app.use('/api/*', demoGuard());
    app.all('/api/*', (c) => c.json({ ok: true }));
    const res = await app.request('http://localhost/api/studies', { method: 'POST' });

    expect(res.status).toBe(507);
    // And the oversized file is gone, not merely refused.
    expect(existsSync(resolve(vault, 'studies', 'Huge.pgn'))).toBe(false);
    delete process.env.CHESS_DEMO_MAX_BYTES;
  });

  it('is entirely inert when the demo is off', async () => {
    vi.resetModules();
    delete process.env.CHESS_DEMO;
    const { DEMO, resetDemoVault } = await import('./demo.ts');
    expect(DEMO).toBe(false);
    // A reset outside demo mode must not touch anybody's real vault.
    mkdirSync(resolve(vault, 'studies'), { recursive: true });
    writeFileSync(resolve(vault, 'studies', 'Real.pgn'), 'precious');
    resetDemoVault();
    expect(readFileSync(resolve(vault, 'studies', 'Real.pgn'), 'utf-8')).toBe('precious');
  });
});
