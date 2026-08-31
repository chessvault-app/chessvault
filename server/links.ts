import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  findUnlinkedMentions,
  findWikiMentions,
  renameLinksIn,
  buildAliasMap,
  resolveWikiLink,
  type AliasIndex,
  type LinkIndex,
  type LinkSection,
} from '../shared/wikiLinks.ts';
import { readAliases, splitAliasList, splitFrontMatter } from '../shared/frontMatter.ts';
import { validId } from '../shared/vaultNames.ts';

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
  /** Where in `context` the matched words are, for an unlinked mention. */
  readonly markAt?: number;
}

/** target key (`section:id`) -> what mentions it, in document order. */
type Backlinks = Map<string, Mention[]>;

/**
 * One scan of the vault: the links found, and enough to answer the other
 * question without a second walk.
 *
 * Unlinked mentions cannot be indexed the way links can. A link names one
 * document, so it can be filed under it; an unlinked mention is a document
 * NAME appearing in prose, and finding those for every document against
 * every note is documents x notes. So the bodies are kept from the scan
 * that already read them, and the hunt runs for the one document actually
 * being asked about.
 */
interface Scan {
  links: Backlinks;
  bodies: { id: string; body: string }[];
  aliases: AliasIndex;
}

const keyOf = (section: LinkSection, id: string): string => `${section}:${id}`;

/** Most unlinked mentions worth returning for one document. */
const UNLINKED_CAP = 50;

/**
 * The aliases of every document under `dir`, lowercased -> id.
 *
 * Read straight from the files rather than through the listing route: this
 * module already walks the same directories, and a document whose alias
 * the index missed would show no backlink for a link that works when
 * pressed — the exact disagreement the shared resolver exists to prevent.
 */
function aliasesIn(dir: string, ext: string, ids: readonly string[]): Map<string, string[]> {
  const entries: { id: string; aliases: string[] }[] = [];
  for (const id of ids) {
    let head: string;
    try {
      head = readFileSync(resolve(dir, `${id}${ext}`), 'utf-8').slice(0, 8192);
    } catch {
      continue;
    }
    entries.push({
      id,
      aliases:
        ext === '.md'
          ? readAliases(splitFrontMatter(head).front)
          : splitAliasList(/^\[Aliases\s+"([^"]*)"\]/m.exec(head)?.[1] ?? ''),
    });
  }
  // The collision rule is shared, not repeated: this walks a directory and
  // the browser reads a listing sorted newest-first, so any rule that
  // depended on which document came first would answer differently here
  // than there. It did, until it was measured.
  return buildAliasMap(entries);
}

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

/**
 * Keep the links pointing at a document that has been renamed or moved.
 *
 * Without this a rename silently breaks every link into the document: the
 * click stops working, and since backlinks exist the document also starts
 * claiming that nothing points at it. Neither reports a fault, which is
 * the worst version — the vault quietly loses the connections it is for.
 *
 * Runs AFTER the move, so the index it resolves against is the vault as it
 * now stands; `renameLinksIn` needs that to tell a link that broke from
 * one that still means something. Rewrites are confined to notes, the only
 * documents that can hold a link.
 */
export function linkRenamer(notesDir: string, studiesDir: string, gamesDir: string) {
  const indexNow = (): LinkIndex => ({
    notes: idsIn(notesDir, '.md'),
    studies: idsIn(studiesDir, '.pgn'),
    games: idsIn(gamesDir, '.pgn'),
  });

  /** Apply every (old id -> new id) pair to every note, in one pass each. */
  const apply = (pairs: { from: string; to: string }[]): void => {
    if (pairs.length === 0) return;
    const index = indexNow();
    for (const note of index.notes) {
      const path = resolve(notesDir, `${note}.md`);
      let body: string;
      try {
        body = readFileSync(path, 'utf-8');
      } catch {
        continue;
      }
      let next = body;
      for (const { from, to } of pairs) {
        next = renameLinksIn(next, from, to, index) ?? next;
      }
      if (next === body) continue;
      try {
        writeFileSync(path, next);
      } catch {
        // A note that cannot be written is left as it was. Losing a link
        // rewrite is recoverable; half-writing someone's note is not.
      }
    }
  };

  return {
    moved: (from: string, to: string): void => apply([{ from, to }]),
    /**
     * A folder move renames every document under it. The documents are
     * already at their new ids by the time this runs, so the old ones are
     * derived by putting the old folder name back.
     */
    folderMoved: (section: LinkSection, from: string, to: string): void => {
      const ids = indexNow()[section].filter((id) => id === to || id.startsWith(`${to}/`));
      apply(ids.map((id) => ({ from: `${from}${id.slice(to.length)}`, to: id })));
    },
  };
}

