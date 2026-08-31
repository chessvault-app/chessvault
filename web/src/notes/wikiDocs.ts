import { navigate } from '@/lib/router';
import { api } from '@/lib/api';
import {
  LINK_SECTIONS,
  buildAliasMap,
  resolveWikiLink,
  wikiLinkCandidates,
  type ResolvedLink,
  type AliasIndex,
  type LinkIndex,
  type LinkSection,
} from '@shared/wikiLinks';

/**
 * What the vault contains, and what a link written against it means.
 *
 * This is the half of the wiki-link feature that has nothing to do with
 * any one editor. It was inside the TipTap extension while notes were the
 * only place a link could be written; move comments read links too, and
 * they have no editor to hang an index off — so the index, the resolver
 * and the "that link named nothing" dialog live here, and the extension
 * imports them like anybody else.
 *
 * The rule for WHICH document a target names is `resolveWikiLink`, shared
 * with the server's backlink index, because the two must agree exactly: a
 * rule that differed by a case fold or a tie-break would leave a document
 * showing no backlink for a link that works when pressed, with nothing
 * anywhere reporting a fault.
 */

const SECTION_URL: Record<LinkSection, string> = {
  notes: '/api/notes',
  studies: '/api/studies',
  games: '/api/games/docs',
};

/**
 * Every document id, cached.
 *
 * One cache, several readers: the suggester's list, the click that follows
 * a link, and the decoration (or span) that says whether a link resolves
 * at all. They were two caches for a while — a flat list for the popup and
 * a fresh fetch per click — which is three chances to disagree about what
 * the vault contains while showing all three answers on one screen.
 */
export interface Documents {
  readonly index: LinkIndex;
  /** The other names documents answer to. */
  readonly aliases: AliasIndex;
  /**
   * The aliases as their documents spelled them.
   *
   * `aliases` is keyed lowercase because that is how a link is matched;
   * completing from those keys offered "b90" to somebody who had named it
   * "B90" and wrote that into their note. What is suggested has to be what
   * was chosen.
   */
  readonly aliasNames: readonly string[];
  /** `section:id` -> the document's first written line, for an embed. */
  readonly excerpt: ReadonlyMap<string, string>;
}

let cache: { at: number; docs: Documents } | null = null;
const CACHE_MS = 30_000;

/**
 * The load in flight, so concurrent askers share one.
 *
 * This mattered the moment something other than the editor asked. One
 * note has one editor, so "check the cache, else fetch" could not overlap
 * with itself; a move list draws a link per comment and they all ask in
 * the same tick, which without this is three API calls per comment on the
 * page. The cache is filled by whichever load finishes; the promise is
 * what keeps there being only one.
 */
let loading: Promise<Documents> | null = null;

const listeners = new Set<() => void>();

/** What is already here, for a synchronous render. */
export const docsNow = (): Documents | null =>
  cache && Date.now() - cache.at < CACHE_MS ? cache.docs : null;

/** Told when the index lands, so a rendered link can restate itself. */
export function subscribeDocs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function documents(): Promise<Documents> {
  const fresh = docsNow();
  if (fresh) return fresh;
  if (loading) return loading;
  loading = load().finally(() => {
    loading = null;
  });
  return loading;
}

async function load(): Promise<Documents> {
  const excerpt = new Map<string, string>();
  const spelled: string[] = [];
  const aliasEntries: (readonly [LinkSection, Map<string, string[]>])[] = [];
  const entries = await Promise.all(
    LINK_SECTIONS.map(async (section) => {
      try {
        const { studies } = await api<
          { studies: { id: string; excerpt?: string | null; aliases?: string[] }[] }
        >(SECTION_URL[section]);
        for (const s of studies) {
          if (s.excerpt) excerpt.set(`${section}:${s.id}`, s.excerpt);
          for (const name of s.aliases ?? []) spelled.push(name);
        }
        // Built by the shared rule, not by one written here: this listing
        // arrives sorted newest-first while the server walks a directory,
        // so anything decided by "whichever came first" answers differently
        // on the two sides. It did.
        aliasEntries.push([section, buildAliasMap(studies)]);
        return [section, studies.map((s) => s.id)] as const;
      } catch {
        aliasEntries.push([section, new Map()]);
        return [section, []] as const; // unreachable section — the others still answer
      }
    }),
  );
  const aliases = Object.fromEntries(aliasEntries) as unknown as AliasIndex;
  const docs: Documents = {
    index: Object.fromEntries(entries) as unknown as LinkIndex,
    aliases,
    // Only the names one document alone claims: completing a contested
    // alias would write a link that resolves to nothing.
    aliasNames: [
      ...new Set(
        spelled.filter((name) =>
          LINK_SECTIONS.some((sec) => aliases[sec].get(name.trim().toLowerCase())?.length === 1),
        ),
      ),
    ],
    excerpt,
  };
  cache = { at: Date.now(), docs };
  for (const fn of listeners) fn();
  return docs;
}

