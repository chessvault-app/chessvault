import { Hono } from 'hono';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  LINK_SECTIONS,
  findUnlinkedMentions,
  findWikiMentions,
  renameLinksIn,
  buildAliasMap,
  resolveWikiLink,
  type AliasIndex,
  type LinkIndex,
  type LinkSection,
} from '../shared/wikiLinks.ts';
import { blankCommands, commentSpans } from '../shared/pgn.ts';
import { readAliases, splitAliasList, splitFrontMatter } from '../shared/frontMatter.ts';
import { validId } from '../shared/vaultNames.ts';

/**
 * What points at a document.
 *
 * Links are one-directional on disk — a note writes `[[Some Game]]` and the
 * game knows nothing about it — so the reverse is derived, by reading every
 * document and resolving every link it contains.
 *
 * Every document, now: a note is markdown and holds links anywhere, while a
 * study or a game is a PGN and holds them in its comments. That is the
 * whole of the difference, and it is confined to which SPANS of a file get
 * read — see `Prose`. Reading a PGN whole would be both wrong and
 * expensive: a study named after a move would match movetext everywhere.
 *
 * The resolution rule is NOT written here. It comes from shared/wikiLinks,
 * the same function the editor calls when a link is clicked, because the
 * two must agree exactly: a rule that differed by a case fold or a
 * tie-break would leave a document showing no backlink for a link that
 * works when pressed, with nothing anywhere reporting a fault.
 */

