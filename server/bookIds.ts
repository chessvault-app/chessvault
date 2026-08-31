import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';

/**
 * What a book's folder is called, and whether it still holds its PDF.
 *
 * Three helpers, apart from `server/books.ts` because the puzzle shelf
 * needs them and the library does not need to come with them. books.ts
 * reaches for `node:crypto`, `node:stream` and `node:stream/promises` to
 * move an uploaded PDF around, none of which the static demo shims — so
 * importing these three from there meant the demo could not mount
 * `puzzleBooksApi` at all, and answered `{books: []}` from a hand-written
 * stub instead. The app's most distinctive feature was the one the demo
 * could not show. These are the only part of books.ts the puzzle shelf
 * ever wanted, and none of them needs a stream.
 */

const BOOKS_DIR = resolve(VAULT, 'books');

/**
 * A book's folder: `b` and eight random bytes as hex.
 *
 * Random rather than a hash of the title, because two books may be called
 * the same thing — the shelf's own New button offers one name to every
 * book it makes — and a hash would file them both in one folder, which is
 * the collision this id exists to make impossible. Eight bytes is 2^64:
 * a vault would need billions of books before two ever met.
 *
 * The puzzle shelf mints its folders the same way, so both sides import
 * this rather than keeping a second copy of the scheme to drift from.
 *
 * Web Crypto rather than `node:crypto`'s randomBytes: the same eight
 * bytes from the same kind of source, and it exists in a page as well as
 * in Node, which is what lets the demo run this module at all.
 */
export const newBookId = (): string =>
  `b${[...globalThis.crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;

/** Minted here, so a folder that was never minted here is recognisable. */
export const isLibraryBookId = (name: string): boolean => /^b[0-9a-f]{16}$/.test(name);

/**
 * Whether this library book still has its file — the one question the
 * puzzle shelf asks, so a puzzle book whose PDF was removed from the
 * library simply stops offering to be read.
 */
export function libraryBookHasPdf(id: string, dir: string = BOOKS_DIR): boolean {
  return isLibraryBookId(id) && existsSync(resolve(dir, id, 'book.pdf'));
}
