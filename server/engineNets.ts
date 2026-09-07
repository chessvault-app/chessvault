/**
 * The engine's optional networks, kept on the server.
 *
 * The browser engine ships with Stockfish's small network (1 MB, staged
 * into web/public/engine by setup-engine). Its full network is 99 MB,
 * which no build should carry for the people who never ask for it, and
 * the browser cannot fetch it itself: the net server answers without
 * CORS headers, and the app's page is cross-origin isolated besides. So
 * the server fetches it once, on request, into `data/engine-nets/`, and
 * serves it from there to the engine worker as a same-origin file.
 *
 * The name IS the checksum (`nn-<first 12 hex of sha256>.nnue`), which is
 * how the file is verified after the download and why it can be served
 * as immutable. Only the names listed in NETS are ever fetched: the
 * route is not a proxy.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { DATA } from './paths.ts';

export const NET_SERVER = 'https://tests.stockfishchess.org/api/nn/';

/**
 * The networks the engine knows how to ask for, by file name, with the
 * size each one is once decoded. The net server answers a GET with the
 * file gzip-encoded (78.9 MB on the wire for 98.5 MB of weights) and
 * fetch inflates it as it streams, so its Content-Length is not the
 * total the bytes count towards; this is.
 */
export const NETS: readonly { name: string; size: number }[] = [{ name: 'nn-1a298aa575a0.nnue', size: 98_511_183 }];

export const DATA_ENGINE_NETS = resolve(DATA, 'engine-nets');

/** `nn-<12 hex>.nnue` names its own sha256 prefix. */
export const checksumOk = (name: string, data: Uint8Array): boolean =>
  createHash('sha256').update(data).digest('hex').startsWith(name.slice(3, 15));

export interface NetProgress {
  bytes: number;
  total: number;
}

/**
 * Fetch one network to `path`, verified, atomically.
 *
 * Streams to `<path>.part` so a crash leaves nothing that looks complete,
 * then checks the whole file against the name and renames it in. The
 * script that stages the small net at build time uses this too, so the
 * two never disagree about what a good file is.
 */
export async function downloadNet(
  name: string,
  path: string,
  fetcher: typeof fetch = fetch,
  onProgress: (p: NetProgress) => void = () => {},
  /** The decoded size when known (NETS); the wire length otherwise. */
  size = 0,
): Promise<void> {
  const res = await fetcher(NET_SERVER + name);
  if (!res.ok || !res.body) throw new Error(`${res.status} fetching ${NET_SERVER}${name}`);
  const total = size || Number(res.headers.get('content-length') ?? 0);
  const part = `${path}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  const out = createWriteStream(part);
  try {
    for await (const chunk of Readable.fromWeb(res.body as never)) {
      const buf = chunk as Buffer;
      hash.update(buf);
      bytes += buf.byteLength;
      if (!out.write(buf)) await new Promise<void>((r) => out.once('drain', r));
      onProgress({ bytes, total });
    }
    await new Promise<void>((r, j) => out.end((e: unknown) => (e ? j(e) : r())));
    if (!hash.digest('hex').startsWith(name.slice(3, 15))) throw new Error(`checksum mismatch for ${name}`);
    renameSync(part, path);
  } catch (error) {
    out.destroy();
    rmSync(part, { force: true });
    throw error;
  }
}

export interface NetStatus {
  name: string;
  /** Bytes on disk once the download has finished and verified; 0 before. */
  bytes: number;
  ready: boolean;
  downloading: NetProgress | null;
  error: string | null;
}

export function engineNetsApi({
  dir = DATA_ENGINE_NETS,
  fetcher = fetch,
  // Injectable for the test, whose network is whatever bytes it made up,
  // named after their own hash.
  nets = NETS,
}: { dir?: string; fetcher?: typeof fetch; nets?: readonly { name: string; size: number }[] } = {}): Hono {
  const api = new Hono();
  const jobs = new Map<string, { progress: NetProgress; error: string | null; running: boolean }>();

  const known = (name: string) => nets.find((n) => n.name === name);
  const isNet = (name: string): boolean => known(name) !== undefined;
  const pathOf = (name: string): string => resolve(dir, name);

  const status = (name: string): NetStatus => {
    const path = pathOf(name);
    const job = jobs.get(name);
    const ready = existsSync(path);
    return {
      name,
      bytes: ready ? statSync(path).size : 0,
      ready,
      downloading: job?.running ? job.progress : null,
      error: job && !job.running ? job.error : null,
    };
  };

  api.get('/engine/nets', (c) => c.json({ nets: nets.map((n) => status(n.name)) }));

  api.post('/engine/nets/:name', (c) => {
    const name = c.req.param('name');
    if (!isNet(name)) return c.json({ error: 'unknown network' }, 404);
    if (existsSync(pathOf(name))) return c.json(status(name));
    if (jobs.get(name)?.running) return c.json(status(name), 409);
    const job = { progress: { bytes: 0, total: 0 }, error: null as string | null, running: true };
    jobs.set(name, job);
    mkdirSync(dir, { recursive: true });
    void downloadNet(name, pathOf(name), fetcher, (p) => {
      job.progress = p;
    }, known(name)!.size)
      .catch((error: unknown) => {
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        job.running = false;
      });
    return c.json(status(name), 202);
  });

  api.delete('/engine/nets/:name', (c) => {
    const name = c.req.param('name');
    if (!isNet(name)) return c.json({ error: 'unknown network' }, 404);
    if (jobs.get(name)?.running) return c.json({ error: 'a download is running' }, 409);
    rmSync(pathOf(name), { force: true });
    jobs.delete(name);
    return c.json(status(name));
  });

  // What the engine worker fetches. Immutable, since the name is the
  // checksum; no-transform, so the /api compressor leaves 99 MB of
  // already-dense weights alone rather than gzipping them per request.
  api.get('/engine/nets/:name/file', (c) => {
    const name = c.req.param('name');
    if (!isNet(name) || !existsSync(pathOf(name))) return c.json({ error: 'not downloaded' }, 404);
    const path = pathOf(name);
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
      'content-type': 'application/octet-stream',
      'content-length': String(statSync(path).size),
      'cache-control': 'private, max-age=31536000, immutable, no-transform',
    });
  });

  return api;
}

/** For the staging script: is the file at `path` the network it claims to be? */
export const netFileOk = (name: string, path: string): boolean =>
  existsSync(path) && checksumOk(name, readFileSync(path));
