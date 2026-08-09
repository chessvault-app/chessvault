import { Folder as FolderIcon, CornerDownRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { Input } from './Input';

/**
 * The "Move to" popover shared by the notes and studies shelves: existing
 * collections as rows, plus an always-there input naming a NEW collection —
 * without it, a vault with no collections yet offered nothing but the
 * header (lanph3re's report). The move API mkdirs the target, so a new name
 * needs no separate create step.
 */
export function MoveToPopover({
  currentFolder,
  folders,
  triggerRef,
  onPick,
  onClose,
}: {
  currentFolder: string;
  folders: string[];
  /** The button that toggles this popover — its taps must not double-fire
      through the outside-dismiss. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** `''` targets the shelf root. */
  onPick: (target: string) => void;
  onClose: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    // Both mousedown AND touchstart (iOS taps on dead space never
    // synthesize mouse events for document listeners), and a dismissing
    // tap must only dismiss — not press the card behind the popover.
    const onDown = (e: MouseEvent | TouchEvent): void => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !triggerRef.current?.contains(t)) {
        onClose();
        if (e.type === 'touchstart') suppressNextClick();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, triggerRef]);

  const targets = ['', ...folders].filter((t) => t !== currentFolder);

  return (
    <div
      ref={pop}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'border-line bg-surface absolute right-3 top-full z-40 mt-1 w-56 rounded-lg border p-1',
        'shadow-[var(--shadow-pop)]',
      )}
    >
      <p className="text-subtle px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
        Move to
      </p>
      {targets.map((target) => (
        <button
          key={target || '(root)'}
          type="button"
          onClick={() => onPick(target)}
          className={cn(
            'hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5',
            'text-left text-xs transition-colors duration-100',
          )}
        >
          <FolderIcon className="text-subtle size-3" />
          {target || '(no collection)'}
        </button>
      ))}
      <div className="flex items-center gap-1 p-1">
        <Input
          inputSize="sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New collection…"
          className="min-w-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onPick(draft.trim().replace(/\//g, '-'));
          }}
        />
        <button
          type="button"
          title="Move into this new collection"
          disabled={!draft.trim()}
          onClick={() => draft.trim() && onPick(draft.trim().replace(/\//g, '-'))}
          className="text-subtle hover:text-fg disabled:opacity-40 grid size-7 shrink-0 place-items-center"
        >
          <CornerDownRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
