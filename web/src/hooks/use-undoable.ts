import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { announce } from '@/lib/announce';
import { t } from '@/lib/i18n';

/**
 * How long an undo is offered. Long enough to read a sentence and press a
 * button, short enough that a removal is not left hanging over the list
 * for somebody who has already moved on. Sonner pauses it while the
 * pointer or the keyboard focus is on the toast — a grace period that
 * expires under the cursor takes the button away mid-press, and a
 * screen-reader user needs longer than 4.5 s.
 */
const GRACE_MS = 4500;

/**
 * The undo that stands in for a confirmation.
 *
 * A removal happens at once on screen (the caller hides the row) and is
 * COMMITTED only when the offer expires: "Removed “x” · Undo" in shadcn's
 * toast (components/ui/sonner), undo puts the row back and nothing was
 * ever sent. Leaving the page commits — a removal that was shown must not
 * silently un-happen because the offer was still up.
 */
export function useUndoable(): {
  /**
   * `commit` runs when the offer expires; `undo` when it is taken. A second
   * removal while one is pending commits the first at once — the list is
   * already showing it gone, and two offers at once is a question with two
   * answers.
   */
  remove: (label: string, commit: () => void, undo?: () => void) => void;
} {
  const pending = useRef<{ id: string | number; commit: () => void } | null>(null);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    p.commit();
    toast.dismiss(p.id);
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      // Unmounting commits: the closure that knows how to delete belongs
      // to a page that is going, and an offer that outlives it could not
      // be honoured.
      flush();
    };
  }, [flush]);

  const remove = useCallback(
    (label: string, commit: () => void, undo?: () => void) => {
      flush();
      const message = t('Removed “{name}”', { name: label });
      announce(message);
      const entry = { id: 0 as string | number, commit };
      entry.id = toast(message, {
        duration: GRACE_MS,
        action: {
          label: t('Undo'),
          onClick: () => {
            if (pending.current === entry) pending.current = null;
            undo?.();
          },
        },
        // The offer expired unanswered: the removal is real now.
        onAutoClose: () => {
          if (pending.current !== entry) return;
          pending.current = null;
          commit();
        },
      });
      pending.current = entry;
    },
    [flush],
  );

  return { remove };
}
