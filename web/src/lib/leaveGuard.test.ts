import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelLeave,
  confirmLeave,
  currentLeaveGuard,
  discardAndLeave,
  leaveIsBlocked,
  registerLeaveGuard,
  saveAndLeave,
  useLeaveAsk,
} from './leaveGuard';

/** A guard whose answers are dials, so each test states only what it cares about. */
function stub(over: Partial<Parameters<typeof registerLeaveGuard>[0]> = {}) {
  const guard = {
    name: 'Ruy Lopez',
    dirty: true,
    saveOk: true,
    saved: 0,
    discarded: 0,
  };
  const unregister = registerLeaveGuard({
    name: guard.name,
    isDirty: () => guard.dirty,
    save: async () => {
      guard.saved += 1;
      return guard.saveOk;
    },
    discard: () => {
      guard.discarded += 1;
    },
    autoSaves: () => false,
    ...over,
  });
  return { guard, unregister };
}

beforeEach(() => {
  // Each test registers its own; make sure none leaks in from the last.
  registerLeaveGuard({
    name: '',
    isDirty: () => false,
    save: async () => true,
    discard: () => {},
    autoSaves: () => false,
  })();
  useLeaveAsk.setState({ name: null, busy: false, error: null });
});

describe('nothing to lose', () => {
  it('lets an unguarded navigation straight through', async () => {
    expect(leaveIsBlocked()).toBe(false);
    await expect(confirmLeave()).resolves.toBe(true);
    expect(useLeaveAsk.getState().name).toBeNull();
  });

  it('asks nothing when the document is clean', async () => {
    const { guard } = stub();
    guard.dirty = false;
    expect(leaveIsBlocked()).toBe(false);
    await expect(confirmLeave()).resolves.toBe(true);
    expect(guard.saved).toBe(0);
    expect(useLeaveAsk.getState().name).toBeNull();
  });
});

describe('a document that saves itself', () => {
  it('flushes and goes, without a question', async () => {
    const { guard } = stub({ autoSaves: () => true });
    await expect(confirmLeave()).resolves.toBe(true);
    expect(guard.saved).toBe(1);
    expect(useLeaveAsk.getState().name).toBeNull();
  });

  it('falls back to the question when the flush fails', async () => {
    const { guard } = stub({ autoSaves: () => true });
    guard.saveOk = false;
    const asked = confirmLeave();
    // The failed flush is what raised the question, so it is up now.
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).toBe('Ruy Lopez'));
    cancelLeave();
    await expect(asked).resolves.toBe(false);
  });
});

describe('the question', () => {
  it('stays put on cancel', async () => {
    const { guard } = stub();
    const asked = confirmLeave();
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).toBe('Ruy Lopez'));
    cancelLeave();
    await expect(asked).resolves.toBe(false);
    expect(guard.saved).toBe(0);
    expect(guard.discarded).toBe(0);
    expect(useLeaveAsk.getState().name).toBeNull();
  });

  it('throws the changes away on discard', async () => {
    const { guard } = stub();
    const asked = confirmLeave();
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).not.toBeNull());
    discardAndLeave();
    await expect(asked).resolves.toBe(true);
    expect(guard.discarded).toBe(1);
    expect(guard.saved).toBe(0);
  });

  it('writes and goes on save', async () => {
    const { guard } = stub();
    const asked = confirmLeave();
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).not.toBeNull());
    await saveAndLeave();
    await expect(asked).resolves.toBe(true);
    expect(guard.saved).toBe(1);
    expect(useLeaveAsk.getState().name).toBeNull();
  });

  it('keeps the changes AND the question when the save fails', async () => {
    const { guard } = stub();
    guard.saveOk = false;
    const asked = confirmLeave();
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).not.toBeNull());
    await saveAndLeave();
    // Still up, no longer busy, and saying why.
    expect(useLeaveAsk.getState().name).toBe('Ruy Lopez');
    expect(useLeaveAsk.getState().busy).toBe(false);
    expect(useLeaveAsk.getState().error).not.toBeNull();
    // Retrying is what settles it.
    guard.saveOk = true;
    await saveAndLeave();
    await expect(asked).resolves.toBe(true);
    expect(guard.saved).toBe(2);
  });

  it('answers an outstanding question rather than stranding it', async () => {
    stub();
    const first = confirmLeave();
    await vi.waitFor(() => expect(useLeaveAsk.getState().name).not.toBeNull());
    const second = confirmLeave();
    // The first navigation gave up its turn; nobody is left waiting forever.
    await expect(first).resolves.toBe(false);
    cancelLeave();
    await expect(second).resolves.toBe(false);
  });
});

describe('registration', () => {
  it('survives StrictMode double mounting', () => {
    const first = stub();
    const second = stub();
    // The first mount's cleanup runs AFTER the second has registered.
    first.unregister();
    expect(currentLeaveGuard()).not.toBeNull();
    expect(leaveIsBlocked()).toBe(true);
    second.unregister();
    expect(currentLeaveGuard()).toBeNull();
  });
});
