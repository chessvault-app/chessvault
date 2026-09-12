import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineNetsApi, type NetStatus } from './engineNets.ts';

/** Made-up weights, named the way Stockfish names a net: after their own sha256. */
const BODY = Buffer.from('weights, allegedly '.repeat(1000));
const NAME = `nn-${createHash('sha256').update(BODY).digest('hex').slice(0, 12)}.nnue`;
const matchingBody = (): Uint8Array => BODY;
const build = (dir: string, fetcher?: typeof fetch): Hono =>
  new Hono().route('/api', engineNetsApi({ dir, fetcher, nets: [{ name: NAME, size: BODY.byteLength }] }));

const respond = (body: Uint8Array | null, status = 200): typeof fetch =>
  async () =>
    new Response(body === null ? null : new Blob([body as BlobPart]), {
      status,
      headers: body ? { 'content-length': String(body.byteLength) } : {},
    });

const settle = async (app: Hono, tries = 50): Promise<NetStatus> => {
  for (let i = 0; i < tries; i++) {
    const { nets } = (await (await app.request('/api/engine/nets')).json()) as { nets: NetStatus[] };
    if (!nets[0]!.downloading) return nets[0]!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('download did not settle');
};

describe('engine networks api', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engine-nets-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists every known network, absent at first', async () => {
    const app = build(dir);
    const { nets } = (await (await app.request('/api/engine/nets')).json()) as { nets: NetStatus[] };
    expect(nets).toEqual([{ name: NAME, bytes: 0, ready: false, downloading: null, error: null }]);
  });

  it('downloads a network whose checksum matches its name, then serves it immutable', async () => {
    const body = matchingBody();
    const app = build(dir, respond(body));
    const started = await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(started.status).toBe(202);
    const done = await settle(app);
    expect(done).toMatchObject({ ready: true, bytes: body.byteLength, error: null });
    expect(readdirSync(dir)).toEqual([NAME]); // no .part left behind

    const file = await app.request(`/api/engine/nets/${NAME}/file`);
    expect(file.status).toBe(200);
    expect(file.headers.get('cache-control')).toContain('immutable');
    expect(file.headers.get('cache-control')).toContain('no-transform');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(body));

    // Asking again is answered with what is there, not a second fetch.
    expect((await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' })).status).toBe(200);
  });

  it('keeps nothing from a download whose bytes do not match the name', async () => {
    const app = build(dir, respond(Buffer.from("not the network")));
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    const done = await settle(app);
    expect(done.ready).toBe(false);
    expect(done.error).toContain('checksum mismatch');
    expect(readdirSync(dir)).toEqual([]);
    expect((await app.request(`/api/engine/nets/${NAME}/file`)).status).toBe(404);
  });

  it('stops writing once a download runs past its published size', async () => {
    // The upstream gzip-encodes and fetch inflates as it streams, so
    // Content-Length bounds nothing. A net server that answered with an
    // endless body would otherwise write until the disk filled: the
    // checksum below only ever catches a wrong net, and only after every
    // byte has landed.
    const app = build(dir, respond(Buffer.concat([BODY, Buffer.alloc(BODY.byteLength, 0x41)])));
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    const done = await settle(app);
    expect(done.ready).toBe(false);
    expect(done.error).toContain('longer than its published size');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports a server that answers badly, and lets the next attempt run', async () => {
    let calls = 0;
    const body = matchingBody();
    const fetcher: typeof fetch = async (...args) => {
      calls++;
      return calls === 1 ? new Response(null, { status: 503 }) : respond(body)(...args);
    };
    const app = build(dir, fetcher);
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect((await settle(app)).error).toContain('503');
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect((await settle(app)).ready).toBe(true);
  });

  it('removes a downloaded network, and refuses names it does not know', async () => {
    const body = matchingBody();
    const app = build(dir, respond(body));
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    await settle(app);
    const gone = await app.request(`/api/engine/nets/${NAME}`, { method: 'DELETE' });
    expect(((await gone.json()) as NetStatus).ready).toBe(false);
    expect(existsSync(join(dir, NAME))).toBe(false);

    expect((await app.request('/api/engine/nets/nn-000000000000.nnue', { method: 'POST' })).status).toBe(404);
    expect((await app.request('/api/engine/nets/../paths.ts/file')).status).toBe(404);
  });
});
