import { Bold, Code, Heading1, Heading2, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/cn';
import { KnightIcon } from '@/ui/KnightIcon';
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
  run: (editor: Editor) => void;
  active: (editor: Editor) => boolean;
}

const ACTIONS: Action[] = [
  {
    id: 'bold',
    icon: Bold,
    label: 'Bold',
    run: (e) => e.chain().focus().toggleBold().run(),
    active: (e) => e.isActive('bold'),
  },
  {
    id: 'italic',
    icon: Italic,
    label: 'Italic',
    run: (e) => e.chain().focus().toggleItalic().run(),
    active: (e) => e.isActive('italic'),
  },
  {
    id: 'strike',
    icon: Strikethrough,
    label: 'Strikethrough',
    run: (e) => e.chain().focus().toggleStrike().run(),
    active: (e) => e.isActive('strike'),
  },
  {
    id: 'code',
    icon: Code,
    label: 'Code',
    run: (e) => e.chain().focus().toggleCode().run(),
    active: (e) => e.isActive('code'),
  },
  {
    id: 'h1',
    icon: Heading1,
    label: 'Heading',
    run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    active: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    id: 'h2',
    icon: Heading2,
    label: 'Subheading',
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    id: 'bullet',
    icon: List,
    label: 'Bulleted list',
    run: (e) => e.chain().focus().toggleBulletList().run(),
    active: (e) => e.isActive('bulletList'),
  },
  {
    id: 'ordered',
    icon: ListOrdered,
    label: 'Numbered list',
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    active: (e) => e.isActive('orderedList'),
  },
  {
    id: 'quote',
    icon: Quote,
    label: 'Quote',
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    active: (e) => e.isActive('blockquote'),
  },
  {
    id: 'board',
    // A knight, not a grid. Every grid icon in this app means a grid, and
    // a stranger reading a toolbar full of text formatting would take one
    // here for "insert table" — which is the one thing it is not.
    icon: KnightIcon,
    label: 'Insert a board',
    run: (e) => e.chain().focus().insertChessBlock().run(),
    active: (e) => e.isActive('chessBlock'),
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
        return (
          <button
            key={action.id}
            type="button"
            title={action.label}
            aria-label={action.label}
            aria-pressed={on}
            // pointerdown, not click: clicking blurs the editor first and
            // the command would land on no selection.
            onPointerDown={(e) => {
              e.preventDefault();
              action.run(editor);
            }}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-100 pointer-coarse:size-9',
              on ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <action.icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
