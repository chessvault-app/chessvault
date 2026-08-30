import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  findWikiMentions,
  resolveWikiLink,
  type LinkIndex,
  type LinkSection,
} from '../shared/wikiLinks.ts';

/**
 * What points at a document.
 *
 * Links are one-directional on disk — a note writes `[[Some Game]]` and the
 * game knows nothing about it — so the reverse is derived, by reading every
 * note and resolving every link it contains. Only notes can hold links
 * today (studies and games are PGN, with no markdown body), which is what
 * makes this affordable: the scan is over `vault/notes/*.md` and nothing
 * else.
 *
 * The resolution rule is NOT written here. It comes from shared/wikiLinks,
 * the same function the editor calls when a link is clicked, because the
 * two must agree exactly: a rule that differed by a case fold or a
 * tie-break would leave a document showing no backlink for a link that
 * works when pressed, with nothing anywhere reporting a fault.
 */

interface Mention {
  /** The note the mention was written in. */
  readonly from: string;
  /** The sentence it sits in, brackets stripped. */
  readonly context: string;
  /**
   * The text inside the brackets, as written. The context has had its
   * brackets removed to read as prose, which leaves nothing marking the
   * link; handing back what was written lets the reader see WHICH words
   * matched — worth having when a link resolved by its last segment and
   * the document's real id is longer.
   */
  readonly target: string;
  /** Where in that note, so two mentions of one target stay distinct. */
  readonly at: number;
}

/** target key (`section:id`) -> what mentions it, in document order. */
type Backlinks = Map<string, Mention[]>;

const keyOf = (section: LinkSection, id: string): string => `${section}:${id}`;

/** Ids under `dir` with extension `ext`, in the app's forward-slash form. */
function idsIn(dir: string, ext: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' });
  } catch {
    return []; // section absent in this deployment
  }
  const ids: string[] = [];
  for (const file of entries) {
    if (!file.endsWith(ext)) continue;
    try {
      if (!statSync(resolve(dir, file)).isFile()) continue;
    } catch {
      continue; // removed between readdir and stat
    }
    ids.push(file.slice(0, -ext.length).split(sep).join('/'));
  }
  return ids;
}

/**
 * A cheap value that changes whenever the answer would.
 *
 * Every document open asks for its backlinks, and rebuilding means reading
 * every note in the vault. The names and mtimes of the files involved
 * change on any edit, rename, add or delete that could alter the index, and
 * cost a stat rather than a read.
 */
function signature(dirs: { dir: string; ext: string }[]): string {
  const parts: string[] = [];
  for (const { dir, ext } of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' });
    } catch {
      continue;
    }
    for (const file of entries.sort()) {
      if (!file.endsWith(ext)) continue;
      try {
        const s = statSync(resolve(dir, file));
        if (s.isFile()) parts.push(`${file}:${s.mtimeMs}:${s.size}`);
      } catch {
        /* vanished — the next request will see the change */
      }
    }
  }
  return parts.join('|');
}

export function linksApi(notesDir: string, studiesDir: string, gamesDir: string): Hono {
  const api = new Hono();
  const dirs = [
    { dir: notesDir, ext: '.md' },
    { dir: studiesDir, ext: '.pgn' },
    { dir: gamesDir, ext: '.pgn' },
  ];

  let cached: { sig: string; links: Backlinks } | null = null;

  function build(): Backlinks {
    const index: LinkIndex = {
      notes: idsIn(notesDir, '.md'),
      studies: idsIn(studiesDir, '.pgn'),
      games: idsIn(gamesDir, '.pgn'),
    };
    const links: Backlinks = new Map();

    for (const from of index.notes) {
      let body: string;
      try {
        body = readFileSync(resolve(notesDir, `${from}.md`), 'utf-8');
      } catch {
        continue; // deleted mid-scan
      }
      for (const mention of findWikiMentions(body)) {
        const hit = resolveWikiLink(mention.target, index);
        // Broken and ambiguous links are dropped here rather than
        // reported. They are worth surfacing -- an unresolved link is
        // currently invisible in the app -- but on the link itself, in the
        // editor, not on a document that by definition is not the one
        // being pointed at.
        if (typeof hit === 'string') continue;
        // A note that links to itself is not a backlink. It would appear
        // on its own page as a mention of itself, which tells the reader
        // nothing they cannot see by looking down.
        if (hit.section === 'notes' && hit.id === from) continue;
        const key = keyOf(hit.section, hit.id);
        const list = links.get(key);
        const entry: Mention = {
          from,
          context: mention.context,
          target: mention.target,
          at: mention.at,
        };
        if (list) list.push(entry);
        else links.set(key, [entry]);
      }
    }
    return links;
  }

  function current(): Backlinks {
    const sig = signature(dirs);
    if (!cached || cached.sig !== sig) cached = { sig, links: build() };
    return cached.links;
  }

  /**
   * `section` is the app's own routing word for the document kind, so a
   * caller passes what it already has and gets back what it can render.
   */
  api.get('/links/:section{notes|studies|games}/:id{.+}', (c) => {
    const section = c.req.param('section') as LinkSection;
    const id = decodeURIComponent(c.req.param('id'));
    const mentions = current().get(keyOf(section, id)) ?? [];
    return c.json({ mentions });
  });

  return api;
}
