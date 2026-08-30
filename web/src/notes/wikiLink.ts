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
  resolveWikiLink,
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

/** Every document id, in the shape the shared resolver wants. */
async function linkIndex(): Promise<LinkIndex> {
  const entries = await Promise.all(
    LINK_SECTIONS.map(async (section) => {
      try {
        const { studies } = await api<{ studies: { id: string }[] }>(SECTION_URL[section]);
        return [section, studies.map((s) => s.id)] as const;
      } catch {
        return [section, []] as const; // unreachable section — the others still answer
      }
    }),
  );
  return Object.fromEntries(entries) as unknown as LinkIndex;
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
  const hit = resolveWikiLink(target, await linkIndex());
  if (typeof hit === 'string') {
    // Still only a console warning: an unresolved link looks exactly like a
    // working one in the document, which is a real gap, but the fix belongs
    // on the decoration rather than here.
    console.warn(`[wiki-link] "${target}" is ${hit}`);
    return;
  }
  navigate(hit.section, encodeURIComponent(hit.id));
}

function decorate(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(WIKI_RE)) {
      const from = pos + match.index;
      decorations.push(
        Decoration.inline(from, from + match[0].length, {
          class: 'wiki-link',
          'data-target': match[1]!,
        }),
        // The brackets get their own spans so read mode can hide them.
        Decoration.inline(from, from + 2, { class: 'wiki-bracket' }),
        Decoration.inline(from + match[0].length - 2, from + match[0].length, {
          class: 'wiki-bracket',
        }),
      );
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
  const title = t(follows ? 'Click to open' : 'Ctrl+click to open');
  for (const el of view.dom.querySelectorAll<HTMLElement>('.wiki-link')) {
    el.title = title;
    if (follows) {
      el.setAttribute('role', 'link');
      el.tabIndex = 0;
    } else {
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
    }
  }
}

// --- [[ autocomplete -------------------------------------------------------

let targetCache: { at: number; items: string[] } | null = null;
async function allTargets(): Promise<string[]> {
  if (targetCache && Date.now() - targetCache.at < 30_000) return targetCache.items;
  const items: string[] = [];
  for (const url of ['/api/notes', '/api/studies', '/api/games/docs']) {
    try {
      const { studies } = await api<{ studies: { id: string }[] }>(url);
      items.push(...studies.map((s) => s.id));
    } catch {
      // section unreachable
    }
  }
  targetCache = { at: Date.now(), items };
  return items;
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
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        view: (view) => {
          syncLinkAffordance(view);
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
            destroy: () => suggest.close(),
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
