import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import { navigate } from '@/lib/router';

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

const WIKI_RE = /\[\[([^[\]]+)\]\]/g;

function pick(view: { state: any; dispatch: (tr: any) => void }, id: string): void {
  if (!suggest.range) return;
  const { from, to } = suggest.range;
  view.dispatch(view.state.tr.insertText(`${id}]]`, from, to));
  suggest.hide();
}

async function resolveAndOpen(target: string): Promise<void> {
  const wanted = target.trim().toLowerCase();
  const sections = [
    { section: 'notes', url: '/api/notes' },
    { section: 'studies', url: '/api/studies' },
    { section: 'games', url: '/api/games/docs' },
  ] as const;
  for (const { section, url } of sections) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const { studies } = (await res.json()) as { studies: { id: string }[] };
      const ids = studies.map((s) => s.id);
      const exact = ids.find((id) => id.toLowerCase() === wanted);
      if (exact) {
        navigate(section, encodeURIComponent(exact));
        return;
      }
      const tails = ids.filter((id) => id.split('/').at(-1)!.toLowerCase() === wanted);
      if (tails.length === 1) {
        navigate(section, encodeURIComponent(tails[0]!));
        return;
      }
    } catch {
      // unreachable section — keep trying the others
    }
  }
  console.warn(`[wiki-link] no note, study or game named "${target}"`);
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
          title: 'Ctrl+click to open',
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

// --- [[ autocomplete -------------------------------------------------------

let targetCache: { at: number; items: string[] } | null = null;
async function allTargets(): Promise<string[]> {
  if (targetCache && Date.now() - targetCache.at < 30_000) return targetCache.items;
  const items: string[] = [];
  for (const url of ['/api/notes', '/api/studies', '/api/games/docs']) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const { studies } = (await res.json()) as { studies: { id: string }[] };
      items.push(...studies.map((s) => s.id));
    } catch {
      // section unreachable
    }
  }
  targetCache = { at: Date.now(), items };
  return items;
}

const suggest = {
  el: null as HTMLDivElement | null,
  items: [] as string[],
  index: 0,
  range: null as { from: number; to: number } | null,
  hide() {
    this.el?.remove();
    this.el = null;
    this.range = null;
  },
};

export const WikiLink = Extension.create({
  name: 'wikiLink',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        state: {
          init: (_config, state) => decorate(state.doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        view: () => ({
          update: (view) => {
            
            if (!view.editable || !view.state.selection.empty) return suggest.hide();
            const { $from } = view.state.selection;
            const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
            const match = /\[\[([^[\]]*)$/.exec(before);
            if (!match) return suggest.hide();
            const query = match[1]!.toLowerCase();
            const cursor = view.state.selection.from;
            suggest.range = { from: cursor - match[1]!.length, to: cursor };
            void allTargets().then((all) => {
              if (!suggest.range) return;
              suggest.items = all
                .filter((id) => id.toLowerCase().includes(query))
                .slice(0, 8);
              suggest.index = Math.min(suggest.index, Math.max(0, suggest.items.length - 1));
              if (suggest.items.length === 0) return suggest.hide();
              if (!suggest.el) {
                suggest.el = document.createElement('div');
                suggest.el.className = 'wiki-suggest';
                document.body.appendChild(suggest.el);
              }
              const coords = view.coordsAtPos(cursor);
              suggest.el.style.left = `${Math.min(coords.left, innerWidth - 280)}px`;
              suggest.el.style.top = `${coords.bottom + 4}px`;
              suggest.el.innerHTML = '';
              suggest.items.forEach((id, i) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = id;
                if (i === suggest.index) b.className = 'active';
                b.onmousedown = (e) => {
                  e.preventDefault();
                  pick(view, id);
                };
                suggest.el!.appendChild(b);
              });
            });
          },
          destroy: () => suggest.hide(),
        }),
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleKeyDown(view, event) {
            if (!suggest.el || !suggest.range) return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              suggest.index =
                (suggest.index + (event.key === 'ArrowDown' ? 1 : suggest.items.length - 1)) %
                suggest.items.length;
              [...suggest.el.children].forEach((c, i) =>
                c.classList.toggle('active', i === suggest.index),
              );
              return true;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const id = suggest.items[suggest.index];
              if (id) pick(view, id);
              return true;
            }
            if (event.key === 'Escape') {
              suggest.hide();
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
