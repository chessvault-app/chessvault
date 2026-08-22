import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The fallback close-request stack — what answers Escape in a browser
 * with no CloseWatcher.
 *
 * No jsdom: the stack talks to exactly two document methods, and node's
 * own EventTarget provides both, so the real listener is attached to a
 * real event target and a real dispatch runs it. Anything richer would
 * be testing a DOM implementation rather than this rule.
 */
class FakeDocument extends EventTarget {
  added = 0;
  removed = 0;
  override addEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    this.added += 1;
    super.addEventListener(type, fn);
  }
  override removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null): void {
    this.removed += 1;
    super.removeEventListener(type, fn);
  }
}

let doc: FakeDocument;
let pushCloser: (close: () => void) => () => void;

/** A close request, as the stack reads one: a keydown carrying `key`. */
function press(key: string): void {
  const e = new Event('keydown');
  Object.defineProperty(e, 'key', { value: key });
  doc.dispatchEvent(e);
}

beforeEach(async () => {
  doc = new FakeDocument();
  (globalThis as { document?: unknown }).document = doc;
  // A fresh copy of the module per test: the stack and its one listener
  // are module state, which is right for a page and wrong for a suite —
  // left shared, dialogs from an earlier test answer this one's Escape.
  vi.resetModules();
  ({ pushCloser } = await import('./dialogFocus'));
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('the fallback close-request stack', () => {
  it('asks the dialog on top, and only that one', () => {
    // The bug this replaced: a confirm sheet over a window, or a Select
    // inside one, and a single Escape closed both.
    const closed: string[] = [];
    pushCloser(() => closed.push('window'));
    pushCloser(() => closed.push('sheet'));

    press('Escape');

    expect(closed).toEqual(['sheet']);
  });

  it('hands the request down as each dialog goes', () => {
    const closed: string[] = [];
    pushCloser(() => closed.push('window'));
    const dropSheet = pushCloser(() => closed.push('sheet'));

    press('Escape');
    dropSheet();
    press('Escape');

    expect(closed).toEqual(['sheet', 'window']);
  });

  it('lets a dialog leave from the middle without taking the top with it', () => {
    // A Select closing itself while the window it sits in stays open, and
    // a sheet above both: the Select's cleanup runs with a later
    // registration already on the stack.
    const closed: string[] = [];
    pushCloser(() => closed.push('window'));
    const dropSelect = pushCloser(() => closed.push('select'));
    pushCloser(() => closed.push('sheet'));

    dropSelect();
    press('Escape');

    expect(closed).toEqual(['sheet']);
  });

  it('removes one registration per unregister, not every match', () => {
    // StrictMode mounts an effect twice; both runs may push a closer that
    // compares equal. Dropping one must leave the other answering.
    const closed: string[] = [];
    const same = (): void => {
      closed.push('same');
    };
    const dropFirst = pushCloser(same);
    pushCloser(same);

    dropFirst();
    press('Escape');
    expect(closed).toEqual(['same']);
  });

  it('ignores keys that are not a close request', () => {
    const closed: string[] = [];
    pushCloser(() => closed.push('sheet'));

    press('Enter');
    press('Tab');
    press('Esc'); // the old IE spelling, which this app never sees

    expect(closed).toEqual([]);
  });

  it('keeps one listener for any number of dialogs, and none once they are gone', () => {
    expect(doc.added).toBe(0);
    const dropA = pushCloser(() => {});
    const dropB = pushCloser(() => {});
    const dropC = pushCloser(() => {});
    expect(doc.added).toBe(1);
    expect(doc.removed).toBe(0);

    dropA();
    dropC();
    expect(doc.removed).toBe(0);

    dropB();
    expect(doc.removed).toBe(1);

    // And it re-arms for the next dialog rather than staying deaf.
    const closed: string[] = [];
    pushCloser(() => closed.push('later'));
    expect(doc.added).toBe(2);
    press('Escape');
    expect(closed).toEqual(['later']);
  });

  it('survives a dialog unregistering twice', () => {
    // React can run a cleanup once; a caller that chains refs must not be
    // able to corrupt the stack by running it again.
    const closed: string[] = [];
    pushCloser(() => closed.push('window'));
    const drop = pushCloser(() => closed.push('sheet'));

    drop();
    drop();
    press('Escape');

    expect(closed).toEqual(['window']);
  });
});
