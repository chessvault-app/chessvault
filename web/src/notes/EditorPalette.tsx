import { Bold, Code, Grid3x3, Heading1, Heading2, Italic, List, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/cn';

/**
 * The note formatting palette, in the two places it can live.
 *
 * On a mouse it FLOATS over the selection: you have selected some words,
 * the actions belong next to them, and it goes away when you deselect.
 *
 * On touch it does NOT. The selection is exactly where the thumb and the
 * system's own Copy/Look Up callout are, the rectangle moves while the
 * keyboard animates, and this app has learned not to script anything
 * against that animation. So it becomes a bar pinned above the keyboard
 * for as long as the note is being edited — where Notion, Bear and iA
 * Writer all ended up, for the same reasons.
 *
 * One set of actions either way; only the placement is chosen. That is the
 * same shape the opening picker uses for its dropdown and its sheet.
 */

interface Action {
  id: string;
  icon: typeof Bold;
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
    icon: Grid3x3,
    label: 'Insert a board',
    run: (e) => e.chain().focus().insertChessBlock().run(),
    active: (e) => e.isActive('chessBlock'),
  },
];

function Buttons({ editor, tick }: { editor: Editor; tick: number }) {
  return (
    <>
      {ACTIONS.map((action) => {
        const on = tick >= 0 && action.active(editor);
        return (
          <button
            key={action.id}
            type="button"
            title={action.label}
            aria-label={action.label}
            aria-pressed={on}
            // pointerdown, not click: clicking would blur the editor first
            // and the command would apply to no selection.
            onPointerDown={(e) => {
              e.preventDefault();
              action.run(editor);
            }}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-md transition-colors duration-100 pointer-coarse:size-10',
              on ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <action.icon className="size-4" />
          </button>
        );
      })}
    </>
  );
}

export function EditorPalette({ editor }: { editor: Editor | null }) {
  const [coarse] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  // Re-render on every selection or document change, so the buttons show
  // what the caret is actually inside.
  const [tick, setTick] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  // How much of the window the keyboard covers, for the touch placement.
  const [covered, setCovered] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const bump = (): void => setTick((n) => n + 1);
    editor.on('selectionUpdate', bump);
    editor.on('transaction', bump);
    editor.on('focus', bump);
    editor.on('blur', bump);
    return () => {
      editor.off('selectionUpdate', bump);
      editor.off('transaction', bump);
      editor.off('focus', bump);
      editor.off('blur', bump);
    };
  }, [editor]);

  useEffect(() => {
    if (!coarse) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const measure = (): void =>
      setCovered(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, [coarse]);

  // Where the selection is, for the floating placement.
  useEffect(() => {
    if (coarse || !editor || !editor.isEditable) {
      setBox(null);
      return;
    }
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      setBox(null);
      return;
    }
    try {
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setBox({ left: (start.left + end.right) / 2, top: Math.min(start.top, end.top) });
    } catch {
      // Positions can be stale for a frame after a document change.
      setBox(null);
    }
  }, [coarse, editor, tick]);

  if (!editor || !editor.isEditable) return null;

  if (coarse) {
    // Only while the note is actually being typed into. With the keyboard
    // down this bar would sit exactly on the phone's navigation, and a
    // formatting row is no use when nothing has the caret anyway.
    if (!editor.isFocused) return null;
    return (
      <div
        // Above the keyboard, not above the selection. Sits at the bottom
        // of the visible viewport, which is where the keyboard leaves off.
        className="border-line bg-surface fixed inset-x-0 z-40 flex items-center gap-1 overflow-x-auto border-t px-2 py-1.5 scrollbar-hidden"
        style={{ bottom: covered }}
      >
        <Buttons editor={editor} tick={tick} />
      </div>
    );
  }

  if (!box) return null;
  return (
    <div
      className="border-line bg-surface fixed z-40 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border p-1 shadow-[var(--shadow-pop)]"
      style={{ left: box.left, top: box.top - 8 }}
    >
      <Buttons editor={editor} tick={tick} />
    </div>
  );
}
