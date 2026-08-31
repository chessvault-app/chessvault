import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/react';
import { t } from '@/lib/i18n';
import { WIKI_RE, parseWikiMatch, resolveWikiLink } from '@shared/wikiLinks';
import {
  PENDING_LINK,
  SUGGEST_LIMIT,
  createSuggestStore,
  type OwnedSuggestStore,
  type SuggestStore,
} from './suggestStore';
import {
  allTargets,
  docsNow,
  documents,
  resolveAndOpen,
  stateOf,
  subscribeDocs,
  type Documents,
  type LinkState,
} from './wikiDocs';

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

/** Transaction meta saying "the index landed, draw the links again". */
const RE_INDEX = 'wikiLink:reindex';

/** Transaction meta carrying the view's editability into plugin state. */
const EDITABLE = 'wikiLink:editable';

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

function decorate(doc: PmNode, docs: Documents | null, editable: boolean): DecorationSet {
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
          Decoration.widget(to, () => embedCard(target, state), { side: 1 }),
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
            set: decorate(state.doc, docsNow(), false),
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
            return { set: decorate(tr.doc, docsNow(), editable), editable };
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
          /**
           * And again whenever it is rebuilt, by whoever rebuilt it.
           *
           * The index is cached for thirty seconds. A note left open past
           * that has a COLD cache, which decorates as `unknown` — every
           * link on the page provisional, the broken ones no longer saying
           * so — and the one dispatch above has already been and gone, so
           * nothing asks again. That was invisible while the editor was
           * the only reader. It is not now: a comment refreshes itself, so
           * the same link could be dotted in the move list and plain in
           * the note beside it. The reload below is what makes the cache
           * cold-start again; the subscription is how this view hears
           * about it, whether it asked or a comment did.
           */
          const heard = subscribeDocs(() => {
            if (alive) view.dispatch(view.state.tr.setMeta(RE_INDEX, true));
          });
          return {
            update: (view) => {
              // A cold cache is reloaded here rather than inside `decorate`,
              // which builds decorations from a document and must stay a
              // function of it. Deduped by the promise in wikiDocs, so the
              // keystrokes that follow do not each start a fetch.
              if (!docsNow()) void documents();
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
              const match = PENDING_LINK.exec(before);
              if (!match) return suggest.close();
              const query = match[1]!.toLowerCase();
              const cursor = view.state.selection.from;
              const { left, top, right, bottom } = view.coordsAtPos(cursor);
              suggest.arm(
                (from, to, text) => view.dispatch(view.state.tr.insertText(text, from, to)),
                { from: cursor - match[1]!.length, to: cursor },
                query,
                // The caret's own line box, opening below it: a note is a
                // full page of prose, so the list follows the words.
                { left, top, right, bottom, side: 'bottom' },
              );
              void allTargets().then((all) => {
                // The count is of everything that matched, not of what is
                // shown: a list silently cut at eight looks like the whole
                // answer, so a writer whose document is ninth concludes it
                // is not there and stops typing.
                const hits = all.filter((id) => id.toLowerCase().includes(query));
                suggest.offer(query, hits.slice(0, SUGGEST_LIMIT), hits.length);
              });
            },
            destroy: () => {
              alive = false;
              heard();
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
