import { Bold, Code, Heading1, Heading2, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { KnightIcon } from '@/components/knight-icon';
import { t } from '@/lib/i18n';

/**
 * The note formatting palette: one row, pinned to the top of the note
 * while it is being edited.
 *
 * It was tried the other two ways first. Floating over the selection meant
 * dragging across text you did not want to change before you could insert
 * anything. Pinned above the keyboard meant sitting on iOS's own accessory
 * row, with the caret ending up behind the bar.
 *
 * A toolbar above the document is in one place, is there before you have
 * selected anything, and never argues with the keyboard, the selection
 * callout or the caret. It is further from the thumbs on a phone, which is
 * a smaller price than a palette you have to fight.
 */

interface Action {
  id: string;
  icon: typeof Bold | typeof KnightIcon;
  label: string;
  /**
   * The keyboard's own way to this, named in the tip. Every one of these
   * worked before (StarterKit's bindings, and "/board" typed on a line);
   * nothing on the screen said so, which left a keyboard user with ten
   * buttons that did nothing and no hint of the route that did.
   */
  keys: string;
  run: (editor: Editor) => void;
  active: (editor: Editor) => boolean;
}

const ACTIONS: Action[] = [
  {
    id: 'board',
    // A knight, not a grid. Every grid icon in this app means a grid, and
    // a stranger reading a toolbar full of text formatting would take one
    // here for "insert table" — which is the one thing it is not.
    //
    // First, not last: the one thing this palette does that no text
    // editor's does, and the row scrolls on a phone (ten buttons in 358px
    // at 390 wide showed 16px of the knight; at 320 wide none of it, nor
    // the quote). What is cut off at the end is now a text style the
    // markdown shortcut also reaches.
    icon: KnightIcon,
    label: 'Insert a board',
    keys: 'or type /board on a new line',
    run: (e) => e.chain().focus().insertChessBlock().run(),
    active: (e) => e.isActive('chessBlock'),
  },
  {
    id: 'bold',
    icon: Bold,
    label: 'Bold',
    keys: 'Ctrl/⌘ B',
    run: (e) => e.chain().focus().toggleBold().run(),
    active: (e) => e.isActive('bold'),
  },
  {
    id: 'italic',
    icon: Italic,
    label: 'Italic',
    keys: 'Ctrl/⌘ I',
    run: (e) => e.chain().focus().toggleItalic().run(),
    active: (e) => e.isActive('italic'),
  },
  {
    id: 'strike',
    icon: Strikethrough,
    label: 'Strikethrough',
    keys: 'Ctrl/⌘ Shift S',
    run: (e) => e.chain().focus().toggleStrike().run(),
    active: (e) => e.isActive('strike'),
  },
  {
    id: 'code',
    icon: Code,
    label: 'Code',
    keys: 'Ctrl/⌘ E',
    run: (e) => e.chain().focus().toggleCode().run(),
    active: (e) => e.isActive('code'),
  },
  {
    id: 'h1',
    icon: Heading1,
    label: 'Heading',
    keys: 'Ctrl/⌘ Alt 1',
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    active: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'h2',
    icon: Heading2,
    label: 'Subheading',
    keys: 'Ctrl/⌘ Alt 2',
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'bullet',
    icon: List,
    label: 'Bulleted list',
    keys: 'Ctrl/⌘ Shift 8',
    run: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  {
    id: 'ordered',
    icon: ListOrdered,
    label: 'Numbered list',
    keys: 'Ctrl/⌘ Shift 7',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  {
    id: 'quote',
    icon: Quote,
    label: 'Quote',
    keys: 'Ctrl/⌘ Shift B',
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    active: (e) => e.isActive('blockquote'),
  },
];

export function EditorPalette({
  editor,
  editable,
}: {
  editor: Editor | null;
  /**
   * Passed in rather than read off the editor: `setEditable` does not
   * raise a transaction, so a palette watching only the editor stayed
   * hidden until something else happened to fire one — which looked like
   * it took seconds to appear.
   */
  editable: boolean;
}) {
  // Redraw as the caret moves, so the buttons show what it is inside.
  const [, bump] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const redraw = (): void => bump((n) => n + 1);
    editor.on('selectionUpdate', redraw);
    editor.on('transaction', redraw);
    return () => {
      editor.off('selectionUpdate', redraw);
      editor.off('transaction', redraw);
    };
  }, [editor]);

  if (!editor || !editable) return null;

  return (
    <div
      // sticky: it stays at the top of the note as the note scrolls under
      // it. Ten buttons do not fit a phone, so the row scrolls sideways —
      // the same rule the filter chips follow.
      // Pinned by the header wrapper this sits inside, not by itself, and
      // the rule under it belongs to that wrapper so it spans the pinned
      // strip rather than stopping at the text column's edge.
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto scrollbar-hidden"
      role="toolbar"
      aria-label={t('Formatting')}
    >
      {ACTIONS.map((action) => {
        const on = action.active(editor);
        // Key names read the same in both languages; the one hint that is
        // a sentence is translated.
        const keys = action.id === 'board' ? t('or type /board on a new line') : action.keys;
        return (
          <Button
            key={action.id}
            variant="ghost"
            size="icon-sm"
            active={on}
            title={`${t(action.label)} (${keys})`}
            aria-label={t(action.label)}
            aria-pressed={on}
            // The press is refused before it can take focus from the
            // editor, or the command would land on no selection; the
            // command itself runs on click, which is what Enter and Space
            // raise on a button. It ran on pointerdown, and a keyboard
            // never sends one: ten Tab stops that did nothing.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => action.run(editor)}
          >
            <action.icon className="size-4" />
          </Button>
        );
      })}
    </div>
  );
}
