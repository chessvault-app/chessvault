import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the undo stands before the deletion actually happens. */
const GRACE_MS = 4500;

export interface Undoable {
  /** What was removed, for the message: "Removed “x”". */
  label: string;
  undo: () => void;
}

/**
 * Remove now, ask never, undo for a few seconds.
 *
 * The confirmation dialog was protecting the wrong moment. It interrupts
 * every deletion — including the many that are deliberate — to guard
 * against the rare one that was a slip, and it cannot help at all once you
 * have answered it. This inverts that: the row disappears immediately, and
 * the request that would make it permanent is held back until the undo
 * expires. Undoing means the vault was never touched.
 *
 * A pending deletion is flushed if the page is being left, because a
 * promise to delete that never runs is a file that quietly came back.
 */
export function useUndoable(): {
  pending: Undoable | null;
  /** `commit` runs when the grace period ends; `undo` puts the row back. */
  remove: (label: string, commit: () => void, undo?: () => void) => void;
  undo: () => void;
} {
  const [pending, setPending] = useState<Undoable | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<(() => void) | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    commitRef.current?.();
    commitRef.current = null;
    setPending(null);
  }, []);

  useEffect(() => {
    const onLeave = (): void => {
      // Not a place to be clever: the browser gives a page a moment on
      // pagehide, and a fetch already in flight is the caller's business.
      commitRef.current?.();
      commitRef.current = null;
    };
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      onLeave();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const remove = useCallback(
    (label: string, commit: () => void, undo?: () => void) => {
      // A second removal while one is pending commits the first: two undos
      // at once could only be one button, and it would be ambiguous.
      flush();
      commitRef.current = commit;
      setPending({
        label,
        undo: () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          commitRef.current = null;
          setPending(null);
          undo?.();
        },
      });
      timer.current = setTimeout(flush, GRACE_MS);
    },
    [flush],
  );

  return { pending, remove, undo: () => pending?.undo() };
}
