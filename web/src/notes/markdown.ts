import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import MarkdownIt from 'markdown-it';
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
  type MarkdownSerializerState,
} from 'prosemirror-markdown';
import type { Node as PmNode, Schema } from '@tiptap/pm/model';
import { ChessBlock } from './ChessBlock';
import { WikiLink } from './wikiLink';

/**
 * Notes are plain markdown on disk. Boards are fenced code blocks with the
 * `chess` info string and a PGN body:
 *
 *     ```chess
 *     [FEN "..."]            (optional — omitted for the standard start)
 *     1. e4 c5 (1... e5) *
 *     ```
 *
 * Any markdown tool shows them as code; this app shows them as boards. The
 * PGN body goes through the same lossless codec as studies, so a note board
 * carries full trees, comments and arrows without a second format.
 */

export const noteExtensions = [
  StarterKit.configure({
    // Markdown has no underline; keep the schema serialisable.
    underline: false,
    // Links in notes are typed as markdown and parsed on load.
    link: { openOnClick: false },
  }),
  ChessBlock,
  WikiLink,
];

const noteSchema: Schema = getSchema(noteExtensions);

// --- markdown -> ProseMirror -------------------------------------------------

const md = new MarkdownIt('commonmark', { html: false });
md.enable('strikethrough');
// Rename ```chess fences to their own token type so the parser can map them
// to chessBlock nodes while ordinary fences stay code blocks.
md.core.ruler.push('chess_fence', (state) => {
  for (const token of state.tokens) {
    if (token.type === 'fence' && token.info.trim() === 'chess') token.type = 'chess_block';
  }
});

const parser = new MarkdownParser(noteSchema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'listItem' },
  bullet_list: { block: 'bulletList' },
  ordered_list: {
    block: 'orderedList',
    getAttrs: (tok) => ({ start: Number(tok.attrGet('start') ?? 1) }),
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) }) },
  code_block: { block: 'codeBlock', noCloseToken: true },
  fence: {
    block: 'codeBlock',
    getAttrs: (tok) => ({ language: tok.info.trim() || null }),
    noCloseToken: true,
  },
  chess_block: {
    node: 'chessBlock',
    getAttrs: (tok) => ({ pgn: tok.content.trim() }),
    noCloseToken: true,
  },
  hr: { node: 'horizontalRule' },
  hardbreak: { node: 'hardBreak' },
  em: { mark: 'italic' },
  strong: { mark: 'bold' },
  s: { mark: 'strike' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') ?? null }),
  },
  code_inline: { mark: 'code', noCloseToken: true },
});

/**
 * A leading `---` block, and the note after it.
 *
 * Front matter is not markdown, and CommonMark has never pretended it is:
 * `---` opens a horizontal rule, and the `tags: …` line under it becomes a
 * setext heading underlined by the closing `---`. So a note written in
 * Obsidian and opened here came back with its front matter turned into a
 * rule and an H2 — and the next autosave wrote that to disk. The metadata
 * was gone, silently, from opening the note and touching nothing.
 *
 * It is kept out of the document entirely rather than modelled as a node:
 * it is metadata about the note, not part of what somebody is writing, and
 * a block nobody can edit is better than one that can be half-deleted.
 *
 * The ambiguity with a document that genuinely opens on a horizontal rule
 * is resolved the way every other markdown tool resolves it — in favour of
 * front matter.
 */
const FRONT_MATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(markdown: string): { front: string; body: string } {
  const found = FRONT_MATTER.exec(markdown);
  if (!found) return { front: '', body: markdown };
  return { front: found[0], body: markdown.slice(found[0].length) };
}

export function markdownToDoc(markdown: string): PmNode {
  return parser.parse(splitFrontMatter(markdown).body);
}

// --- ProseMirror -> markdown -------------------------------------------------

const base = defaultMarkdownSerializer;

const serializer = new MarkdownSerializer(
  {
    text: base.nodes.text!,
    paragraph: base.nodes.paragraph!,
    heading: base.nodes.heading!,
    blockquote: base.nodes.blockquote!,
    horizontalRule: base.nodes.horizontal_rule!,
    hardBreak: base.nodes.hard_break!,
    bulletList: base.nodes.bullet_list!,
    listItem: base.nodes.list_item!,
    orderedList: (state: MarkdownSerializerState, node: PmNode) => {
      const start = (node.attrs.start as number) || 1;
      const maxW = String(start + node.childCount - 1).length;
      const space = ' '.repeat(maxW + 2);
      state.renderList(node, space, (i) => {
        const nStr = String(start + i);
        return `${' '.repeat(maxW - nStr.length) + nStr}. `;
      });
    },
    codeBlock: (state: MarkdownSerializerState, node: PmNode) => {
      const lang = (node.attrs.language as string | null) ?? '';
      state.write(`\`\`\`${lang}\n`);
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },
    chessBlock: (state: MarkdownSerializerState, node: PmNode) => {
      state.write('```chess\n');
      state.text(String(node.attrs.pgn ?? '').trim(), false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },
  },
  {
    bold: base.marks.strong!,
    italic: base.marks.em!,
    code: base.marks.code!,
    link: base.marks.link!,
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  },
);

/** `front` is what splitFrontMatter took off, put back verbatim. */
export function docToMarkdown(doc: PmNode, front = ''): string {
  // prosemirror-markdown escapes [ ] defensively; wiki links must stay
  // literal [[...]] on disk (backlinks scan them, Obsidian reads them).
  const body = `${serializer.serialize(doc).trimEnd()}\n`.replace(
    /\\\[\\\[([^[\]]+)\\\]\\\]/g,
    '[[$1]]',
  );
  return front.trim() ? `${front.trimEnd()}\n\n${body}` : body;
}
