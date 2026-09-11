import { splitFrontMatter } from './frontMatter.ts';

/**
 * A note's markdown as the words a reader would search for.
 *
 * The editor parses markdown into a document tree (web/src/notes/markdown.ts)
 * and would be the exact answer, but it is a ProseMirror schema and a set
 * of tiptap extensions, which a server indexing a vault has no use for.
 * What the search index needs is only the prose: headings without their
 * hashes, links and wiki links by their visible text, code as it was
 * typed, and none of the front matter, which holds aliases and tags a
 * search should not surface as body text.
 *
 * Kept in shared/ so the browser could build the same index over its own
 * copy of a note and get the same words, the way the wiki-link resolver is
 * shared between the editor and the backlink scan.
 */
export function markdownToText(markdown: string): string {
  const { body } = splitFrontMatter(markdown);
  return (
    body
      // A board is a ```chess fence holding PGN (web/src/notes/markdown.ts):
      // moves, not prose, so the whole block goes. Any other fence stays
      // as text and only its fence lines go.
      .replace(/^```chess[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '')
      .replace(/^```[^\n]*$/gm, '')
      // ![alt](src) -> alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // [[target|shown]] -> shown, [[target]] -> target
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      // [text](href) -> text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Heading hashes, quote bars, list bullets and rules at a line's start.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
      .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
      // Emphasis markers and inline code ticks.
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|[^\w*])\*(?=\S)/g, '$1')
      .replace(/(?<=\S)\*(?=[^\w*]|$)/g, '')
      // Whitespace collapses to what a snippet can show on one line.
      .replace(/[ \t]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .trim()
  );
}
