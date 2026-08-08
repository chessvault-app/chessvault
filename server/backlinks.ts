import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VAULT_NOTES } from './paths.ts';

const WIKI_RE = /\[\[([^[\]]+)\]\]/g;

/**
 * The inverse of wiki-links: which notes mention `target`? Scans the
 * plain markdown on demand (a vault is small; no index to go stale) and
 * matches the full id or its last path segment, case-insensitively.
 */
export function backlinksApi(notesDir: string = VAULT_NOTES): Hono {
  const api = new Hono();
  api.get('/backlinks', (c) => {
    const target = (c.req.query('target') ?? '').trim().toLowerCase();
    if (!target) return c.json({ error: 'expected target' }, 400);
    const tail = target.split('/').at(-1)!;
    const notes: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      let entries: string[] = [];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, `${prefix}${entry}/`);
        else if (entry.endsWith('.md')) {
          // Older saves escaped the brackets; normalise before matching.
          const text = readFileSync(path, 'utf-8').replace(/\\([[\]])/g, '$1');
          for (const match of text.matchAll(WIKI_RE)) {
            const linked = match[1]!.trim().toLowerCase();
            if (linked === target || linked.split('/').at(-1) === tail) {
              notes.push(`${prefix}${entry.slice(0, -3)}`);
              break;
            }
          }
        }
      }
    };
    walk(notesDir, '');
    return c.json({ notes });
  });
  return api;
}
