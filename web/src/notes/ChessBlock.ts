import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ChessBlockView } from './ChessBlockView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chessBlock: {
      /** Insert an interactive board at the cursor (standard start position). */
      insertChessBlock: () => ReturnType;
    };
  }
}

/**
 * A board embedded in a note. The only attribute is a PGN string — the same
 * lossless dialect studies use — which serialises to a ```chess fence in the
 * markdown file.
 */
export const ChessBlock = Node.create({
  name: 'chessBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return { pgn: { default: '*' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-chess-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-chess-block': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChessBlockView);
  },

  addCommands() {
    return {
      insertChessBlock:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { pgn: '*' } }),
    };
  },

  addInputRules() {
    // Typed, not only pressed: "/board" at the start of a line becomes a
    // board the moment the word completes, so the hands never have to
    // leave the keyboard for the toolbar's knight.
    return [
      nodeInputRule({
        find: /^\/board$/,
        type: this.type,
        getAttributes: () => ({ pgn: '*' }),
      }),
    ];
  },
});
