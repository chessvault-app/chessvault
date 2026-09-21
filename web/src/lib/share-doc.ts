/**
 * Sharing a whole document, as the file it is.
 *
 * `lib/share.ts` is the sheet itself; this is what every caller around it
 * was about to write for the second time. A study, a game and a note are
 * all one text with a name, and what a person does with one is send it to
 * somebody: as a `.pgn` another chess app opens, or a `.md` a notes app
 * does, and as plain text where the sheet will not take a file (which is
 * what the clipboard fallback underneath `share()` then catches again).
 *
 * MUST BE CALLED FROM A USER GESTURE, like everything in share.ts: build
 * the text first, then call. Nothing here awaits before the sheet.
 */
import { canShare, share, textFile, type ShareResult } from './share';
import { toast } from '@/components/ui/toast';
import { t } from './i18n';
import { fitSegment, sanitizeSegment } from '@shared/vaultNames';

/**
 * Whether this browser has a share sheet at all, asked once as the chunk
 * loads. `navigator.share` does not appear later in a session, and the
 * question is behaviour rather than which chrome the phone draws, so it
 * is a feature test and not `data-platform` (lib/share.ts says why). A
 * desktop browser and the Electron shell answer no and offer no Share.
 */
export const CAN_SHARE = canShare();

/** What a .pgn is on the wire, and what the sheet hands the next app. */
export const PGN_TYPE = 'application/x-chess-pgn';

/** And a note, which leaves this app as the markdown it is stored as. */
export const MARKDOWN_TYPE = 'text/markdown';

/**
 * Speak only where the sheet did not open. A share that went through,
 * and a share the person waved away, are both silent: the sheet was
 * itself the feedback, and a toast after it is a second dismissal.
 */
export function reportShare(result: ShareResult): void {
  if (result === 'copied')
    toast.add({ title: t('Sharing is not available. Copied instead.'), timeout: 3000 });
  else if (result === 'failed') toast.add({ title: t('Could not share this') });
}

/**
 * The document's own name as a file name, with room kept for the
 * extension. The same sanitiser the vault names its files with, so what
 * lands in Files is what the shelf calls it — a document named with a
 * slash or a colon is not a name any target will take.
 */
export function shareFileName(name: string, ext: string): string {
  return `${fitSegment(sanitizeSegment(name), ext.length)}${ext}`;
}

/**
 * Hand the sheet a document. The file first, since a `.pgn` opens in
 * another chess app while the same moves as text only ever land in a
 * message; text where the sheet will not take a file, and the clipboard
 * under that.
 */
export function shareDocument(text: string, filename: string, type: string): void {
  const file = textFile(text, filename, type);
  const data = file && canShare({ files: [file] }) ? { files: [file] } : { text };
  void share(data, text).then(reportShare);
}
