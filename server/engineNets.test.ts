import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createHash, pbkdf2 } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { downloadNet, engineNetsApi, type NetStatus } from './engineNets.ts';

/**
 * Faults for the .part's writes and its close, standing in for a disk that
 * fills mid-download and a close that reports a failed flush: neither can
 * be made to happen to a real file on demand. A write stream opened under
 * these tests makes the real calls until a test sets a fault.
 */
const faults = vi.hoisted(() => ({
  /** Writes that have landed on disk. */
  writes: 0,
  /** Fail every write once this many have landed. */
  failWritesAfter: null as number | null,
  failClose: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  type Done = (error: Error | null, ...rest: unknown[]) => void;
  const fault = (code: string, message: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: ${message}`), { code });
  const io = {
    open: fs.open,
    write: (...args: unknown[]): void => {
      const done = args.pop() as Done;
      if (faults.failWritesAfter !== null && faults.writes >= faults.failWritesAfter) {
        process.nextTick(done, fault('ENOSPC', 'no space left on device, write'));
        return;
      }
      (fs.write as (...a: unknown[]) => void)(...args, (error: Error | null, ...rest: unknown[]) => {
        if (!error) faults.writes++;
        done(error, ...rest);
      });
    },
    close: (fd: number, done: (error: Error | null) => void): void =>
      fs.close(fd, (error) => done(error ?? (faults.failClose ? fault('EIO', 'i/o error, close') : null))),
  };
  return {
    ...fs,
    createWriteStream: (path: string, options?: object) => fs.createWriteStream(path, { ...options, fs: io }),
  };
});

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

/**
 * A body that sends `chunks` and then hangs, as a connection that stops
 * sending does, and records whether the download let go of it. Chunk `i`
 * is sent once `ready(i)` resolves.
 */
const stalling = (
  chunks: Uint8Array[],
  ready: (i: number) => Promise<void> = async () => {},
): { fetcher: typeof fetch; reader: { cancelled: boolean } } => {
  const reader = { cancelled: false };
  let sent = 0;
  const fetcher: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull: async (controller): Promise<void> => {
          const i = sent++;
          if (i >= chunks.length) return new Promise<void>(() => {});
          await ready(i);
          controller.enqueue(chunks[i]!);
        },
        cancel: () => {
          reader.cancelled = true;
        },
      }),
    );
  return { fetcher, reader };
};

/** `work`, failed if still running after `ms`: a download that hangs fails here, not at vitest's timeout. */
const within = async <T>(work: Promise<T>, ms = 1000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`still running after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
};

describe('engine networks api', () => {
  let dir: string;
  // An 'error' event nothing listens for is thrown from the event loop, and
  // in the server that ends the process. Collected here, so the test it
  // happens in fails by name.
  let uncaught: unknown[] = [];
  const collect = (error: unknown): void => {
    uncaught.push(error);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'engine-nets-'));
    uncaught = [];
    process.on('uncaughtException', collect);
    Object.assign(faults, { writes: 0, failWritesAfter: null, failClose: false });
  });
  afterEach(() => {
    process.off('uncaughtException', collect);
    rmSync(dir, { recursive: true, force: true });
  });

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
    // The overrun comes on the first chunk, which can arrive before the
    // .part has been opened when the threadpool is busy, as under load:
    // a removal then is undone by the open. Holding every thread makes
    // that the case each run, and the pause gives a late open time to
    // land where the listing below would see it.
    const threads = Number(process.env.UV_THREADPOOL_SIZE) || 4;
    const held = Promise.all(Array.from({ length: threads }, () => promisify(pbkdf2)('x', 'y', 50_000, 32, 'sha512')));
    const app = build(dir, respond(Buffer.concat([BODY, Buffer.alloc(BODY.byteLength, 0x41)])));
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    await held;
    const done = await settle(app);
    await new Promise((r) => setTimeout(r, 50));
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

  it('reports a networks folder removed before the first chunk, and lets the next attempt run', async () => {
    const stalled = stalling([BODY.subarray(0, 4096)]);
    let calls = 0;
    const fetcher: typeof fetch = async (...args) => {
      calls++;
      if (calls > 1) return respond(BODY)(...args);
      rmSync(dir, { recursive: true }); // so the .part cannot be opened
      return stalled.fetcher(...args);
    };
    const app = build(dir, fetcher);
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(await settle(app)).toMatchObject({ ready: false, downloading: null, error: expect.stringContaining('ENOENT') });
    expect(stalled.reader.cancelled).toBe(true);
    expect(uncaught).toEqual([]);

    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(await settle(app)).toMatchObject({ ready: true, error: null });
    expect(readdirSync(dir)).toEqual([NAME]);
  });

  it('rejects a download whose .part cannot be opened, and lets go of the response', async () => {
    // The staging script's path: downloadNet on its own, into a folder whose
    // parent is a file.
    writeFileSync(join(dir, 'blocker'), '');
    const stalled = stalling([BODY.subarray(0, 4096)]);
    await expect(within(downloadNet(NAME, join(dir, 'blocker', NAME), stalled.fetcher))).rejects.toThrow(/ENOTDIR|ENOENT/);
    expect(stalled.reader.cancelled).toBe(true);
    expect(readdirSync(dir)).toEqual(['blocker']);
    expect(uncaught).toEqual([]);
  });

  it('reports a write that fails mid-download, and keeps nothing', async () => {
    faults.failWritesAfter = 1;
    const half = BODY.byteLength / 2;
    // Each chunk waits for the one before it to land, or the stream hands
    // the two to the .part as one write and the disk is full from the start.
    const landed = async (i: number): Promise<void> => {
      for (let t = 0; faults.writes < i && t < 200; t++) await new Promise((r) => setTimeout(r, 5));
    };
    const stalled = stalling([BODY.subarray(0, half), BODY.subarray(half)], landed);
    const app = build(dir, stalled.fetcher);
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(await settle(app)).toMatchObject({ ready: false, downloading: null, error: expect.stringContaining('ENOSPC') });
    expect(faults.writes).toBe(1); // the first chunk had landed
    expect(stalled.reader.cancelled).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(uncaught).toEqual([]);
  });

  it('reports a .part whose close fails after the last byte, and keeps nothing', async () => {
    faults.failClose = true;
    const app = build(dir, respond(matchingBody()));
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(await settle(app)).toMatchObject({ ready: false, downloading: null, error: expect.stringContaining('EIO') });
    expect(readdirSync(dir)).toEqual([]);
    expect(uncaught).toEqual([]);
  });

  it('reports a networks folder that cannot be made, and lets the next attempt run', async () => {
    const blocked = join(dir, 'nets');
    writeFileSync(blocked, ''); // a file where the folder would go
    const app = build(blocked, respond(matchingBody()));
    expect((await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' })).status).toBe(202);
    expect(await settle(app)).toMatchObject({ ready: false, downloading: null, error: expect.stringMatching(/EEXIST|ENOTDIR/) });

    rmSync(blocked);
    await app.request(`/api/engine/nets/${NAME}`, { method: 'POST' });
    expect(await settle(app)).toMatchObject({ ready: true, error: null });
  });
});
