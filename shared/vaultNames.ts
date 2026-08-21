/**
 * What a vault may call a file, and what it may not.
 *
 * Shared because three places need the SAME answer: the routes that accept
 * a name, the importers that invent one from a Lichess title or a pair of
 * player names, and the games list in the browser, which rebuilds the
 * auto-generated name to tell it apart from one somebody chose. When those
 * three disagreed, every collected game with a non-Latin player looked
 * custom-named.
 */
/**
 * What a filesystem cannot take. Everything else is allowed.
 *
 * This was an allowlist of characters, and an allowlist is the wrong shape
 * for names people choose: it began `[A-Za-z0-9]`, so it rejected every
 * Korean title outright — a Korean user could not name a study at all —
 * along with "Ruy López", "Sicilian: Najdorf", "Tactics!" and half the
 * Lichess studies anybody would import. Widening it one character at a
 * time is a losing game; the set of characters a name may contain is not
 * knowable, while the set a path may not is.
 *
 * So: the characters Windows forbids, control characters, and the shapes
 * that mean something to a path — traversal, hidden files, the trailing
 * dots and spaces Windows silently strips, and its reserved device names,
 * which fail as filenames even with an extension.
 */
const FORBIDDEN_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const FORBIDDEN_CHARS_G = /[\\/:*?"<>|\x00-\x1f]+/g;
const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
const MAX_SEGMENT = 120;
const MAX_DEPTH = 4;

function validSegment(s: string): boolean {
  return (
    s.length > 0 &&
    s.length <= MAX_SEGMENT &&
    !FORBIDDEN_CHARS.test(s) &&
    !RESERVED_DEVICE.test(s) &&
    !s.startsWith('.') && // hidden files, and "." / ".." with them
    !s.endsWith('.') &&
    s.trim() === s
  );
}

export function validId(id: string): boolean {
  const segments = id.split('/');
  return segments.length <= MAX_DEPTH && segments.every(validSegment);
}

/**
 * Turn a name from OUTSIDE — a Lichess study title, a PGN header, a pair of
 * player names — into one this vault can hold.
 *
 * Refusing is right for a name somebody typed, and wrong for one that
 * arrives with the thing it names: an import that drops half a Lichess
 * account because the titles have colons in them is not protecting
 * anybody. So the same forbidden set is REPLACED here rather than
 * rejected, and everything else — Korean, accents, punctuation — is left
 * exactly as its author wrote it.
 */
/**
 * The longest a single path segment may be, in UTF-8 BYTES.
 *
 * MAX_SEGMENT counts characters, which is the limit NTFS enforces (255
 * UTF-16 units) and not the one Linux and macOS do: ext4 and APFS cap a
 * name at 255 bytes, and 120 Korean characters is 360 of them. A name
 * inside one limit and outside the other is a folder that cannot be
 * created on the server this vault runs on — which only started to matter
 * when a book's folder became its title rather than a slug minted once.
 */
const MAX_SEGMENT_BYTES = 255;

/**
 * Trim a sanitized name until a filesystem will take it as one segment,
 * keeping `reserve` bytes free for a caller that appends (" 2", " 3" —
 * the next free folder when the name is taken).
 *
 * By code point, never by UTF-16 unit: cutting a name in half through a
 * surrogate pair leaves an unpaired one, which is not valid UTF-8 and
 * which some filesystems refuse outright. Whatever the cut exposes at the
 * end — a space, a dot — goes the same way it would have in
 * sanitizeSegment, so the result is still a name this vault accepts.
 */
export function fitSegment(name: string, reserve = 0): string {
  const budget = MAX_SEGMENT_BYTES - reserve;
  const bytes = (s: string): number => new TextEncoder().encode(s).length;
  let out = Array.from(name).slice(0, MAX_SEGMENT).join('');
  if (bytes(out) > budget) {
    const chars = Array.from(out);
    while (chars.length > 0 && bytes(chars.join('')) > budget) chars.pop();
    out = chars.join('');
  }
  return out.replace(/[.\s]+$/, '');
}

export function sanitizeSegment(name: string, fallback = 'Untitled'): string {
  const trimmed = name
    // ONE normal form, because three filesystems disagree about which
    // they store. "책" is one code point in NFC and two in NFD, and a
    // Korean IME on macOS hands over the second; HFS+ then normalises
    // every name it is given to NFD, APFS and NTFS keep what they are
    // handed, and ext4 keeps bytes. Without this the same title yields a
    // different folder name depending on the machine it was typed on,
    // and a name compared against a folder listing matches on one OS and
    // not on another. NFC is the form the web hands around, and it is
    // what every comparison in this codebase assumes.
    .normalize('NFC')
    .replace(FORBIDDEN_CHARS_G, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  // fitSegment rather than slice(0, MAX_SEGMENT): a study, a note and a
  // collected game are all FILES named after their titles, and 120 Korean
  // characters is 360 UTF-8 bytes — inside the limit NTFS enforces and
  // outside the one ext4 and APFS do, which is a name the server cannot
  // write at all.
  const cleaned = fitSegment(trimmed).trim();
  if (!cleaned) return fallback;
  // A name that is a Windows device is a file that cannot be created.
  return RESERVED_DEVICE.test(cleaned) ? `${cleaned}_` : cleaned;
}
