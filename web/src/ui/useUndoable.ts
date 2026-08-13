import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the undo stands before the deletion actually happens. */
const GRACE_MS = 4500;

/**
 * How long the toast takes to leave, matching `.animate-sink`.
 *
 * It stays mounted for this long after it is finished with — a toast that
 * rose into place and then vanished between two frames read as a glitch
 * rather than as an end.
 */
const EXIT_MS = 160;

export interface Undoable {
  /** What was removed, for the message: "Removed “x”". */
  label: string;
  /** On its way out: still mounted, no longer offering anything. */
  leaving: boolean;
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
  /** Pointer or focus is ON the toast: stop the clock — a timer that runs
      out under the cursor takes the button away mid-press. */
  hold: () => void;
  /** …and wind it up again, in full, when they leave. */
  release: () => void;
} {
  const [pending, setPending] = useState<Undoable | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef<(() => void) | null>(null);
  // Which toast is on screen. A removal that arrives during another's exit
  // animation must not be cleared by that exit's timer.
  const generation = useRef(0);

  /** Start the toast leaving, and unmount it when it has. */
  const fade = useCallback(() => {
    const mine = generation.current;
    setPending((p) => (p && !p.leaving ? { ...p, leaving: true } : p));
    if (exit.current) clearTimeout(exit.current);
    exit.current = setTimeout(() => {
      setPending((p) => (generation.current === mine ? null : p));
    }, EXIT_MS);
  }, []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    commitRef.current?.();
    commitRef.current = null;
    fade();
  }, [fade]);

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
      if (exit.current) clearTimeout(exit.current);
    };
  }, []);

  const remove = useCallback(
    (label: string, commit: () => void, undo?: () => void) => {
      // A second removal while one is pending commits the first: two undos
      // at once could only be one button, and it would be ambiguous.
      flush();
      generation.current += 1;
      commitRef.current = commit;
      setPending({
        label,
        leaving: false,
        undo: () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          commitRef.current = null;
          fade();
          undo?.();
        },
      });
      timer.current = setTimeout(flush, GRACE_MS);
    },
    [flush, fade],
  );

  const hold = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const release = useCallback(() => {
    // Only if there is still something to commit — releasing after the
    // undo was pressed must not resurrect the deletion.
    if (commitRef.current && !timer.current) timer.current = setTimeout(flush, GRACE_MS);
  }, [flush]);

  // A toast that is fading has already committed; pressing Undo through the
  // last frames of its animation must not put the row back.
  return {
    pending,
    remove,
    undo: () => {
      if (pending && !pending.leaving) pending.undo();
    },
    hold,
    release,
  };
}
