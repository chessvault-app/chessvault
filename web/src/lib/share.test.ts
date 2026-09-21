import { afterEach, describe, expect, it, vi } from 'vitest';
import { canShare, share, textFile } from './share';

/** A navigator with only the bits these helpers ask of it. */
function stubNavigator(nav: Record<string, unknown>): void {
  vi.stubGlobal('navigator', nav);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('canShare', () => {
  it('is false where the browser has no share sheet', () => {
    stubNavigator({});
    expect(canShare()).toBe(false);
    expect(canShare({ text: 'e4' })).toBe(false);
  });

  it('is true where navigator.share exists', () => {
    stubNavigator({ share: () => Promise.resolve() });
    expect(canShare()).toBe(true);
    expect(canShare({ text: 'e4' })).toBe(true);
  });

  it('asks navigator.canShare about files', () => {
    const canShareSpy = vi.fn((d: { files?: unknown[] }) => !d.files);
    stubNavigator({ share: () => Promise.resolve(), canShare: canShareSpy });
    const file = textFile('1. e4', 'game.pgn', 'application/x-chess-pgn');
    expect(file).not.toBeNull();
    expect(canShare({ files: file ? [file] : [] })).toBe(false);
    expect(canShare({ text: '1. e4' })).toBe(true);
  });

  it('refuses files where the browser cannot be asked', () => {
    // share without canShare: text is fine, a file is a guess not worth making.
    stubNavigator({ share: () => Promise.resolve() });
    const file = textFile('1. e4', 'game.pgn', 'application/x-chess-pgn');
    expect(canShare({ files: file ? [file] : [] })).toBe(false);
  });

  it('survives a canShare that throws', () => {
    stubNavigator({
      share: () => Promise.resolve(),
      canShare: () => {
        throw new TypeError('bad payload');
      },
    });
    expect(canShare({ text: 'e4' })).toBe(false);
  });
});

describe('share', () => {
  it('passes only the keys it was given', async () => {
    const shareSpy = vi.fn(() => Promise.resolve());
    stubNavigator({ share: shareSpy });
    await share({ text: '1. e4', files: [] });
    expect(shareSpy).toHaveBeenCalledWith({ text: '1. e4' });
  });

  it('reports a cancel as a cancel, and never as a failure', async () => {
    const abort = Object.assign(new Error('share canceled'), { name: 'AbortError' });
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({
      share: () => Promise.reject(abort),
      clipboard: { writeText },
    });
    expect(await share({ text: '1. e4' }, '1. e4')).toBe('cancelled');
    // A cancel must not quietly copy instead: the person said no.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies where there is no share sheet', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({ clipboard: { writeText } });
    expect(await share({ text: '1. e4' }, '1. e4')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('1. e4');
  });

  it('copies where the sheet refuses for any other reason', async () => {
    // NotAllowedError is what both engines throw without a user gesture.
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const writeText = vi.fn(() => Promise.resolve());
    stubNavigator({ share: () => Promise.reject(denied), clipboard: { writeText } });
    expect(await share({ text: '1. e4' }, '1. e4')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('1. e4');
  });

  it('fails where neither the sheet nor the clipboard works', async () => {
    stubNavigator({});
    expect(await share({ text: '1. e4' }, '1. e4')).toBe('failed');
  });

  it('fails rather than copying when it was given nothing to copy', async () => {
    stubNavigator({});
    expect(await share({ text: '1. e4' })).toBe('failed');
  });
});
