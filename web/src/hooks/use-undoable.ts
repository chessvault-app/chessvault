import { useCallback, useEffect, useRef } from 'react';
import { toast } from '@/components/ui/toast';
import { announce } from '@/lib/announce';
import { t } from '@/lib/i18n';

/**
 * How long an undo is offered. Long enough to read a sentence and press a
 * button, short enough that a removal is not left hanging over the list
 * for somebody who has already moved on. The toast's timer pauses while
 * the pointer or the keyboard focus is on the viewport — a grace period
 * that expires under the cursor takes the button away mid-press, and a
 * screen-reader user needs longer than 4.5 s.
 */
const GRACE_MS = 4500;

/** An offer that has been made and not yet answered. */
type Pending = {
  id: string;
  commit: () => void;
  /** The hook instance that raised it — see `pending`. */
  owner: object;
};

/**
 * The offer standing on screen right now, whoever raised it.
 *
 * Module scope rather than a ref per instance, because one page mounts this
 * hook more than once: the move tree draws its destructive verbs in two
 * components (the header's buttons and the phone's ⋯), and on the Board the
 * view around them offers back the board a fresh entry replaced. A pending
 * entry each meant neither could see the other, so two offers stood stacked
 * ("Started a new board · Restore" under "Removed “all moves” · Undo") —
 * the question with two answers this grace period exists to avoid. The
 * toast viewport is one; the question it is asking is one too.
 *
 * `owner` keeps the other half of the contract intact: raising an offer
 * commits whatever stands, from any instance, while UNMOUNTING commits only
 * what that instance itself promised, since that is whose closures are
 * going.
 */
let pending: Pending | null = null;

/** Commit the standing offer and take it off screen. */
function flushPending(): void {
  const entry = pending;
  if (!entry) return;
  pending = null;
  entry.commit();
  toast.close(entry.id);
}

/**
 * The undo that stands in for a confirmation.
 *
 * A removal happens at once on screen (the caller hides the row) and is
 * COMMITTED only when the offer expires: "Removed “x” · Undo" in shadcn's
 * toast (components/ui/toast), undo puts the row back and nothing was
 * ever sent. Leaving the page commits — a removal that was shown must not
 * silently un-happen because the offer was still up.
 */
export function useUndoable(): {
  /**
   * `commit` runs when the offer expires; `undo` when it is taken. A second
   * removal while one is pending commits the first at once, wherever on the
   * page that first one came from — the list is already showing it gone, and
   * two offers at once is a question with two answers.
   */
  remove: (label: string, commit: () => void, undo?: () => void) => void;
  /**
   * The same offer in other words, for a loss that is not a removal: the
   * Board page starting over says what happened and offers the board back
   * (analysis/AnalysisView). `title` is the whole sentence, `action` the
   * button; everything else — the grace period, the announcement, the
   * commit on leave — is the removal's, because the question is the same
   * one and an app that asks it twice in two shapes has two answers.
   */
  offer: (
    wording: { title: string; action: string },
    commit: () => void,
    undo?: () => void,
  ) => void;
} {
  // This instance's identity, which is all `owner` has to be: a ref is the
  // one thing a render hands out that is the same object every time.
  const self = useRef(null);

  const flushMine = useCallback(() => {
    if (pending?.owner === self) flushPending();
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flushMine);
    return () => {
      window.removeEventListener('pagehide', flushMine);
      // Unmounting commits: the closure that knows how to delete belongs
      // to a page that is going, and an offer that outlives it could not
      // be honoured. Only this instance's own, though — a sibling that is
      // still standing has a live closure and keeps its grace period.
      flushMine();
    };
  }, [flushMine]);

  const offer = useCallback(
    (wording: { title: string; action: string }, commit: () => void, undo?: () => void) => {
      // Whatever stands goes, whoever raised it: the newer offer is the one
      // the reader just acted to get.
      flushPending();
      const message = wording.title;
      announce(message);
      const entry: Pending = { id: '', commit, owner: self };
      entry.id = toast.add({
        title: message,
        timeout: GRACE_MS,
        actionProps: {
          children: wording.action,
          onClick: () => {
            if (pending === entry) pending = null;
            undo?.();
            toast.close(entry.id);
          },
        },
        // Closed with the offer still pending: it expired unanswered (or
        // was swiped or X-ed away, which is the same answer), and the
        // removal is real now. Undo and flush clear pending first, so
        // their close comes through here and does nothing.
        onClose: () => {
          if (pending !== entry) return;
          pending = null;
          commit();
        },
      });
      pending = entry;
    },
    [],
  );

  const remove = useCallback(
    (label: string, commit: () => void, undo?: () => void) => {
      offer({ title: t('Removed “{name}”', { name: label }), action: t('Undo') }, commit, undo);
    },
    [offer],
  );

  return { remove, offer };
}
