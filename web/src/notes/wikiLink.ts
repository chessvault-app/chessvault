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
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

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
        props: {
          decorations(state) {
            return this.getState(state);
          },
          handleClick(_view, _pos, event) {
            if (!event.ctrlKey && !event.metaKey) return false;
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
