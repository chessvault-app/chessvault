import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { navigate } from '@/lib/router';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import {
  LINK_SECTIONS,
  WIKI_RE,
  buildAliasMap,
  parseWikiMatch,
  resolveWikiLink,
  wikiLinkCandidates,
  type ResolvedLink,
  type AliasIndex,
  type LinkIndex,
  type LinkSection,
} from '@shared/wikiLinks';

/**
 * Obsidian-style wiki links: `[[Najdorf Mainlines]]` in a note is styled
 * as a link and Ctrl/Cmd+click opens the study, note or collection game
 * it names. Implemented as DECORATIONS over plain text — the markdown on
 * disk keeps the literal `[[...]]`, so notes stay portable (and readable
 * in Obsidian itself, per the vault's heritage).
 *
 * Resolution order: exact id, then unique last-segment match, each tried
 * across notes → studies → games. Case-insensitive.
 */

const SECTION_URL: Record<LinkSection, string> = {
  notes: '/api/notes',
  studies: '/api/studies',
  games: '/api/games/docs',
};

/**
 * Every document id, cached.
 *
 * One cache, three readers: the suggester's list, the click that follows a
 * link, and the decoration that says whether a link resolves at all. They
 * were two caches for a while — a flat list for the popup and a fresh
 * fetch per click — which is three chances to disagree about what the
 * vault contains while showing all three answers on one screen.
 */
