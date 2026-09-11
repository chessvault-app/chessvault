import { Hono } from 'hono';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { commentSpans, commentText } from '../shared/pgn.ts';
import { markdownToText } from '../shared/markdownText.ts';
import { readJson, writeJson } from './atomic.ts';

/**
 * Full-text search over the vault, for the quick switcher.
 *
 * The switcher listed every document by NAME, from the wiki-link scan.
 * A vault is prose as much as it is names: a note's body, the comments
 * in a study or an annotated game, and a book's title are what a reader
 * remembers, and none of it was reachable without opening documents one
 * by one. This module reads that prose once, keeps what it read, and
 * answers a query with the names that match first and the documents
 * whose text matches after, each with the sentence the words sit in.
 *
 * What is read is what a reader wrote: a note's markdown as words
 * (shared/markdownText), a PGN's `{comments}` and nothing else — a
 * movetext hunt for `Nf3` would match every game in the vault, which is
 * the same reason the link scan confines itself to comments — and a
 * book's title, since a PDF's own text is the reader's and is not indexed.
 *
 * The index is DERIVED data. It lives under the data directory beside the
 * other rebuildable artefacts, never in the vault, and is safe to delete:
 * the next request rebuilds it. It is kept fresh the way the document
 * lists keep their previews fresh (server/studies.ts): every request
 * stats the files it covers and re-reads only those whose mtime or size
 * changed, so a vault of a thousand notes costs a thousand stats per
 * query and a read per edit. The stats are the price of never answering
 * from a stale index; there is no watcher, because a watcher is the one
 * thing an in-memory filesystem (the demo) and a network mount both lack.
 */

/** The kinds of thing a search can land on. */
export type SearchSection = 'notes' | 'studies' | 'games' | 'books' | 'puzzlebooks';

/** One indexed document: its name, and its prose in the pieces it came in. */
export interface SearchEntry {
  readonly section: SearchSection;
  readonly id: string;
  /** What the row shows: the id for a document, the title for a book. */
  readonly title: string;
  /**
   * The document's prose. A note is one part; a PGN is one part per
   * chapter, so a hit can say which chapter to open. A book has none.
   */
  readonly parts: readonly { readonly text: string; readonly chapter?: number }[];
  readonly mtimeMs: number;
  readonly size: number;
}

/** A row the switcher lists because its name matched. */
export interface NameHit {
  readonly section: SearchSection;
  readonly id: string;
  readonly title: string;
}

/** A row the switcher lists because its text matched. */
export interface ContentHit extends NameHit {
  /** The words around the first match, split so the match can be marked. */
  readonly snippet: { readonly before: string; readonly match: string; readonly after: string };
  /** The chapter the match sits in, for a study. */
  readonly chapter?: number;
}

export interface SearchResult {
  readonly names: NameHit[];
  readonly content: ContentHit[];
}

/** Most name rows and most text rows a query returns. */
export const NAME_CAP = 50;
export const CONTENT_CAP = 20;

/**
 * Characters of context either side of the matched words. Short before,
 * because a phone's row shows about fifty characters and the match has
 * to be one of them: at 48 the demo's rows cut off before the word.
 */
const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 96;

const SECTION_ORDER: readonly SearchSection[] = ['studies', 'notes', 'games', 'books', 'puzzlebooks'];

/** One spelling of a query, for comparing against one spelling of the text. */
const fold = (s: string): string => s.normalize('NFC').toLowerCase();

