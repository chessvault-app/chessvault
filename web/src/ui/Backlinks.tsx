import { NotebookPen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';

/** "Linked from" chips: the notes whose [[wiki-links]] name this document. */
export function Backlinks({ target, className }: { target: string; className?: string }) {
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    setNotes([]);
    void fetch(`/api/backlinks?target=${encodeURIComponent(target)}`)
      .then((r) => r.json() as Promise<{ notes?: string[] }>)
      .then((d) => setNotes((d.notes ?? []).filter((id) => id !== target)))
      .catch(() => {});
  }, [target]);
  if (notes.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="text-subtle text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        Linked from
      </span>
      {notes.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => navigate('notes', encodeURIComponent(id))}
          className={cn(
            'bg-surface-2 hover:bg-surface-3 text-muted hover:text-fg inline-flex items-center',
            'gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] transition-colors',
          )}
        >
          <NotebookPen className="size-3" />
          {id}
        </button>
      ))}
    </div>
  );
}
