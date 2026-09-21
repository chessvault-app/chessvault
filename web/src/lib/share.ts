/**
 * The system share sheet, with the clipboard underneath it.
 *
 * Copying a FEN or a PGN is how text left this app until now, and on a
 * desktop that is still the whole story. On a phone it is not: the
 * platform's own way to send something out of an app is the share sheet,
 * and every target a person actually uses (a message, a mail, another
 * chess app, Files) is behind it. Safari and Android Chrome both have the
 * Web Share API, files included; nothing else this app runs in does.
 *
 * Feature test, never the platform attribute. `data-platform` is a guess
 * about CHROME and is allowed to be wrong (see lib/platform.ts); whether
 * a share sheet exists is behaviour, and behaviour is asked of the
 * browser. The Electron shell and a desktop browser without the API
 * therefore keep Copy and never see a Share row.
 *
 * MUST BE CALLED FROM A USER GESTURE. Both engines require transient
 * activation for `navigator.share` and reject with NotAllowedError
 * without it, so a Share verb lives on a menu item's or a button's own
 * handler: never behind an await that has already yielded, a timer, or a
 * promise chain started earlier in the turn. Build the text or the file
 * first, then call.
 */
import { copyText } from './clipboard';
import { currentPlatform } from './platform';
import { Share, Share2 } from 'lucide-react';

export interface ShareInput {
  title?: string;
  text?: string;
  url?: string;
  files?: File[];
}

export type ShareResult =
  /** The sheet opened and the share was handed off. */
  | 'shared'
  /** The sheet opened and the person dismissed it. Not an error, and not an event. */
  | 'cancelled'
  /** No sheet, or the sheet refused: the text went to the clipboard instead. */
  | 'copied'
  /** Neither worked. */
  | 'failed';

function payload(data: ShareInput): ShareData {
  // Only the keys that were given: Safari rejects a ShareData carrying an
  // empty `files` array, and an undefined `url` reads as the string.
  const out: ShareData = {};
  if (data.title !== undefined) out.title = data.title;
  if (data.text !== undefined) out.text = data.text;
  if (data.url !== undefined) out.url = data.url;
  if (data.files?.length) out.files = data.files;
  return out;
}

/**
 * Whether this browser can share, and (given `data`) whether it will take
 * THIS payload. Asked of files especially: a browser with `navigator.share`
 * may still refuse a `.pgn`, and `canShare` is the only way to find out
 * without opening a sheet that then fails.
 */
export function canShare(data?: ShareInput): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (!data) return true;
  if (typeof navigator.canShare !== 'function') return !data.files?.length;
  try {
    return navigator.canShare(payload(data));
  } catch {
    return false;
  }
}

/** A cancel is the person saying no, not a failure to report. */
function cancelled(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Open the share sheet, falling back to the clipboard.
 *
 * `fallback` is the text to copy where there is no sheet, or where the
 * sheet refused the payload: pass what Copy would have put there, so the
 * verb always does something. Omit it and an unavailable sheet is
 * `'failed'`, which a caller offering Share only under `canShare()`
 * never expects to see.
 */
export async function share(data: ShareInput, fallback?: string): Promise<ShareResult> {
  if (canShare(data)) {
    try {
      await navigator.share(payload(data));
      return 'shared';
    } catch (err) {
      if (cancelled(err)) return 'cancelled';
      // Anything else (no activation, no target, a file the sheet would
      // not take after all) is worth the clipboard rather than a dead end.
    }
  }
  if (fallback === undefined) return 'failed';
  return (await copyText(fallback)) ? 'copied' : 'failed';
}

/** Text as a file for the sheet, where the browser will take one. */
export function textFile(text: string, name: string, type: string): File | null {
  try {
    return new File([text], name, { type });
  } catch {
    return null;
  }
}

/**
 * Which share glyph the platform expects. This one reads the platform
 * because it IS chrome: iOS draws the square with the arrow out of it,
 * Android the three connected nodes, and each is unreadable on the other.
 */
export function shareIcon(): React.ComponentType<{ className?: string }> {
  return currentPlatform() === 'ios' ? Share : Share2;
}