/** The words of a query, folded, empty when there is nothing to search for. */
export function queryTokens(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Where every token occurs in `folded`, or null when one is missing.
 * `folded` is the text after `fold`; offsets are into it.
 */
function positions(folded: string, tokens: readonly string[]): number[] | null {
  const found: number[] = [];
  for (const token of tokens) {
    const at = folded.indexOf(token);
    if (at < 0) return null;
    found.push(at);
  }
  return found;
}

/** How many times the tokens occur, capped so one long note cannot dominate. */
function occurrences(folded: string, tokens: readonly string[]): number {
  let n = 0;
  for (const token of tokens) {
    let at = folded.indexOf(token);
    while (at >= 0 && n < 100) {
      n += 1;
      at = folded.indexOf(token, at + token.length);
    }
  }
  return n;
}

/**
 * The words around one match, cut at word boundaries where there are any.
 *
 * `original` and `folded` are the same text in two spellings. When folding
 * kept the length (it does for every script the vault has been seen in;
 * only a few letters such as a dotted capital I grow under lowercasing)
 * the snippet is cut from the original so it reads as written; otherwise
 * the folded text is shown, which is still the reader's own words.
 */
export function snippetAt(
  original: string,
  folded: string,
  at: number,
  length: number,
): ContentHit['snippet'] {
  const text = original.length === folded.length ? original : folded;
  let start = Math.max(0, at - SNIPPET_BEFORE);
  let end = Math.min(text.length, at + length + SNIPPET_AFTER);
  // Begin at the first whole word inside the window and end at the last,
  // so a cut never lands mid-word. The match itself is never trimmed.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > at + length) end = space;
  }
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ');
  return {
    before: (start > 0 ? '…' : '') + oneLine(text.slice(start, at)).trimStart(),
    match: oneLine(text.slice(at, at + length)),
    after: oneLine(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}

/**
 * Rank the index against a query.
 *
 * Names first: a document whose name holds every word of the query, the
 * ones that START with the query ahead of the rest, then by where the
 * match sits, then shorter names first. A document already listed by name
 * is not listed again for its text.
 *
 * Text after: every word must occur somewhere in the document's prose.
 * More occurrences rank higher, an earlier first occurrence breaks the
 * tie, and the snippet is cut around the first word of the query in the
 * part it first appears in — which for a study is also the chapter to
 * open. Word order and adjacency are not scored: a reader searching
 * "rook endgame" wants the note that discusses rook endgames however it
 * phrased them, and a stricter rule here is a rule that silently misses.
 *
 * An empty query lists every name and no text, which is what the
 * switcher shows before anything is typed: the vault's documents, to be
 * scrolled or filtered.
 */
export function rank(entries: readonly SearchEntry[], query: string): SearchResult {
  const tokens = queryTokens(query);
  const whole = fold(query).trim();
  const bySection = (a: SearchEntry, b: SearchEntry): number =>
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
  if (tokens.length === 0) {
    const all = [...entries].sort((a, b) => bySection(a, b) || a.title.localeCompare(b.title));
    return { names: all.map(({ section, id, title }) => ({ section, id, title })), content: [] };
  }

  const named: { entry: SearchEntry; prefix: boolean; at: number }[] = [];
  const namedKeys = new Set<string>();
  for (const entry of entries) {
    const folded = fold(entry.title);
    const found = positions(folded, tokens);
    if (!found) continue;
    named.push({ entry, prefix: folded.startsWith(whole), at: Math.min(...found) });
    namedKeys.add(`${entry.section}:${entry.id}`);
  }
  named.sort(
    (a, b) =>
      Number(b.prefix) - Number(a.prefix) ||
      a.at - b.at ||
      a.entry.title.length - b.entry.title.length ||
      bySection(a.entry, b.entry) ||
      a.entry.title.localeCompare(b.entry.title),
  );

  const scored: { hit: ContentHit; count: number; at: number }[] = [];
  for (const entry of entries) {
    if (namedKeys.has(`${entry.section}:${entry.id}`) || entry.parts.length === 0) continue;
    const foldedParts = entry.parts.map((p) => fold(p.text));
    const all = foldedParts.join('\n');
    if (!positions(all, tokens)) continue;
    // The snippet comes from the first part holding the first word.
    const first = tokens[0]!;
    let partIndex = foldedParts.findIndex((p) => p.includes(first));
    if (partIndex < 0) partIndex = 0;
    const part = entry.parts[partIndex]!;
    const at = foldedParts[partIndex]!.indexOf(first);
    const chapter = part.chapter;
    scored.push({
      hit: {
        section: entry.section,
        id: entry.id,
        title: entry.title,
        snippet: snippetAt(part.text, foldedParts[partIndex]!, at, first.length),
        ...(chapter !== undefined ? { chapter } : {}),
      },
      count: occurrences(all, tokens),
      at: foldedParts.slice(0, partIndex).reduce((n, p) => n + p.length + 1, 0) + at,
    });
  }
  scored.sort((a, b) => b.count - a.count || a.at - b.at || a.hit.title.localeCompare(b.hit.title));

  return {
    names: named.slice(0, NAME_CAP).map(({ entry: { section, id, title } }) => ({ section, id, title })),
    content: scored.slice(0, CONTENT_CAP).map((s) => s.hit),
  };
}

/** Where each section's documents come from. */
export interface SearchSources {
  /** Directory of .md notes. */
  notes?: string;
  /** Directory of .pgn studies. */
  studies?: string;
  /** Directory of .pgn annotated games (the collection). */
  games?: string;
  /** Directory of `<id>/book.json` library books. */
  books?: string;
  /** Directory of `<slug>/book.json` puzzle books. */
  puzzleBooks?: string;
}

/** A file the index covers, as the walk found it. */
interface Seen {
  section: SearchSection;
  id: string;
  path: string;
  mtimeMs: number;
  size: number;
}

/** Ids under `dir` with extension `ext`, in the app's forward-slash form. */
function documentsIn(section: SearchSection, dir: string, ext: string): Seen[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' }) as unknown as string[];
  } catch {
    return []; // section absent in this deployment
  }
  const seen: Seen[] = [];
  for (const file of entries) {
    if (!file.endsWith(ext)) continue;
    const path = resolve(dir, file);
    try {
      const s = statSync(path);
      if (!s.isFile()) continue;
      seen.push({
        section,
        id: file.slice(0, -ext.length).split(sep).join('/'),
        path,
        mtimeMs: s.mtimeMs,
        size: s.size,
      });
    } catch {
      continue; // removed between readdir and stat
    }
  }
  return seen;
}

/** Every `<id>/book.json` under `dir`, keyed by the folder. */
function booksIn(section: SearchSection, dir: string): Seen[] {
  let entries: string[];
  try {
    entries = readdirSync(dir, { encoding: 'utf-8' }) as unknown as string[];
  } catch {
    return [];
  }
  const seen: Seen[] = [];
  for (const id of entries) {
    if (id.startsWith('.')) continue;
    const path = resolve(dir, id, 'book.json');
    try {
      const s = statSync(path);
      if (!s.isFile()) continue;
      seen.push({ section, id, path, mtimeMs: s.mtimeMs, size: s.size });
    } catch {
      continue; // a folder without a book.json is not a book
    }
  }
  return seen;
}

/**
 * Read one document into its entry.
 *
 * A PGN's comments are read as the text a reader sees (`commentText`,
 * which drops the `[%eval …]` commands), one part per chapter so a hit
 * opens the right one. A book contributes its title and nothing to
 * search inside, since the title IS its name.
 */
export function readEntry(seen: Seen): SearchEntry | null {
  let file: string;
  try {
    file = readFileSync(seen.path, 'utf-8');
  } catch {
    return null; // deleted mid-scan
  }
  const base = { section: seen.section, id: seen.id, mtimeMs: seen.mtimeMs, size: seen.size };
  if (seen.section === 'books' || seen.section === 'puzzlebooks') {
    let title = seen.id;
    try {
      const meta = JSON.parse(file) as { title?: unknown };
      if (typeof meta.title === 'string' && meta.title.trim()) title = meta.title.trim();
    } catch {
      // A damaged book.json still lists by its folder name.
    }
    return { ...base, title, parts: [] };
  }
  if (seen.section === 'notes') {
    const text = markdownToText(file);
    return { ...base, title: seen.id, parts: text ? [{ text }] : [] };
  }
  const byChapter = new Map<number, string[]>();
  for (const span of commentSpans(file)) {
    // A comment holds wiki links as a note does; show them by their text.
    const text = commentText(span.text)
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1');
    if (!text) continue;
    const list = byChapter.get(span.chapter);
    if (list) list.push(text);
    else byChapter.set(span.chapter, [text]);
  }
  const parts = [...byChapter.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, texts]) => ({ chapter, text: texts.join(' ') }));
  return { ...base, title: seen.id, parts };
}

