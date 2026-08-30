/**
 * A note's front matter: finding it, and reading the one key that matters.
 *
 * This was written twice — once in `server/studies.ts` to skip metadata
 * when taking a preview excerpt, once in `web/src/notes/markdown.ts` to
 * keep it out of the editor's document — and the two disagreed. Checked
 * against ten inputs, three diverged:
 *
 *   `---\n---`        the server saw empty front matter; the web did not,
 *                     so the editor parsed the fences as horizontal rules
 *                     and the next autosave wrote them back as content.
 *                     That is the exact bug markdown.ts was written to
 *                     stop, still happening in the one case its regex
 *                     could not match.
 *   `  ---`           the server accepted an INDENTED fence, which no
 *                     markdown tool does, so an indented rule at the top
 *                     of a note vanished from its preview.
 *   `---\na: 1\n---`  with no trailing newline, the server appended one.
 *                     Harmless only because it discards `front` and reads
 *                     `body` — a latent difference, not a working one.
 *
 * So: one implementation, taking the correct half of each. The fence must
 * open the file at column 0 (the web's strictness, which is what markdown
 * says), an empty block still counts (the server's completeness), and
 * `front` comes back exactly as written, because the editor puts it back
 * on every save and a newline it invented would be a diff nobody made.
 */

/**
 * Front matter, if the file opens with it.
 *
 * The ambiguity with a document that genuinely opens on a horizontal rule
 * is resolved the way every other markdown tool resolves it — in favour of
 * front matter.
 */
const FRONT_MATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(markdown: string): { front: string; body: string } {
  const found = FRONT_MATTER.exec(markdown);
  if (!found) return { front: '', body: markdown };
  return { front: found[0], body: markdown.slice(found[0].length) };
}

/**
 * The `aliases` key, in the three shapes Obsidian writes it.
 *
 *     aliases: [Najdorf, B90]
 *     aliases: Najdorf
 *     aliases:
 *       - Najdorf
 *       - B90
 *
 * Deliberately not a YAML parser. Pulling one in to read a single key of a
 * block this app otherwise treats as an opaque string would be a
 * dependency and a second document model, and every shape Obsidian
 * actually writes is one of these three. Anything else is read as no
 * aliases rather than guessed at — the same rule the book importer follows
 * for a position it cannot replay.
 */
export function readAliases(front: string): string[] {
  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((line) => /^aliases[ \t]*:/i.test(line));
  if (at < 0) return [];

  const inline = lines[at]!.replace(/^aliases[ \t]*:/i, '').trim();
  if (inline) {
    const list = inline.startsWith('[') && inline.endsWith(']') ? inline.slice(1, -1) : inline;
    return clean(list.split(','));
  }

  // A block list: the indented `- item` lines directly under the key.
  const items: string[] = [];
  for (const line of lines.slice(at + 1)) {
    const item = /^[ \t]+-[ \t]*(.*)$/.exec(line);
    if (!item) break;
    items.push(item[1]!);
  }
  return clean(items);
}

/**
 * A comma-separated alias list, as a PGN header writes it.
 *
 * Studies and games have no front matter — they are PGN — but the codec
 * preserves headers it does not know, so `[Aliases "B90, Najdorf"]` is
 * where an opening keeps the names it is actually called by. Same cleaning
 * as the YAML side, so the two forms accept the same values.
 */
export const splitAliasList = (raw: string): string[] => clean(raw.split(','));

/** Trim, unquote, and drop anything left empty. */
function clean(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const value = item.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
    if (value) out.push(value);
  }
  return out;
}

/**
 * Front matter with `aliases` set to `list`, for writing back.
 *
 * The rest of the block is left exactly as it was: front matter is the
 * user's, and this app understands one key of it. An empty list removes
 * the key rather than writing `aliases: []`, so a note that never had
 * aliases and had them added and removed ends up as it started.
 */
export function writeAliases(front: string, list: string[]): string {
  const kept = clean(list);
  const eol = front.includes('\r\n') ? '\r\n' : '\n';
  const line = `aliases: [${kept.join(', ')}]`;

  if (!front.trim()) return kept.length ? `---${eol}${line}${eol}---${eol}` : '';

  const lines = front.split(/\r?\n/);
  const at = lines.findIndex((l) => /^aliases[ \t]*:/i.test(l));
  if (at < 0) {
    if (!kept.length) return front;
    // Directly under the opening fence, where Obsidian puts it.
    lines.splice(1, 0, line);
    return lines.join(eol);
  }

  // Replace the key and whatever block list belonged to it.
  let end = at + 1;
  if (!lines[at]!.replace(/^aliases[ \t]*:/i, '').trim()) {
    while (end < lines.length && /^[ \t]+-[ \t]*/.test(lines[end]!)) end += 1;
  }
  lines.splice(at, end - at, ...(kept.length ? [line] : []));
  return lines.join(eol);
}