/** Every name a link can be written as, in resolution order. */
export async function allTargets(): Promise<string[]> {
  const docs = await documents();
  // Ids first, then the names documents chose for themselves. An alias is
  // typed as itself and resolves as itself, so it belongs in the list that
  // completes what is being typed — otherwise the one name a writer is
  // most likely to reach for is the one the suggester cannot offer. A
  // contested alias is left out: completing it would write a link that
  // resolves to nothing.
  return [...LINK_SECTIONS.flatMap((section) => docs.index[section]), ...docs.aliasNames];
}

/**
 * What a link is: a document, or one of the two ways of naming none.
 *
 * `unknown` is not a failure — it is "the index has not arrived yet", and
 * it renders as an ordinary link. The alternative is every link on the
 * page flashing as broken for as long as the first fetch takes, which
 * would train the reader to ignore the colour that is supposed to mean
 * something.
 */
export type LinkState = 'ok' | 'broken' | 'ambiguous' | 'unknown';

export function stateOf(target: string, docs: Documents | null): LinkState {
  if (!docs) return 'unknown';
  const hit = resolveWikiLink(target, docs.index, docs.aliases);
  return typeof hit === 'string' ? hit : 'ok';
}

/** What the unresolved-link dialog draws. Replaced whole, never mutated. */
export interface UnresolvedSnapshot {
  readonly target: string;
  readonly why: 'broken' | 'ambiguous';
  readonly candidates: readonly ResolvedLink[];
}

export interface UnresolvedStore {
  subscribe(fn: () => void): () => void;
  snapshot(): UnresolvedSnapshot | null;
  show(target: string, why: 'broken' | 'ambiguous', candidates: ResolvedLink[]): void;
  close(): void;
}

/**
 * One store for the whole app, and one dialog mounted on the shell.
 *
 * The suggester is per-editor because two editors on a page would want two
 * popups and StrictMode alone mounts two. This is the opposite case: it is
 * a modal, so only one can ever be open, and the links that raise it are
 * no longer all inside an editor — a link in a move comment has no editor
 * to borrow one from. Module scope is what lets any of them ask.
 */
function createUnresolvedStore(): UnresolvedStore {
  const subs = new Set<() => void>();
  let state: UnresolvedSnapshot | null = null;
  const emit = (next: UnresolvedSnapshot | null): void => {
    state = next;
    for (const fn of subs) fn();
  };
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    snapshot: () => state,
    show: (target, why, candidates) => emit({ target, why, candidates }),
    close: () => emit(null),
  };
}

export const wikiUnresolved: UnresolvedStore = createUnresolvedStore();

/**
 * Follow a link.
 *
 * A link that names nothing used to do nothing at all when pressed, and
 * say so only to the console. Pressing something and getting silence is a
 * dead end; both failures have an answer the reader can act on, so they
 * are asked rather than ignored — which document did you mean, or shall
 * this note be made.
 */
export async function resolveAndOpen(target: string): Promise<void> {
  const docs = await documents();
  const hit = resolveWikiLink(target, docs.index, docs.aliases);
  if (typeof hit === 'string') {
    wikiUnresolved.show(target, hit, wikiLinkCandidates(target, docs.index, docs.aliases));
    return;
  }
  navigate(hit.section, encodeURIComponent(hit.id));
}
