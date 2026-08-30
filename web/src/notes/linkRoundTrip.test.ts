import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc } from './markdown';

/**
 * A wiki link must survive being opened and saved.
 *
 * prosemirror-markdown escapes `[` and `]` defensively, so a note that was
 * merely opened and autosaved came back with `\[\[Target\]\]` on disk —
 * which Obsidian shows as literal brackets and the backlink scan does not
 * match. `docToMarkdown` unescapes them again, and this is the guard on
 * that: every shape a link can take, in and back out unchanged.
 */
describe('wiki links survive the editor', () => {
  for (const md of [
    '[[Target]]',
    '[[Target|display]]',
    '![[Target]]',
    'a ![[T]] b',
    '[[a|b]] and [[c]]',
    '[[folder/Target|the short name]]',
  ]) {
    it(JSON.stringify(md), () => {
      expect(docToMarkdown(markdownToDoc(`${md}\n`)).trim()).toBe(md);
    });
  }
});
