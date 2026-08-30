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
  parseWikiMatch,
  resolveWikiLink,
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
  const aliasEntries: (readonly [LinkSection, Map<string, string>])[] = [];
  const entries = await Promise.all(
    LINK_SECTIONS.map(async (section) => {
      const aliases = new Map<string, string>();
      aliasEntries.push([section, aliases]);
      try {
        const { studies } = await api<
          { studies: { id: string; excerpt?: string | null; aliases?: string[] }[] }
        >(SECTION_URL[section]);
        for (const s of studies) {
          if (s.excerpt) excerpt.set(`${section}:${s.id}`, s.excerpt);
          // First writer wins, matching the server's index: a duplicated
          // alias must not let the later document steal the earlier one's
          // links on one side and not the other.
          for (const name of s.aliases ?? []) {
            const key = name.toLowerCase();
            if (!aliases.has(key)) aliases.set(key, s.id);
          }
        }
        return [section, studies.map((s) => s.id)] as const;
      } catch {
        return [section, []] as const; // unreachable section — the others still answer
      }
    }),
  );
  const docs = {
    index: Object.fromEntries(entries) as unknown as LinkIndex,
    aliases: Object.fromEntries(aliasEntries) as unknown as AliasIndex,
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
async function resolveAndOpen(target: string): Promise<void> {
  const docs = await documents();
  const hit = resolveWikiLink(target, docs.index, docs.aliases);
  if (typeof hit === 'string') {
    // Still only a console warning: an unresolved link looks exactly like a
    // working one in the document, which is a real gap, but the fix belongs
    // on the decoration rather than here.
    console.warn(`[wiki-link] "${target}" is ${hit}`);
    return;
  }
  navigate(hit.section, encodeURIComponent(hit.id));
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
function embedCard(target: string, state: LinkState): HTMLElement {
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
  const open = (): void => void resolveAndOpen(target);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  return card;
}

function decorate(doc: PmNode, docs: Documents | null): DecorationSet {
  const decorations: Decoration[] = [];
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
          Decoration.widget(to, () => embedCard(target, state), { side: 1 }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * What a link OFFERS depends on which mode the note is in, and the
 * decorations above cannot say: they are built from the document, and
 * editability belongs to the view. So the two attributes that differ are
 * set here, after every render, from `view.editable` itself.
 *
 * Reading mode gets `role="link"` and a tab stop, which is the only way
 * to reach the wiki link without a mouse — the cross-link is the thing
 * the vault is FOR, and it was reachable by pointer alone. It gets the
 * global `:focus-visible` ring for free by being focusable at all.
 * Editing mode gets neither: a focusable span inside a contenteditable
 * puts every link in the editor's own tab order and drags the caret
 * around with it. That split matches the click contract already in
 * `handleClick` — a plain click follows only where a plain Tab does.
 */
function syncLinkAffordance(view: EditorView): void {
  const follows = !view.editable;
  const opens = t(follows ? 'Click to open' : 'Ctrl+click to open');
  for (const el of view.dom.querySelectorAll<HTMLElement>('.wiki-link')) {
    const state = (el.dataset.linkState ?? 'unknown') as LinkState;
    // A link that names nothing says so on hover, and is NOT offered as a
    // link: no role, no tab stop, because there is nothing to open and
    // announcing it as a link would be a promise the press cannot keep.
    const resolves = state === 'ok' || state === 'unknown';
    el.title = resolves
      ? opens
      : t(
          state === 'broken'
            ? 'Nothing in the vault is named this'
            : 'More than one document is named this',
        );
    if (follows && resolves) {
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
    } else {
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
    }
  }
}

// --- [[ autocomplete -------------------------------------------------------

/** Every id as one list, in resolution order, for the suggester. */
async function allTargets(): Promise<string[]> {
  const index = (await documents()).index;
  return LINK_SECTIONS.flatMap((section) => index[section]);
}

/**
 * What the popup draws. Replaced whole and never mutated, so a subscriber
 * can tell one snapshot from the next by identity alone.
 */
export interface SuggestSnapshot {
  readonly open: boolean;
  readonly items: readonly string[];
  readonly index: number;
  /** Where the caret is, in viewport coordinates: the popup's anchor. */
  readonly caret: { readonly left: number; readonly top: number; readonly bottom: number } | null;
}

const CLOSED: SuggestSnapshot = { open: false, items: [], index: 0, caret: null };

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
  offer(query: string, items: string[]): void;
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
    offer(forQuery, items) {
      if (forQuery !== query || !range) return;
      if (items.length === 0) return set(CLOSED);
      set({
        open: true,
        items,
        index: Math.min(state.index, items.length - 1),
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
}

/** The suggester behind `editor`, for the component that draws it. */
export function wikiSuggestStore(editor: Editor): SuggestStore {
  return (editor.storage as unknown as { wikiLink: WikiLinkStorage }).wikiLink.suggest;
}

export const WikiLink = Extension.create<Record<string, never>, WikiLinkStorage>({
  name: 'wikiLink',

  addStorage() {
    return { suggest: createSuggestStore() };
  },

  addProseMirrorPlugins() {
    const suggest = this.storage.suggest;
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        state: {
          init: (_config, state) => decorate(state.doc, docsNow()),
          // `reindex` is the arrival of the document index. Without it the
          // first paint's decorations — drawn before any fetch could
          // land — would stand until the next keystroke, so a note opened
          // and read without being touched would never show a broken link.
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(RE_INDEX) ? decorate(tr.doc, docsNow()) : old,
        },
        view: (view) => {
          syncLinkAffordance(view);
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
              syncLinkAffordance(view);
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
                suggest.offer(
                  query,
                  all.filter((id) => id.toLowerCase().includes(query)).slice(0, 8),
                );
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
            return this.getState(state);
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
              void resolveAndOpen(target);
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
            void resolveAndOpen(el.dataset.target);
            return true;
          },
        },
      }),
    ];
  },
});
