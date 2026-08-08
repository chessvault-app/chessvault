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

export const noteSchema: Schema = getSchema(noteExtensions);

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

export function markdownToDoc(markdown: string): PmNode {
  return parser.parse(markdown);
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

export function docToMarkdown(doc: PmNode): string {
  return `${serializer.serialize(doc).trimEnd()}\n`;
}