interface Mention {
  /** The document the mention was written in. */
  readonly from: string;
  /**
   * Which kind of document that is.
   *
   * A mention could only ever come from a note, so the client navigated to
   * `notes/<from>` without being told. Now it can come from any of the
   * three, and a backlink that opens the wrong section is worse than none.
   */
  readonly fromSection: LinkSection;
  /**
   * Which chapter of it, for a study — a PGN file holds several, and
   * landing on the first when the comment is in the fourth means hunting
   * for what the backlink promised. Absent for notes, which have none, and
   * for games, where the file IS the game.
   *
   * Recomputed on every request from the file as it stands, never stored,
   * so reordering or deleting chapters cannot leave it pointing at the
   * wrong one.
   */
  readonly chapter?: number;
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
 * every other is documents x documents. So the prose is kept from the scan
 * that already read it, and the hunt runs for the one document actually
 * being asked about.
 */
interface Scan {
  links: Backlinks;
  prose: Prose[];
  aliases: AliasIndex;
}

/**
 * The parts of one document that can hold a link, and where they start.
 *
 * A note is one span covering the whole file: its offsets already meant
 * file offsets, which is what the link-this-mention button writes at. A
 * PGN is one span per `{...}` comment and nothing else — a study named
 * after a move, hunted across a whole PGN, would match every move in every
 * game in the vault.
 */
interface Prose {
  readonly section: LinkSection;
  readonly id: string;
  readonly spans: readonly { at: number; text: string; chapter?: number }[];
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
 * one that still means something.
 *
 * Every kind of document is rewritten, not just notes: a link written in a
 * move comment breaks on a rename exactly as one in a note does, and this
 * function exists precisely so that breakage does not happen silently.
 */
export function linkRenamer(notesDir: string, studiesDir: string, gamesDir: string) {
  const source: Record<LinkSection, { dir: string; ext: string }> = {
    notes: { dir: notesDir, ext: '.md' },
    studies: { dir: studiesDir, ext: '.pgn' },
    games: { dir: gamesDir, ext: '.pgn' },
  };
  const indexNow = (): LinkIndex =>
    Object.fromEntries(
      LINK_SECTIONS.map((section) => [section, idsIn(source[section].dir, source[section].ext)]),
    ) as unknown as LinkIndex;

  /**
   * Rewrite the links inside a PGN's comments, and nothing else.
   *
   * `renameLinksIn` over the whole file would very nearly work — headers
   * use single brackets and movetext has none, so `[[...]]` outside a
   * comment is not a thing a PGN contains. Nearly is the wrong standard
   * for a function that rewrites someone's game files unattended, and
   * confining it costs one loop.
   *
   * Backwards through the spans, because a rewrite changes the length of
   * the text it replaces and every offset after it.
   */
  const inComments = (file: string, pairs: { from: string; to: string }[], index: LinkIndex): string => {
    const spans = commentSpans(file);
    let out = file;
    for (let i = spans.length - 1; i >= 0; i -= 1) {
      const span = spans[i]!;
      let next = span.text;
      for (const { from, to } of pairs) next = renameLinksIn(next, from, to, index) ?? next;
      if (next === span.text) continue;
      out = out.slice(0, span.at) + next + out.slice(span.at + span.text.length);
    }
    return out;
  };

  /** Apply every (old id -> new id) pair to every document, one pass each. */
  const apply = (pairs: { from: string; to: string }[]): void => {
    if (pairs.length === 0) return;
    const index = indexNow();
    for (const section of LINK_SECTIONS) {
      const { dir, ext } = source[section];
      for (const id of index[section]) {
        const path = resolve(dir, `${id}${ext}`);
        let body: string;
        try {
          body = readFileSync(path, 'utf-8');
        } catch {
          continue;
        }
        let next = body;
        if (ext === '.md') {
          for (const { from, to } of pairs) next = renameLinksIn(next, from, to, index) ?? next;
        } else {
          next = inComments(body, pairs, index);
        }
        if (next === body) continue;
        try {
          writeFileSync(path, next);
        } catch {
          // A document that cannot be written is left as it was. Losing a
          // link rewrite is recoverable; half-writing someone's file is not.
        }
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
  /**
   * Where each kind of document lives on disk. One table rather than the
   * three-of-everything this had: the scan, the alias read, the signature
   * and the write-back all want the same pair, and a section added to one
   * list and not another is a section that silently holds no links.
   */
  const SOURCE: Record<LinkSection, { dir: string; ext: string }> = {
    notes: { dir: notesDir, ext: '.md' },
    studies: { dir: studiesDir, ext: '.pgn' },
    games: { dir: gamesDir, ext: '.pgn' },
  };
  const dirs = LINK_SECTIONS.map((section) => SOURCE[section]);

  let cached: { sig: string; scan: Scan } | null = null;

  function build(): Scan {
    const index = Object.fromEntries(
      LINK_SECTIONS.map((section) => [section, idsIn(SOURCE[section].dir, SOURCE[section].ext)]),
    ) as unknown as LinkIndex;
    const aliases = Object.fromEntries(
      LINK_SECTIONS.map((section) => [
        section,
        aliasesIn(SOURCE[section].dir, SOURCE[section].ext, index[section]),
      ]),
    ) as unknown as AliasIndex;
    const links: Backlinks = new Map();
    const prose: Prose[] = [];

    for (const section of LINK_SECTIONS) {
      const { dir, ext } = SOURCE[section];
      for (const from of index[section]) {
        let file: string;
        try {
          file = readFileSync(resolve(dir, `${from}${ext}`), 'utf-8');
        } catch {
          continue; // deleted mid-scan
        }
        // A note is prose end to end; a PGN is prose only inside its
        // comments. Both hand back offsets into the FILE, which is what
        // the link-this-mention button writes at.
        // Blanked, not stripped: `[%eval 0.34]` inside a comment is
        // machinery, and it was showing up in the sentence a backlink
        // quotes — one of them cut mid-command, since the window around a
        // mention knows nothing about them. Equal-length spaces take it out
        // of the sentence while leaving every offset after it exactly where
        // it was, which is what the write-back verifies against.
        const spans: Prose['spans'] =
          ext === '.md'
            ? [{ at: 0, text: file }]
            : commentSpans(file).map((span) => ({ ...span, text: blankCommands(span.text) }));
        prose.push({ section, id: from, spans });

        for (const span of spans) {
          for (const mention of findWikiMentions(span.text)) {
            const hit = resolveWikiLink(mention.target, index, aliases);
            // Broken and ambiguous links are dropped here rather than
            // reported. They are worth surfacing -- an unresolved link is
            // currently invisible in the app -- but on the link itself, in
            // the editor, not on a document that by definition is not the
            // one being pointed at.
            if (typeof hit === 'string') continue;
            // A document that links to itself is not a backlink. It would
            // appear on its own page as a mention of itself, which tells
            // the reader nothing they cannot see by looking down. The test
            // used to name `notes` outright, which was the only section a
            // link could come from.
            if (hit.section === section && hit.id === from) continue;
            const key = keyOf(hit.section, hit.id);
            const list = links.get(key);
            const entry: Mention = {
              from,
              fromSection: section,
              // Only a study has chapters: a note has none, and a game is
              // one game per file, so the file already IS the destination.
              ...(section === 'studies' && span.chapter !== undefined
                ? { chapter: span.chapter }
                : {}),
              context: mention.context,
              target: mention.target,
              // Span-relative out of `findWikiMentions`, file-relative
              // here: everything downstream — the panel's identity for a
              // row, and the offset the server verifies before writing —
              // means a position in the file.
              at: span.at + mention.at,
              markAt: mention.markAt,
            };
            if (list) list.push(entry);
            else links.set(key, [entry]);
          }
        }
      }
    }
    return { links, prose, aliases };
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
    outer: for (const source of scan.prose) {
      // A document naming itself in its own prose is not a mention of
      // anything the reader cannot already see. Both halves of the test
      // matter now that two documents in different sections can share a
      // name.
      if (source.section === section && source.id === id) continue;
      for (const span of source.spans) {
        for (const found of findUnlinkedMentions(span.text, [...names])) {
          unlinked.push({
            from: source.id,
            fromSection: source.section,
            ...(source.section === 'studies' && span.chapter !== undefined
              ? { chapter: span.chapter }
              : {}),
            context: found.context,
            target: found.target,
            at: span.at + found.at,
            markAt: found.markAt,
          });
          // Capped, and the cap is reported rather than silently applied —
          // see the response. A common word for a document name can match
          // hundreds of times, and shipping all of them helps nobody.
          if (unlinked.length >= UNLINKED_CAP) break outer;
        }
      }
    }

    return c.json({ mentions, unlinked, unlinkedCapped: unlinked.length >= UNLINKED_CAP });
  });

  /**
   * Turn one unlinked mention into a link.
   *
   * This edits a document the reader is not looking at, on the strength of
   * a suggestion, so it verifies before it writes: the text at that offset
   * must still be exactly what was offered. A document edited between the
   * suggestion and the press is refused rather than patched at a stale
   * offset — the offsets came from a cached scan, and writing brackets
   * into the middle of a sentence because the file moved under us is
   * precisely the damage a vault of plain files cannot absorb.
   *
   * That check is also what makes this safe for a PGN, where the offset
   * points inside a `{...}` comment. It cannot land in movetext, because
   * the only offsets ever handed out came from `commentSpans`; and if the
   * file has been rewritten since — which a study gets on every save, its
   * text being reprinted from the parsed game rather than kept — the text
   * is no longer there and the write is refused.
   *
   * One occurrence, named by where it is. "Link all of them" is a
   * different promise and would want its own confirmation.
   */
  api.post('/links/link', async (c) => {
    const body = await c.req
      .json<{ section?: string; note?: string; at?: number; text?: string; target?: string }>()
      .catch(() => null);
    // `note` is what this was called when a note was the only thing that
    // could hold a link; kept so an older client is not broken by the
    // rename, and defaulted to the section it meant.
    const from = body?.note;
    const section = (body?.section ?? 'notes') as LinkSection;
    const at = body?.at;
    const text = body?.text;
    const target = body?.target ?? text;
    if (!from || typeof at !== 'number' || !text || !target || !validId(from)) {
      return c.json({ error: 'note, at, text and target are required' }, 400);
    }
    if (!LINK_SECTIONS.includes(section)) {
      return c.json({ error: 'section must be notes, studies or games' }, 400);
    }

    const { dir, ext } = SOURCE[section];
    const path = resolve(dir, `${from}${ext}`);
    let source: string;
    try {
      source = readFileSync(path, 'utf-8');
    } catch {
      return c.json({ error: 'that document could not be read' }, 404);
    }
    if (source.slice(at, at + text.length) !== text) {
      return c.json({ error: 'that document has changed since; reopen it and try again' }, 409);
    }

    // Written as the writer wrote it: the words they typed stay on the
    // page, and the link carries the target only when the two differ.
    const link = text === target ? `[[${text}]]` : `[[${target}|${text}]]`;
    const next = `${source.slice(0, at)}${link}${source.slice(at + text.length)}`;
    try {
      writeFileSync(path, next);
    } catch {
      return c.json({ error: 'that document could not be written' }, 500);
    }
    return c.json({ linked: from });
  });

  return api;
}