interface Documents {
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

/** What is already here, for the synchronous decoration pass. */
const docsNow = (): Documents | null =>
  cache && Date.now() - cache.at < CACHE_MS ? cache.docs : null;



async function documents(): Promise<Documents> {
  const fresh = docsNow();
  if (fresh) return fresh;
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
  const docs = {
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
  return docs;
}

/**
 * Follow a link.
 *
 * The rule for WHICH document a target names is `resolveWikiLink`, shared
 * with the server's backlink index. It was written out longhand here once,
 * which was fine while this was the only side asking; the moment something
 * else had to answer the same question, one of the two was going to drift
 * and neither would report a fault. See shared/wikiLinks.
 */
async function resolveAndOpen(target: string, unresolved: UnresolvedStore): Promise<void> {
  const docs = await documents();
  const hit = resolveWikiLink(target, docs.index, docs.aliases);
  if (typeof hit === 'string') {
    // A link that names nothing used to do nothing at all when pressed, and
    // say so only to the console. Pressing something and getting silence is
    // a dead end; both failures have an answer the reader can act on, so
    // they are asked rather than ignored — which document did you mean, or
    // shall this note be made.
    unresolved.show(target, hit, wikiLinkCandidates(target, docs.index, docs.aliases));
    return;
  }
  navigate(hit.section, encodeURIComponent(hit.id));
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

function createUnresolvedStore(): UnresolvedStore {
  const listeners = new Set<() => void>();
  let state: UnresolvedSnapshot | null = null;
  const emit = (next: UnresolvedSnapshot | null): void => {
    state = next;
    for (const fn of listeners) fn();
  };
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    show: (target, why, candidates) => emit({ target, why, candidates }),
    close: () => emit(null),
  };
}

/**
 * What a link is: a document, or one of the two ways of naming none.
 *
 * `unknown` is not a failure — it is "the index has not arrived yet", and
 * it renders as an ordinary link. The alternative is every link in the
 * document flashing as broken for as long as the first fetch takes, which
 * would train the reader to ignore the colour that is supposed to mean
 * something.
 */
type LinkState = 'ok' | 'broken' | 'ambiguous' | 'unknown';

/** Transaction meta saying "the index landed, draw the links again". */
const RE_INDEX = 'wikiLink:reindex';

/** Transaction meta carrying the view's editability into plugin state. */
const EDITABLE = 'wikiLink:editable';

function stateOf(target: string, docs: Documents | null): LinkState {
  if (!docs) return 'unknown';
  const hit = resolveWikiLink(target, docs.index, docs.aliases);
  return typeof hit === 'string' ? hit : 'ok';
}

/**
 * The syntax read mode hides, so `[[Target|display]]` reads as `display`.
 *
 * Same trick the brackets have always used, extended: everything that is
 * notation rather than words gets its own span and is display:none while
 * the note is being read. The markdown on disk is untouched — which is the
 * whole point of doing this with decorations — so the note still says
 * `[[Target|display]]` in Obsidian and in git.
 */
const SYNTAX = 'wiki-syntax';

/**
 * An embed, drawn as a card.
 *
 * Obsidian transcludes: `![[Note]]` renders that note's whole content
 * where it stands. This shows the document's name and its first written
 * line instead, and says so by looking like a card rather than like the
 * page. Full transclusion means running the markdown pipeline — and, for a
 * study or a game, a board — inside a decoration, which is a rendering
 * engine rather than a link feature. A preview that is honestly a preview
 * beats one that is a broken imitation of the real thing.
 *
 * Plain DOM, no React: this is a ProseMirror widget, and mounting a React
 * root per embed to render two lines of text would put a second reconciler
 * inside the editor for no gain.
 */
function embedCard(target: string, state: LinkState, unresolved: UnresolvedStore): HTMLElement {
  const card = document.createElement('span');
  card.className = 'wiki-embed';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  // The widget sits inside a contenteditable, so the editor must be told
  // this is not text it owns; otherwise the caret walks into it.
  card.contentEditable = 'false';

  const name = document.createElement('span');
  name.className = 'wiki-embed-name';
  const docs = docsNow();
  const hit = docs ? resolveWikiLink(target, docs.index, docs.aliases) : null;
  const id = hit && typeof hit !== 'string' ? hit.id : target;
  name.textContent = id.split('/').at(-1)!;
  card.append(name);

  if (state !== 'ok') {
    card.classList.add('wiki-embed-empty');
    const why = document.createElement('span');
    why.className = 'wiki-embed-excerpt';
    why.textContent = t(
      state === 'ambiguous'
        ? 'More than one document is named this'
        : 'Nothing in the vault is named this',
    );
    card.append(why);
    return card;
  }

  // The excerpt, or failing that what kind of document this is. A study or
  // a game is usually a PGN with no prose in it at all, and a card holding
  // nothing but a name does not say what pressing it would open.
  const excerpt = hit && typeof hit !== 'string' ? docs?.excerpt.get(`${hit.section}:${hit.id}`) : null;
  const line = document.createElement('span');
  line.className = 'wiki-embed-excerpt';
  line.textContent =
    excerpt ??
    (hit && typeof hit !== 'string'
      ? t({ notes: 'Note', studies: 'Study', games: 'Game' }[hit.section])
      : '');
  if (line.textContent) card.append(line);
  const open = (): void => void resolveAndOpen(target, unresolved);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return card;
}

function decorate(
  doc: PmNode,
  docs: Documents | null,
  unresolved: UnresolvedStore,
  editable: boolean,
): DecorationSet {
  const decorations: Decoration[] = [];
  const follows = !editable;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(WIKI_RE)) {
      const { target, embed } = parseWikiMatch(match);
      const from = pos + match.index;
      const to = from + match[0].length;
      const state = stateOf(target, docs);
      const open = from + (embed ? 3 : 2); // past `[[` or `![[`
      decorations.push(
        Decoration.inline(from, to, {
          class: [
            'wiki-link',
            state === 'ok' || state === 'unknown' ? '' : `wiki-link-${state}`,
            embed ? 'wiki-embed-source' : '',
          ]
            .filter(Boolean)
            .join(' '),
          'data-target': target,
          'data-link-state': state,
          // What the link OFFERS travels with it, rather than being written
          // onto the DOM after the fact — see `affordanceFor` for what
          // "after the fact" cost.
          ...affordanceFor(state, follows),
        }),
        Decoration.inline(from, open, { class: SYNTAX }),
        Decoration.inline(to - 2, to, { class: SYNTAX }),
      );
      // `Target|` is notation too when a display text follows it.
      if (match[3] !== undefined) {
        decorations.push(
          Decoration.inline(open, open + target.length + 1, { class: SYNTAX }),
        );
      }
      // An embed's card. Always in the document, shown only while reading —
      // the same split the hidden syntax uses, and for the same reason:
      // `editable` belongs to the view and this is built from the doc.
      if (embed) {
        decorations.push(
          Decoration.widget(to, () => embedCard(target, state, unresolved), { side: 1 }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * What a link offers, from what it resolves to and which mode the note is
 * in.
 *
 * This used to be applied to the DOM after every view update, walking the
 * links and writing title/role/tabindex onto them. That is inside the
 * editor's contenteditable, which ProseMirror keeps a MutationObserver
 * over, so the write re-normalised the DOM selection, the browser fired
 * `selectionchange`, PM flushed and updated the view, and it ran again:
 * measured at 332,000 view updates from one keystroke, with the tab
 * unresponsive. Writing only on a change was not enough — the cycle is
 * driven by touching that DOM at all — and skipping the walk unless the
 * doc or mode moved broke reading mode instead, because the plugin view
 * exists before the decorations reach the DOM. Carrying it in the
 * decoration is what removes the question: ProseMirror renders it, and
 * nothing reaches in.
 *
 * Reading mode gets `role="link"` and a tab stop, the only way to reach a
 * wiki link without a mouse — the cross-link is the thing the vault is FOR,
 * and it was reachable by pointer alone. It gets the global
 * `:focus-visible` ring for free by being focusable at all. Editing mode
 * gets neither: a focusable span inside a contenteditable puts every link
 * in the editor's own tab order and drags the caret around with it. That
 * split matches the click contract in `handleClick` — a plain click
 * follows only where a plain Tab does.
 *
 * A link that names nothing says so on hover and is offered as a link in
 * NEITHER mode: there is nothing to open, and announcing it as a link
 * would be a promise the press cannot keep.
 */
function affordanceFor(state: LinkState, follows: boolean): Record<string, string> {
  if (state !== 'ok' && state !== 'unknown') {
    return {
      title: t(
        state === 'broken'
          ? 'Nothing in the vault is named this'
          : 'More than one document is named this',
      ),
    };
  }
  const title = t(follows ? 'Click to open' : 'Ctrl+click to open');
  return follows ? { title, role: 'link', tabindex: '0' } : { title };
}

// --- [[ autocomplete -------------------------------------------------------

/** Every name a link can be written as, in resolution order. */
async function allTargets(): Promise<string[]> {
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
 * What the popup draws. Replaced whole and never mutated, so a subscriber
 * can tell one snapshot from the next by identity alone.
 */
export interface SuggestSnapshot {
  readonly open: boolean;
  readonly items: readonly string[];
  readonly index: number;
  /** How many matched in all, so a shortened list can say it is one. */
  readonly total: number;
  /** Where the caret is, in viewport coordinates: the popup's anchor. */
  readonly caret: { readonly left: number; readonly top: number; readonly bottom: number } | null;
}

const CLOSED: SuggestSnapshot = { open: false, items: [], index: 0, total: 0, caret: null };

/**
 * The suggester's state, owned by the editor and read by React.
 *
 * The split follows what each side can actually do. Spotting `[[` behind
 * the caret, knowing where that caret sits on screen, and reaching the
 * arrow keys before the editor's own bindings do are things only a
 * ProseMirror plugin can do. Drawing an anchored, dismissible,
 * collision-aware layer is a thing the component library already does,
 * and did better than the hand-rolled div this replaced. So the plugin
 * keeps the knowledge and publishes it here; `WikiSuggest` subscribes.
 *
 * It lives in the extension's `storage` rather than at module scope,
 * which the DOM version used: one popup for however many editors are
 * mounted, and StrictMode alone mounts two.
 */
export interface SuggestStore {
  subscribe(fn: () => void): () => void;
  snapshot(): SuggestSnapshot;
  /** Replace the pending `[[query` with `id`, then close. */
  pick(id: string): void;
  close(): void;
}

/** The half the plugin drives. The component only ever sees `SuggestStore`. */
interface OwnedSuggestStore extends SuggestStore {
  /** Arm at the caret: from here, results for `query` may arrive. */
  arm(
    view: EditorView,
    range: { from: number; to: number },
    query: string,
    caret: SuggestSnapshot['caret'],
  ): void;
  /** Results for `query`, dropped if the typist has moved past it. */
  offer(query: string, items: string[], total: number): void;
  move(delta: number): void;
  /** Take the active item, if there is one; reports whether it did. */
  commit(): boolean;
}

function createSuggestStore(): OwnedSuggestStore {
  const listeners = new Set<() => void>();
  let state: SuggestSnapshot = CLOSED;
  let view: EditorView | null = null;
  let range: { from: number; to: number } | null = null;
  let query = '';

  function set(next: SuggestSnapshot): void {
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn();
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    arm(nextView, nextRange, nextQuery, caret) {
      view = nextView;
      range = nextRange;
      query = nextQuery;
      // The caret keeps moving while results are in flight; anchor to
      // where it is now, not to where the query was asked from.
      set(state.open ? { ...state, caret } : { ...CLOSED, caret });
    },
    offer(forQuery, items, total) {
      if (forQuery !== query || !range) return;
      if (items.length === 0) return set(CLOSED);
      set({
        open: true,
        items,
        index: Math.min(state.index, items.length - 1),
        total,
        caret: state.caret,
      });
    },
    move(delta) {
      if (!state.open) return;
      const n = state.items.length;
      set({ ...state, index: (state.index + delta + n) % n });
    },
    commit() {
      const id = state.items[state.index];
      if (!id) return false;
      this.pick(id);
      return true;
    },
    pick(id) {
      if (!view || !range) return;
      view.dispatch(view.state.tr.insertText(`${id}]]`, range.from, range.to));
      this.close();
    },
    close() {
      range = null;
      query = '';
      set(CLOSED);
    },
  };
}

export interface WikiLinkStorage {
  suggest: OwnedSuggestStore;
  unresolved: UnresolvedStore;
}

/** The unresolved-link dialog's state for `editor`. */
export function wikiUnresolvedStore(editor: Editor): UnresolvedStore {
  return (editor.storage as unknown as { wikiLink: WikiLinkStorage }).wikiLink.unresolved;
}

/** The suggester behind `editor`, for the component that draws it. */
export function wikiSuggestStore(editor: Editor): SuggestStore {
  return (editor.storage as unknown as { wikiLink: WikiLinkStorage }).wikiLink.suggest;
}

export const WikiLink = Extension.create<Record<string, never>, WikiLinkStorage>({
  name: 'wikiLink',

  addStorage() {
    return { suggest: createSuggestStore(), unresolved: createUnresolvedStore() };
  },

  addProseMirrorPlugins() {
    const suggest = this.storage.suggest;
    const unresolved = this.storage.unresolved;
    const key = new PluginKey<{ set: DecorationSet; editable: boolean }>('wikiLink');
    return [
      new Plugin({
        key,
        state: {
          // Editability lives in the VIEW, not in the state, and the
          // decorations now carry what it decides — so it arrives here as a
          // meta the view dispatches when it CHANGES. That is a transaction
          // per mode switch, where writing the attributes on afterwards was
          // a DOM write per update and a loop with the selection observer.
          init: (_config, state) => ({
            set: decorate(state.doc, docsNow(), unresolved, false),
            editable: false,
          }),
          // `reindex` is the arrival of the document index. Without it the
          // first paint's decorations — drawn before any fetch could
          // land — would stand until the next keystroke, so a note opened
          // and read without being touched would never show a broken link.
          apply: (tr, old) => {
            const next = tr.getMeta(EDITABLE) as boolean | undefined;
            const editable = next ?? old.editable;
            if (!tr.docChanged && !tr.getMeta(RE_INDEX) && editable === old.editable) return old;
            return { set: decorate(tr.doc, docsNow(), unresolved, editable), editable };
          },
        },
        view: (view) => {
          /**
           * Draw the links once the index is known.
           *
           * Guarded by `alive` rather than left to run: the fetch outlives
           * a note that is closed while it is in flight, and dispatching
           * into a destroyed view throws.
           */
          let alive = true;
          void documents().then(() => {
            if (alive) view.dispatch(view.state.tr.setMeta(RE_INDEX, true));
          });
          return {
            update: (view) => {
              // Only when it actually changed: a dispatch per update would
              // be a transaction per update, which is the loop this design
              // exists to avoid.
              const held = key.getState(view.state)?.editable;
              if (held !== undefined && held !== view.editable) {
                view.dispatch(view.state.tr.setMeta(EDITABLE, view.editable));
              }
              if (!view.editable || !view.state.selection.empty) return suggest.close();
              const { $from } = view.state.selection;
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
              const match = /\[\[([^[\]]*)$/.exec(before);
              if (!match) return suggest.close();
              const query = match[1]!.toLowerCase();
              const cursor = view.state.selection.from;
              const { left, top, bottom } = view.coordsAtPos(cursor);
              suggest.arm(
                view,
                { from: cursor - match[1]!.length, to: cursor },
                query,
                { left, top, bottom },
              );
              void allTargets().then((all) => {
                // The count is of everything that matched, not of what is
                // shown: a list silently cut at eight looks like the whole
                // answer, so a writer whose document is ninth concludes it
                // is not there and stops typing.
                const hits = all.filter((id) => id.toLowerCase().includes(query));
                suggest.offer(query, hits.slice(0, 8), hits.length);
              });
            },
            destroy: () => {
              alive = false;
              suggest.close();
            },
          };
        },
        props: {
          decorations(state) {
            return this.getState(state)?.set;
          },
          /* Enter follows the focused link, which is what Enter on a link
             does everywhere else.
             This is `handleDOMEvents` and not `handleKeyDown` below.
             ProseMirror classes keydown as an EDIT handler and skips every
             one of them while `editable` is false — and reading mode,
             where the links are what hold the tab stops, is exactly that
             state. Custom `handleDOMEvents` run before that test, so they
             are the only prop that hears a key in a note being read.
             `handleKeyDown` is still right for the [[ autocomplete, which
             only ever runs while typing. */
          handleDOMEvents: {
            keydown(view, event) {
              if (event.key !== 'Enter' || view.editable) return false;
              const el = event.target;
              if (!(el instanceof HTMLElement) || !el.classList.contains('wiki-link')) return false;
              const target = el.dataset.target;
              if (!target) return false;
              event.preventDefault();
              void resolveAndOpen(target, unresolved);
              return true;
            },
          },
          handleKeyDown(_view, event) {
            /* The list is on screen but focus is not in it — the caret is
               still in the document, which is the point of the thing. So
               the keys that drive the list are taken here, ahead of the
               editor's own bindings, and only while it is open. */
            if (!suggest.snapshot().open) return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              suggest.move(event.key === 'ArrowDown' ? 1 : -1);
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') return suggest.commit();
            if (event.key === 'Escape') {
              suggest.close();
              return true;
            }
            return false;
          },
          handleClick(view, _pos, event) {
            // Reading mode: plain click follows. Editing: Ctrl/Cmd+click.
            if (view.editable && !event.ctrlKey && !event.metaKey) return false;
            const el = (event.target as HTMLElement).closest?.('.wiki-link');
            if (!(el instanceof HTMLElement) || !el.dataset.target) return false;
            void resolveAndOpen(el.dataset.target, unresolved);
            return true;
          },
        },
      }),
    ];
  },
});
