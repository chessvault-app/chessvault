/**
 * What a tag is, and where a document keeps its tags.
 *
 * Shared because four places need the SAME answer and would otherwise
 * drift: the server, which reads tags off a file to put them on a shelf
 * card; the note editor, which writes them into YAML front matter; the
 * study editor, which writes them into a PGN header; and the shelves,
 * which show them. A tag that reads as "Endgame" on one side and
 * "endgame" on the other is two tags.
 */

/** Beyond this a card is a wall of badges rather than a labelled thing. */
export const MAX_TAGS = 6;
const MAX_TAG_LENGTH = 24;

/**
 * Trimmed, lower-cased, de-duplicated, bounded.
 *
 * Lower-cased because a tag is a label, not a sentence: typing "Endgame"
 * on one note and "endgame" on the next should file them together, and
 * nobody wants to remember which capitalisation they used last time.
 */
export function normaliseTags(raw: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    // Commas and hashes are the two characters that mean something in the
    // formats these are stored in; a tag containing them cannot round trip.
    const tag = item.trim().replace(/^#/, '').replace(/[,\r\n]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
    if (!tag || tag.length > MAX_TAG_LENGTH || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** `a, b` or `[a, b]` — the inline form both formats are written in. */
export function parseTagLine(value: string): string[] {
  return normaliseTags(value.replace(/^\[|\]$/g, '').split(','));
}

export function formatTagLine(tags: string[]): string {
  return normaliseTags(tags).join(', ');
}

// --- notes: YAML front matter ------------------------------------------------

/** The lines between the opening `---` and the closing one. */
function frontLines(front: string): string[] {
  const lines = front.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return [];
  const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
  return close > 0 ? lines.slice(1, close) : [];
}

/** Where the `tags:` key sits, and how many lines it occupies. */
function tagsSpan(lines: string[]): { at: number; length: number } | null {
  const at = lines.findIndex((line) => /^tags\s*:/i.test(line.trim()));
  if (at < 0) return null;
  let length = 1;
  // A YAML block list: the indented `- item` lines that follow the key.
  while (at + length < lines.length && /^\s+-\s+/.test(lines[at + length]!)) length += 1;
  return { at, length };
}

export function tagsFromFrontMatter(front: string): string[] {
  const lines = frontLines(front);
  const span = tagsSpan(lines);
  if (!span) return [];
  const inline = lines[span.at]!.replace(/^\s*tags\s*:/i, '');
  const listed = lines.slice(span.at + 1, span.at + span.length).map((l) => l.replace(/^\s+-\s+/, ''));
  return normaliseTags([...parseTagLine(inline), ...listed.map((t) => t.replace(/^['"]|['"]$/g, ''))]);
}

/**
 * The same front matter with its tags replaced.
 *
 * Every other key is left exactly as its author wrote it — a note from
 * Obsidian may carry aliases, a cssclass, a date, and rewriting the block
 * wholesale would be this app deciding what someone else's metadata is
 * worth. Removing the last tag from a block that held nothing else
 * removes the block, rather than leaving `---\n---` at the top of a file.
 */
export function frontMatterWithTags(front: string, tags: string[]): string {
  const clean = normaliseTags(tags);
  const lines = frontLines(front);
  const span = tagsSpan(lines);
  const rest = span ? [...lines.slice(0, span.at), ...lines.slice(span.at + span.length)] : lines;
  const next = clean.length > 0 ? [`tags: ${formatTagLine(clean)}`, ...rest] : rest;
  if (next.length === 0) return '';
  return `---\n${next.join('\n')}\n---\n`;
}

// --- studies: a PGN header ---------------------------------------------------

/**
 * PGN has no file-level header, only game-level ones, and a study is a
 * file of games. So the study's tags go on EVERY chapter: the tags belong
 * to the study, any chapter may be the one that survives a reorder or a
 * deletion, and a header carried once on chapter 1 would vanish the day
 * chapter 1 did. The cost is a repeated line in a file people rarely
 * read by hand; the alternative is losing the tags silently.
 */
export const PGN_TAG_HEADER = 'Tags';

export function tagsFromPgnHeaders(headers: Record<string, string>): string[] {
  return parseTagLine(headers[PGN_TAG_HEADER] ?? '');
}

/** Read a study's tags without parsing it: the header is near the top. */
export function tagsFromPgnText(pgn: string): string[] {
  const found = new RegExp(`^\\[${PGN_TAG_HEADER} "([^"]*)"\\]`, 'm').exec(pgn);
  return found ? parseTagLine(found[1]!) : [];
}

export function pgnHeadersWithTags(
  headers: Record<string, string>,
  tags: string[],
): Record<string, string> {
  const clean = normaliseTags(tags);
  const next = { ...headers };
  if (clean.length === 0) delete next[PGN_TAG_HEADER];
  else next[PGN_TAG_HEADER] = formatTagLine(clean);
  return next;
}