export function linksApi(notesDir: string, studiesDir: string, gamesDir: string): Hono {
  const api = new Hono();
  const dirs = [
    { dir: notesDir, ext: '.md' },
    { dir: studiesDir, ext: '.pgn' },
    { dir: gamesDir, ext: '.pgn' },
  ];

  let cached: { sig: string; scan: Scan } | null = null;

  function build(): Scan {
    const index: LinkIndex = {
      notes: idsIn(notesDir, '.md'),
      studies: idsIn(studiesDir, '.pgn'),
      games: idsIn(gamesDir, '.pgn'),
    };
    const aliases: AliasIndex = {
      notes: aliasesIn(notesDir, '.md', index.notes),
      studies: aliasesIn(studiesDir, '.pgn', index.studies),
      games: aliasesIn(gamesDir, '.pgn', index.games),
    };
    const links: Backlinks = new Map();
    const bodies: { id: string; body: string }[] = [];

    for (const from of index.notes) {
      let body: string;
      try {
        body = readFileSync(resolve(notesDir, `${from}.md`), 'utf-8');
      } catch {
        continue; // deleted mid-scan
      }
      bodies.push({ id: from, body });
      for (const mention of findWikiMentions(body)) {
        const hit = resolveWikiLink(mention.target, index, aliases);
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
    return { links, bodies, aliases };
  }

  function current(): Scan {
    const sig = signature(dirs);
    if (!cached || cached.sig !== sig) cached = { sig, scan: build() };
    return cached.scan;
  }

  /**
   * `section` is the app's own routing word for the document kind, so a
   * caller passes what it already has and gets back what it can render.
   */
  api.get('/links/:section{notes|studies|games}/:id{.+}', (c) => {
    const section = c.req.param('section') as LinkSection;
    const id = decodeURIComponent(c.req.param('id'));
    const scan = current();
    const mentions = scan.links.get(keyOf(section, id)) ?? [];

    /**
     * What this document answers to: its last segment, its full id when
     * that is something else, and the aliases it alone claims. A contested
     * alias is left out — suggesting a link that would resolve to nothing
     * is worse than suggesting none.
     */
    const names = new Set<string>([id.split('/').at(-1)!, id]);
    for (const [alias, ids] of scan.aliases[section]) {
      if (ids.length === 1 && ids[0] === id) names.add(alias);
    }

    const unlinked: Mention[] = [];
    for (const { id: from, body } of scan.bodies) {
      // A note naming itself in its own prose is not a mention of anything
      // the reader cannot already see.
      if (section === 'notes' && from === id) continue;
      for (const found of findUnlinkedMentions(body, [...names])) {
        unlinked.push({
          from,
          context: found.context,
          target: found.target,
          at: found.at,
          markAt: found.markAt,
        });
        // Capped, and the cap is reported rather than silently applied —
        // see the response. A common word for a document name can match
        // hundreds of times, and shipping all of them helps nobody.
        if (unlinked.length >= UNLINKED_CAP) break;
      }
      if (unlinked.length >= UNLINKED_CAP) break;
    }

    return c.json({ mentions, unlinked, unlinkedCapped: unlinked.length >= UNLINKED_CAP });
  });

  /**
   * Turn one unlinked mention into a link.
   *
   * This edits a note the reader is not looking at, on the strength of a
   * suggestion, so it verifies before it writes: the text at that offset
   * must still be exactly what was offered. A note edited between the
   * suggestion and the press is refused rather than patched at a stale
   * offset — the offsets came from a cached scan, and writing brackets
   * into the middle of a sentence because the file moved under us is
   * precisely the damage a vault of plain files cannot absorb.
   *
   * One occurrence, named by where it is. "Link all of them" is a
   * different promise and would want its own confirmation.
   */
  api.post('/links/link', async (c) => {
    const body = await c.req
      .json<{ note?: string; at?: number; text?: string; target?: string }>()
      .catch(() => null);
    const note = body?.note;
    const at = body?.at;
    const text = body?.text;
    const target = body?.target ?? text;
    if (!note || typeof at !== 'number' || !text || !target || !validId(note)) {
      return c.json({ error: 'note, at, text and target are required' }, 400);
    }

    const path = resolve(notesDir, `${note}.md`);
    let source: string;
    try {
      source = readFileSync(path, 'utf-8');
    } catch {
      return c.json({ error: 'that note could not be read' }, 404);
    }
    if (source.slice(at, at + text.length) !== text) {
      return c.json({ error: 'that note has changed since; reopen it and try again' }, 409);
    }

    // Written as the writer wrote it: the words they typed stay on the
    // page, and the link carries the target only when the two differ.
    const link = text === target ? `[[${text}]]` : `[[${target}|${text}]]`;
    const next = `${source.slice(0, at)}${link}${source.slice(at + text.length)}`;
    try {
      writeFileSync(path, next);
    } catch {
      return c.json({ error: 'that note could not be written' }, 500);
    }
    return c.json({ linked: note });
  });

  return api;
}