/** What the index file holds. Bumping `version` discards every stored entry. */
interface Stored {
  version: number;
  entries: SearchEntry[];
}
const STORED_VERSION = 1;

/**
 * The index, loaded from its file once and brought up to date on every
 * call from a stat of each file it covers.
 */
export function searchIndex(sources: SearchSources, file: string) {
  let entries: Map<string, SearchEntry> | null = null;

  const keyOf = (section: SearchSection, id: string): string => `${section}:${id}`;

  const load = (): Map<string, SearchEntry> => {
    if (entries) return entries;
    entries = new Map();
    const stored = readJson<Stored | null>(file, null);
    if (stored && stored.version === STORED_VERSION && Array.isArray(stored.entries)) {
      for (const entry of stored.entries) entries.set(keyOf(entry.section, entry.id), entry);
    }
    return entries;
  };

  const walk = (): Seen[] => [
    ...(sources.studies ? documentsIn('studies', sources.studies, '.pgn') : []),
    ...(sources.notes ? documentsIn('notes', sources.notes, '.md') : []),
    ...(sources.games ? documentsIn('games', sources.games, '.pgn') : []),
    ...(sources.books ? booksIn('books', sources.books) : []),
    ...(sources.puzzleBooks ? booksIn('puzzlebooks', sources.puzzleBooks) : []),
  ];

  const persist = (map: Map<string, SearchEntry>): void => {
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeJson(file, { version: STORED_VERSION, entries: [...map.values()] } satisfies Stored);
    } catch {
      // The index still answers from memory; the next process rebuilds it.
    }
  };

  /** The entries as the vault stands now. */
  const current = (): SearchEntry[] => {
    const map = load();
    const wanted = new Set<string>();
    let changed = false;
    for (const seen of walk()) {
      const key = keyOf(seen.section, seen.id);
      wanted.add(key);
      const have = map.get(key);
      if (have && have.mtimeMs === seen.mtimeMs && have.size === seen.size) continue;
      const entry = readEntry(seen);
      if (entry) map.set(key, entry);
      else map.delete(key);
      changed = true;
    }
    for (const key of [...map.keys()]) {
      if (wanted.has(key)) continue;
      map.delete(key);
      changed = true;
    }
    if (changed) persist(map);
    return [...map.values()];
  };

  return {
    current,
    search: (query: string): SearchResult => rank(current(), query),
  };
}

/**
 * `GET /api/search?q=…` — the names that match, then the documents whose
 * text does, each with a snippet. An empty `q` lists every name.
 */
export function searchApi(sources: SearchSources, file: string): Hono {
  const api = new Hono();
  const index = searchIndex(sources, file);
  api.get('/search', (c) => c.json(index.search(c.req.query('q') ?? '')));
  return api;
}
