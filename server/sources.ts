import { Hono } from 'hono';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { renameRetrying } from './atomic.ts';
import { VAULT_SOURCES } from './paths.ts';

/**
 * The uploaded PGN collections in vault/sources — the raw material every
 * reference database is built from.
 *
 * These routes lived in server/books.ts while opening books existed;
 * books are gone (the reference databases carry their own position index
 * now, see refgamesIndex.ts) and the uploads survive them, because they
 * were never about books: they are how a phone or a remote browser gets a
 * 300 MB Elite month onto the server at all.
 */

/** No slashes, no dots-only names — upload names map straight to files. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export interface SourcesOptions {
  /**
   * Is something reading these files right now?
   *
   * A build is handed the source paths and then reads them for minutes; a
   * delete landing in the middle of that is a build that fails halfway
   * through (on Windows the unlink throws instead, which is a 500 nobody
   * can act on). The predicate is passed in rather than imported so this
   * module stays free of the refgames build state — see mountVault.
   */
  busy?: () => boolean;
}

export function sourcesApi(dir: string = VAULT_SOURCES, options: SourcesOptions = {}): Hono {
  const api = new Hono();

  api.get('/sources', (c) => {
    let sources: { name: string; bytes: number }[] = [];
    try {
      sources = readdirSync(dir)
        .filter((f) => f.endsWith('.pgn'))
        .map((f) => ({ name: f, bytes: statSync(resolve(dir, f)).size }));
    } catch {
      // No directory yet — an empty list, not a 500.
    }
    return c.json({ sources });
  });

  /**
   * Upload a PGN collection.
   *
   * Streamed to disk rather than read into memory: these are Lichess Elite
   * months and Gigabase exports, hundreds of megabytes each, and buffering
   * one would take the server down on the 2 GB box it runs on.
   *
   * It exists because the app used to tell people to put files in
   * vault/sources/ themselves, which is not something a phone or a remote
   * browser can do — and the rule is that every user action is possible in
   * the app.
   */
  api.post('/sources', async (c) => {
    const name = c.req.query('name') ?? '';
    if (!NAME_RE.test(name) || !name.toLowerCase().endsWith('.pgn')) {
      return c.json({ error: 'name must be a plain .pgn filename' }, 400);
    }
    const target = resolve(dir, name);
    // resolve() collapses any traversal NAME_RE somehow allowed; refuse
    // anything that did not land directly in the sources directory.
    if (resolve(target, '..') !== resolve(dir)) {
      return c.json({ error: 'invalid name' }, 400);
    }
    if (existsSync(target)) return c.json({ error: 'a file with that name is already here' }, 409);
    if (!c.req.raw.body) return c.json({ error: 'empty upload' }, 400);

    // This route is exempt from the API-wide 32 MB body cap (which would
    // buffer or refuse exactly the uploads it exists for), so it carries
    // its own: generous enough for any elite month or Gigabase export,
    // bounded so a runaway upload cannot fill the disk.
    const CAP = 2 * 1024 ** 3;
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > CAP) {
      return c.json({ error: 'source file too large (2 GB cap)' }, 413);
    }

    mkdirSync(dir, { recursive: true });
    // Write beside the target, then rename: a dropped connection leaves a
    // .part behind rather than a truncated PGN that looks importable.
    const part = `${target}.part`;
    // Imported here rather than at the top because the static demo runs
    // these same route modules in the browser with node:fs aliased to an
    // in-memory shim, and a top-level `createWriteStream` import fails its
    // build outright. The demo never reaches these lines — it has no server
    // to upload to — so a lazy import costs nothing and keeps the shim
    // from having to fake a write stream. Above the try, not inside it,
    // because the catch needs `finished` too.
    const { createWriteStream } = await import('node:fs');
    const { Readable } = await import('node:stream');
    const { finished, pipeline } = await import('node:stream/promises');
    const sink = createWriteStream(part);
    try {
      // Chunked uploads declare no length up front, so the cap is enforced
      // on the bytes as they stream past.
      let seen = 0;
      await pipeline(
        Readable.fromWeb(c.req.raw.body as NodeReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            seen += (chunk as Buffer).byteLength;
            if (seen > CAP) throw new Error('source file too large');
            yield chunk;
          }
        },
        sink,
      );
      // renameRetrying, not renameSync: the .part was written a moment
      // ago, and on Windows whatever is still looking at those bytes —
      // Defender, the indexer — makes the rename throw a transient EPERM
      // that is not an error (see atomic.ts). A 300 MB upload is the worst
      // thing here to have to do twice.
      renameRetrying(part, target);
    } catch (error) {
      // Wait for the sink to close before removing the .part.
      // createWriteStream opens the file asynchronously and pipeline
      // rejects without waiting for that open, so a stream that fails
      // early — a connection dropped on the first chunk — can reach the
      // rmSync first and have the open recreate the file behind it. The
      // books route left a stray .part exactly this way.
      await finished(sink).catch(() => {});
      rmSync(part, { force: true });
      if ((error as Error).message === 'source file too large') {
        return c.json({ error: 'source file too large (2 GB cap)' }, 413);
      }
      return c.json({ error: `upload failed: ${(error as Error).message}` }, 500);
    }
    return c.json({ name, bytes: statSync(target).size });
  });

  /**
   * Delete an uploaded collection.
   *
   * There is no trash behind this: the app holds the request back for the
   * length of an undo instead, so an undone deletion is one that was never
   * asked for (web/src/ui/useUndoable.ts). What arrives here is meant.
   */
  api.delete('/sources/:name', (c) => {
    const name = c.req.param('name');
    if (!NAME_RE.test(name) || !name.toLowerCase().endsWith('.pgn')) {
      return c.json({ error: 'invalid name' }, 400);
    }
    const target = resolve(dir, name);
    if (resolve(target, '..') !== resolve(dir)) return c.json({ error: 'invalid name' }, 400);
    if (!existsSync(target)) return c.json({ error: 'no such file' }, 404);
    if (options.busy?.()) {
      return c.json({ error: 'a build is reading the files right now' }, 409);
    }
    try {
      rmSync(target);
    } catch (error) {
      // Something else has the file open — say so rather than 500.
      return c.json({ error: `could not delete it: ${(error as Error).message}` }, 500);
    }
    return c.json({ deleted: name });
  });

  return api;
}
