import { create } from 'zustand';

/**
 * The one open document's claim on the way out.
 *
 * A single slot, not a registry: only one document is ever open — the
 * study store holds one `openId`, and a note view is keyed on its id — so
 * a map would be a lookup with one entry in it and a key to get wrong.
 *
 * Nothing here touches `location` or `history`. Those live in router.ts,
 * which is what makes this module testable under vitest's node
 * environment, where there is no window.
 */
export interface LeaveGuard {
  /** What the question calls the document. */
  name: string;
  isDirty: () => boolean;
  /** Resolves false when the write failed — the question stays up to say so. */
  save: () => Promise<boolean>;
  discard: () => void;
  /**
   * Whether this document writes itself.
   *
   * When it does, leaving is not a question: flush and go. It becomes one
   * only if the flush fails, which is the case that used to pass in
   * silence — the old beforeunload guard could not tell a reader that the
   * save it was waiting for had not landed.
   */
  autoSaves: () => boolean;
}

let slot: LeaveGuard | null = null;

export function registerLeaveGuard(guard: LeaveGuard): () => void {
  slot = guard;
  // Only ever clear OUR OWN registration. Under StrictMode the first
  // mount's cleanup runs after the second mount has registered, and a
  // bare `slot = null` there would leave the live document unguarded.
  return () => {
    if (slot === guard) slot = null;
  };
}

export function currentLeaveGuard(): LeaveGuard | null {
  return slot;
}

/** Is there anything to lose? Asked before every navigation. */
export function leaveIsBlocked(): boolean {
  return slot !== null && slot.isDirty();
}

interface AskState {
  /** The document's name while the question is up; null when it is not. */
  name: string | null;
  /** A save is in flight — the buttons wait rather than asking twice. */
  busy: boolean;
  error: string | null;
}

export const useLeaveAsk = create<AskState>()(() => ({ name: null, busy: false, error: null }));

let answer: ((ok: boolean) => void) | null = null;

/**
 * May we leave? Resolves true to go, false to stay put.
 *
 * Clean, or nothing open, resolves at once and shows nothing — the
 * overwhelmingly common case, and it must cost nothing.
 */
export async function confirmLeave(): Promise<boolean> {
  const guard = slot;
  if (!guard || !guard.isDirty()) return true;
  if (guard.autoSaves() && (await guard.save())) return true;

  // A second question while one is up — a stray click behind the sheet —
  // answers the first as "stay". Two live resolvers would strand one.
  answer?.(false);
  useLeaveAsk.setState({ name: guard.name, busy: false, error: null });
  return new Promise<boolean>((resolve) => {
    answer = resolve;
  });
}

function settle(ok: boolean): void {
  const resolve = answer;
  answer = null;
  useLeaveAsk.setState({ name: null, busy: false, error: null });
  resolve?.(ok);
}

export function cancelLeave(): void {
  settle(false);
}

export function discardAndLeave(): void {
  slot?.discard();
  settle(true);
}

export async function saveAndLeave(): Promise<void> {
  const guard = slot;
  if (!guard) {
    settle(true);
    return;
  }
  useLeaveAsk.setState({ busy: true, error: null });
  if (await guard.save()) settle(true);
  // A failed save must not lose the changes it failed to write: the
  // question stays up, now with somewhere to press again.
  else useLeaveAsk.setState({ busy: false, error: 'Could not save. Your changes are still here.' });
}
