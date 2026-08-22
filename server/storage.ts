import { Hono } from 'hono';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA, VAULT } from './paths.ts';

/**
 * What the vault and its derived data take on disk, by area — the Settings
 * "Storage used" card. One walk per area, summed; no counts of games or
 * puzzles, because a size is a stat per file and a count is a parse of
 * every one of them.
 *
 * The keys are stable names the client labels; they are not paths, and
 * nothing about where a folder actually sits leaves the server.
 */

export interface StorageArea {
  key: string;
  bytes: number;
  files: number;
}

async function walk(path: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return { bytes, files };
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      const inner = await walk(child);
      bytes += inner.bytes;
      files += inner.files;
    } else if (entry.isFile()) {
      try {
        bytes += (await stat(child)).size;
        files += 1;
      } catch {
        // Raced with a delete; the next call will be right.
      }
    }
  }
  return { bytes, files };
}

export function storageApi(vault: string = VAULT, data: string = DATA): Hono {
  const api = new Hono();

  /**
   * The areas, in the order the card shows them. `games` is the user's
   * own collection; the per-player caches fetched from chess.com and
   * Lichess sit beside it in the same folder and are reported apart,
   * because they are the one thing under vault/ that is rebuildable.
   */
  const AREAS: { key: string; paths: string[] }[] = [
    { key: 'games', paths: [resolve(vault, 'games', 'collection')] },
    { key: 'studies', paths: [resolve(vault, 'studies')] },
    { key: 'notes', paths: [resolve(vault, 'notes')] },
    { key: 'books', paths: [resolve(vault, 'books')] },
    { key: 'puzzlebooks', paths: [resolve(vault, 'puzzlebooks')] },
    { key: 'puzzles', paths: [resolve(vault, 'puzzles')] },
    { key: 'repertoire', paths: [resolve(vault, 'repertoire')] },
    { key: 'sources', paths: [resolve(vault, 'sources')] },
    {
      key: 'gamesCache',
      paths: [resolve(vault, 'games', 'chesscom'), resolve(vault, 'games', 'lichess')],
    },
    { key: 'history', paths: [resolve(vault, '.history.git')] },
    { key: 'refgames', paths: [resolve(data, 'refgames')] },
    { key: 'explorerCache', paths: [resolve(data, 'explorer-cache')] },
    { key: 'tablebaseCache', paths: [resolve(data, 'tablebase-cache')] },
  ];

  api.get('/storage', async (c) => {
    const areas: StorageArea[] = [];
    for (const area of AREAS) {
      let bytes = 0;
      let files = 0;
      for (const path of area.paths) {
        const got = await walk(path);
        bytes += got.bytes;
        files += got.files;
      }
      areas.push({ key: area.key, bytes, files });
    }
    return c.json({ areas });
  });

  return api;
}
