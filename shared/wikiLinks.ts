/**
 * Obsidian-style `[[wiki links]]`: what they look like, and what they mean.
 *
 * This is shared because it is answered in two places that must agree. The
 * browser resolves a link when it is CLICKED, to know where to navigate;
 * the server resolves every link in the vault to build the reverse index
 * that says what points at a document. If those two rules ever drift, a
 * document shows no backlink for a link that demonstrably works when you
 * press it — and nothing errors, because both answers are individually
 * plausible. Same failure shape as the native core and its TypeScript
 * twin, and the same remedy: one implementation, used by both.
 *
 * The rule itself, unchanged from when it only lived in the editor: try an
 * exact id first, then a unique last segment, and try each across notes,
 * then studies, then games. Case-insensitive throughout. A last segment
 * matching more than one document in a section is NOT a match — guessing
 * between two documents is worse than declining to guess.
 */

/**
 * A wiki link, in the three shapes Obsidian writes them.
 *
 *     [[Target]]              the plain link
 *     [[Target|display]]      shown as `display`, resolved as `Target`
 *     ![[Target]]             an embed: the target's content, not a link
 *
 * Groups: 1 the `!` of an embed (empty for a link), 2 the target,
 * 3 the display text (undefined when there is none).
 *
 * The target excludes `|` as well as the brackets, so the pipe can only be
 * the separator and never part of a name — which matches Obsidian, and
 * means an id containing a pipe is unaddressable rather than ambiguous.
 *
 * The target must also hold something that is not a space, which is what
 * the lookahead is for. `[[]]` was never a link — the target needs at
 * least one character — but `[[ ]]` was, and a link made out of a space
 * resolves to nothing, has no candidates to choose between, and cannot be
 * created either, since spaces are not a valid document name. Pressing it
 * opened a window that said nothing answered to " " and offered nothing to
 * do about it: a dead end, which is the one thing that window exists to
 * remove. `[[ |like this]]` was the worse half, reading as an ordinary
 * link and opening that empty window. Both are now what `[[]]` always was.
 *
 * The lookahead repeats the target's own exclusions rather than saying
 * `\S`, which is what it said first and why this needed measuring: `\S` is
 * satisfied by the closing `]`, because the `*` in front of it stops at
 * the space and the very next character is a bracket. `[[ ]]` went on
 * matching, and the test that was supposed to prove the fix caught it.
 */
export const WIKI_RE = /(!?)\[\[(?=[^[\]|]*[^\s[\]|])([^[\]|]+)(?:\|([^[\]]*))?\]\]/g;

/** One parsed link, however it was written. */
export interface ParsedWikiLink {
  /** What it resolves by. */
  readonly target: string;
  /** What the reader sees: the display text if given, else the target. */
  readonly text: string;
  /** `![[...]]` — the target's content is wanted, not a link to it. */
  readonly embed: boolean;
}

/** Read one `WIKI_RE` match into its parts. */
export function parseWikiMatch(match: RegExpMatchArray): ParsedWikiLink {
  const target = match[2]!;
  const display = match[3];
  return {
    target,
    // An empty display (`[[Target|]]`) falls back to the target rather than
    // rendering as nothing: the writer left it blank, they did not ask for
    // an invisible link.
    text: display && display.trim() ? display : target,
    embed: match[1] === '!',
  };
}

/** The three kinds of document a link can point at, in resolution order. */
export const LINK_SECTIONS = ['notes', 'studies', 'games'] as const;
export type LinkSection = (typeof LINK_SECTIONS)[number];

/** Document ids per section, as the resolver needs them. */
export type LinkIndex = Readonly<Record<LinkSection, readonly string[]>>;

/**
 * The other names documents answer to, lowercased alias -> id.
 *
 * A filename and the way you refer to something in a sentence are
 * different things: the study is called `Openings/Sicilian Defence —
 * Najdorf Variation` because that sorts and reads well in a list, and
 * mid-sentence you write "the Najdorf". Display text solves how it READS;
 * an alias solves what you have to TYPE.
 */
export type AliasIndex = Readonly<Record<LinkSection, ReadonlyMap<string, readonly string[]>>>;

/**
 * Build one section's alias map, marking any name two documents claim.
 *
 * Nothing stops two documents declaring the same alias, and the first
 * version of this let the first one seen win — on both sides, over two
 * different orderings. The server walked the directory; the browser read
 * the listing, which is sorted newest-first. Measured on a seeded vault:
 * clicking `[[Dup]]` opened one note while the backlink for that very link
 * appeared on the other. Both answers were individually plausible and
 * nothing reported a fault, which is the failure this module exists to
 * prevent — introduced by this module.
 *
 * So a contested alias resolves to nothing, exactly as two documents
 * sharing a last segment already do. Refusing to guess is the same answer
 * on every side however each one iterates, and the writer is told: only
 * they know which document they meant.
 */
export function buildAliasMap(
  entries: Iterable<{ id: string; aliases?: readonly string[] }>,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const { id, aliases } of entries) {
    for (const name of aliases ?? []) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      const held = map.get(key);
      if (!held) map.set(key, [id]);
      // Every claimant is kept, not just the count: a contested alias has
      // to be able to say WHICH documents claimed it, because the writer
      // is going to be asked which one they meant.
      else if (!held.includes(id)) held.push(id);
    }
  }
  // Sorted so the answer does not depend on which side built it — the
  // whole point of this being one function.
  for (const ids of map.values()) ids.sort();
  return map;
}

export const NO_ALIASES: AliasIndex = {
  notes: new Map(),
  studies: new Map(),
  games: new Map(),
};

export interface ResolvedLink {
  readonly section: LinkSection;
  readonly id: string;
}

/**
 * Why a target did not resolve. Kept apart because they want different
 * answers: a broken link is a typo or a deleted document, while an
 * ambiguous one means two documents share a last segment and the writer
 * has to say which. Both are currently invisible in the app — see the
 * console.warn in the editor — and having them named is the start of
 * showing them.
 */
export type LinkFailure = 'broken' | 'ambiguous';

const tail = (id: string): string => id.split('/').at(-1)!;

/**
 * Resolve `target` against the vault's documents.
 *
 * Returns the document it names, or why it names none.
 */
export function resolveWikiLink(
  target: string,
  index: LinkIndex,
  aliases: AliasIndex = NO_ALIASES,
): ResolvedLink | LinkFailure {
  const wanted = target.trim().toLowerCase();
  if (!wanted) return 'broken';

  // Three passes, not one loop per section. A name is matched as strongly
  // as it can be ANYWHERE before a weaker match is considered: an exact id
  // in games beats a loose last-segment match in notes, because the writer
  // who typed a full id meant it. Within a pass, the section order decides.
  for (const section of LINK_SECTIONS) {
    const exact = index[section].find((id) => id.toLowerCase() === wanted);
    if (exact) return { section, id: exact };
  }

  // An alias is a name its document chose, so it outranks a last segment,
  // which is a name that merely happens to collide.
  let ambiguous = false;
  for (const section of LINK_SECTIONS) {
    const named = aliases[section].get(wanted) ?? [];
    if (named.length === 1) return { section, id: named[0]! };
    // Claimed by two documents in this section — see buildAliasMap. Noted
    // and passed over rather than answered, the same as a repeated last
    // segment: a weaker match elsewhere may still be unambiguous.
    if (named.length > 1) ambiguous = true;
  }

  // Ambiguity is only reported if nothing matched outright anywhere.
  for (const section of LINK_SECTIONS) {
    const tails = index[section].filter((id) => tail(id).toLowerCase() === wanted);
    if (tails.length === 1) return { section, id: tails[0]! };
    if (tails.length > 1) ambiguous = true;
  }

  return ambiguous ? 'ambiguous' : 'broken';
}

/**
 * Every document a target could have meant, strongest match first.
 *
 * For when resolution declined to answer. `resolveWikiLink` returning
 * 'ambiguous' is the right call — guessing between two documents is worse
 * than not guessing — but it left the reader with a link that did nothing
 * at all when pressed, which is a dead end rather than a decision. These
 * are the candidates to offer them.
 */
export function wikiLinkCandidates(
  target: string,
  index: LinkIndex,
  aliases: AliasIndex = NO_ALIASES,
): ResolvedLink[] {
  const wanted = target.trim().toLowerCase();
  const found: ResolvedLink[] = [];
  if (!wanted) return found;
  const add = (section: LinkSection, id: string): void => {
    if (!found.some((f) => f.section === section && f.id === id)) found.push({ section, id });
  };
  // Same three passes, in the same order, so the list reads as the
  // resolver's own reasoning rather than a second opinion about it.
  for (const section of LINK_SECTIONS) {
    for (const id of index[section]) if (id.toLowerCase() === wanted) add(section, id);
  }
  for (const section of LINK_SECTIONS) {
    for (const id of aliases[section].get(wanted) ?? []) add(section, id);
  }
  for (const section of LINK_SECTIONS) {
    for (const id of index[section]) if (tail(id).toLowerCase() === wanted) add(section, id);
  }
  return found;
}

export interface WikiMention {
  /**
   * The document the link names — what resolution is given.
   *
   * NOT what the reader sees: `[[Target|display]]` shows `display` and
   * points at `Target`, and this field is the second of those. It used to
   * be the first, and the consequence was silent: a backlink is derived by
   * resolving this string, so every display-text link resolved the
   * writer's words instead of the document, found nothing, and was dropped
   * — the target listed no mention of a link that opened it perfectly well
   * when pressed. `shown` is the other half, for whoever needs it.
   */
  readonly target: string;
  /**
   * The words as the reader sees them, brackets and pipe gone.
   *
   * What a context highlight marks, and what the offer to wrap an unlinked
   * mention writes back. Equal to `target` for a plain link, which is why
   * one field passed for both until a display text told them apart.
   */
  readonly shown: string;
  /** Character offset of the `[[` within the document body. */
  readonly at: number;
  /** The sentence it sits in, for showing the mention in context. */
  readonly context: string;
  /**
   * Where inside `context` the matched words start, when that is known.
   *
   * A context can hold the same name twice, and the reader has to be able
   * to see which one a row is about. Absent means "find it yourself", which
   * is right where a mention is the only one in its sentence.
   */
  readonly markAt?: number;
}

/**
 * How many times `shown` already appears in a window, as the CONTEXT will
 * read it rather than as the markdown spells it.
 *
 * The window still holds its brackets and pipes; the context has had them
 * taken out. Counting the raw text would miss that `[[Target|Najdorf]]`
 * contributes one "Najdorf" to what the reader sees, so the window is put
 * through the same reading first.
 */
function countShown(window: string, shown: string): number {
  const prose = asProse(window).toLowerCase();
  const wanted = shown.toLowerCase();
  if (!wanted) return 0;
  let count = 0;
  for (let at = prose.indexOf(wanted); at >= 0; at = prose.indexOf(wanted, at + wanted.length)) {
    count += 1;
  }
  return count;
}

/** Index of the `nth` (0-based) case-insensitive occurrence, or -1. */
function nthIndexOf(haystack: string, needle: string, nth: number): number {
  const lower = haystack.toLowerCase();
  const wanted = needle.toLowerCase();
  let at = -1;
  for (let i = 0; i <= nth; i += 1) {
    at = lower.indexOf(wanted, at + 1);
    if (at < 0) return -1;
  }
  return at;
}

/** How much text either side of a mention is worth showing. */
const CONTEXT_BEFORE = 90;
const CONTEXT_AFTER = 90;

/**
 * Every `[[link]]` in one document body, with enough surrounding text to
 * show why it was written.
 *
 * A backlink that is only a document name makes the reader open it to find
 * out whether it mattered; the sentence around the link usually answers
 * that on the spot. The window is trimmed to whitespace so it does not cut
 * a word in half, and the brackets are dropped from the context so it
 * reads as prose.
 */
export function findWikiMentions(body: string): WikiMention[] {
  const found: WikiMention[] = [];
  for (const match of body.matchAll(WIKI_RE)) {
    const at = match.index;
    const end = at + match[0].length;
    const [from, to] = sentenceAround(body, at, end);
    const { target, text } = parseWikiMatch(match);
    // Both halves, kept apart: the context reads as the note reads, so the
    // highlight follows the display text, while resolution has to follow
    // the target or a display-text link points nowhere.
    const shown = text === target ? target : text;
    const context = asProse(body.slice(from, to));
    // WHICH of them, when a sentence links the same document twice. Without
    // this both rows marked the first occurrence and looked identical —
    // the unlinked side learned this first, and the linked side had exactly
    // the same fault for exactly as long.
    const earlier = countShown(body.slice(from, at), shown);
    found.push({ target, shown, at, context, markAt: nthIndexOf(context, shown, earlier) });
  }
  return found;
}

/**
 * The shortest name worth hunting for unlinked.
 *
 * Two characters match far too much prose to be a suggestion: a document
 * called "e4" would report every mention of the move. Three is enough to
 * keep ECO codes, which are the case this vault actually wants.
 */
const MIN_MENTION = 3;

const escapeRe = (raw: string): string => raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where a document is NAMED in a body without being linked to.
 *
 * Obsidian's "unlinked mentions": the writer typed the name and did not
 * make it a link, usually because they were writing rather than filing.
 * Offered, never applied — the note belongs to whoever wrote it.
 *
 * The rules are all about not crying wolf, because this is the one feature
 * here that can produce more noise than signal. A vault of chess notes says
 * "Najdorf" constantly without meaning the document:
 *
 *  - Whole names only. `\b` is no use when a name can contain spaces and
 *    punctuation, so the bounds are "not a letter or a number either side"
 *    — which keeps "Najdorf" out of "Najdorfian" and finds it in "the
 *    Najdorf, again".
 *  - Nothing already inside a `[[link]]`, including the display half of
 *    `[[Target|display]]`: that IS the link, and offering to link it again
 *    would be offering to break it.
 *  - Nothing shorter than three characters.
 *
 * What it deliberately does NOT do is judge whether the sentence meant the
 * document. It cannot, and pretending otherwise is how a suggestion list
 * becomes something people learn to dismiss unread.
 */
export function findUnlinkedMentions(body: string, names: readonly string[]): WikiMention[] {
  const linked: [number, number][] = [];
  for (const match of body.matchAll(WIKI_RE)) {
    linked.push([match.index, match.index + match[0].length]);
  }
  const inLink = (at: number): boolean => linked.some(([from, to]) => at >= from && at < to);

  const found: WikiMention[] = [];
  const seen = new Set<number>();
  for (const name of names) {
    const wanted = name.trim();
    if (wanted.length < MIN_MENTION) continue;
    // Unicode letter/number classes, so the bound holds for a name in any
    // script rather than only for ASCII.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(wanted)}(?![\\p{L}\\p{N}])`, 'giu');
    for (const match of body.matchAll(re)) {
      const at = match.index;
      if (inLink(at) || seen.has(at)) continue;
      seen.add(at);
      const [from, to] = sentenceAround(body, at, at + match[0].length);
      const context = asProse(body.slice(from, to));
      // WHICH occurrence this is, counted inside the window. A sentence
      // naming the document twice yields two mentions with the same
      // context, and a reader offered two identical-looking rows has to be
      // able to see which word each one is about — otherwise linking the
      // second appears to do nothing to the first.
      const earlier = [...body.slice(from, at).matchAll(re)].length;
      // A name found in prose is both at once: there are no brackets to
      // hold a display text apart from what it points at.
      const words = match[0];
      found.push({ target: words, shown: words, at, context, markAt: nthIndexOf(context, words, earlier) });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** Ends a sentence. A bare newline does not — see `sentenceAround`. */
const SENTENCE_END = /[.!?]/;

/** A blank line: the one break that is always a change of subject. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/**
 * The paragraph a link sits in — the outermost the context may reach.
 *
 * A single newline is just where the text wrapped, so it is not a break: a
 * link written alone on its own line, which is how a list of links is
 * written, would otherwise have a context of nothing but its own name.
 */
function paragraphAround(body: string, at: number, end: number): [number, number] {
  const before = [...body.slice(0, at).matchAll(new RegExp(PARAGRAPH_BREAK, 'g'))].at(-1);
  const after = PARAGRAPH_BREAK.exec(body.slice(end));
  return [
    before ? before.index + before[0].length : 0,
    after ? end + after.index : body.length,
  ];
}

/**
 * The bounds of the sentence a link sits in, clamped to a window.
 *
 * A fixed character window was the first attempt and read badly: it opened
 * mid-clause, so every mention began with the tail of whatever preceded it
 * and the reader had to find the link before the line made sense. Starting
 * at a sentence boundary puts the point first.
 *
 * The window is still the outer limit, for the paragraph that runs for a
 * page without a full stop. Where no boundary is found inside it, the
 * window's own edge is used, nudged to a word so it does not cut one in
 * half.
 */
function sentenceAround(body: string, at: number, end: number): [number, number] {
  const [paraFrom, paraTo] = paragraphAround(body, at, end);
  const floor = Math.max(paraFrom, at - CONTEXT_BEFORE);
  const ceil = Math.min(paraTo, end + CONTEXT_AFTER);

  let from = floor > paraFrom ? trimToWord(body, floor, 'start') : floor;
  for (let i = at - 1; i >= floor; i -= 1) {
    if (SENTENCE_END.test(body[i]!)) {
      from = i + 1;
      break;
    }
  }

  let to = ceil < paraTo ? trimToWord(body, ceil, 'end') : ceil;
  for (let i = end; i < ceil; i += 1) {
    if (SENTENCE_END.test(body[i]!)) {
      // Keep the stop itself: a sentence ending in mid-air reads as
      // truncated even when it is complete.
      to = i + 1;
      break;
    }
  }

  return [from, to];
}

/**
 * A window of markdown, read back as the sentence it says.
 *
 * The window is a slice of a source file, so it arrives carrying whatever
 * syntax happened to fall inside it — a `## Related` heading, a bullet, the
 * asterisks around a bold run. Rendered into a one-line mention those read
 * as noise, and the reader is being shown this line to judge whether the
 * link is worth following, not to see how it was typed.
 *
 * Only the marks that are pure syntax are removed. Nothing here tries to
 * be a markdown parser: a stray asterisk mid-sentence survives, which is
 * the right way to be wrong.
 */
function asProse(window: string): string {
  return window
    // A link reads as what the note shows: the display text where one was
    // given, the target otherwise, and neither the pipe nor an embed's `!`.
    .replace(WIKI_RE, (_whole, _bang: string, target: string, display?: string) =>
      display && display.trim() ? display : target,
    )
    // Line-leading marks, while the newlines are still here to find them by.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Rewrite the links in one note body after a document was renamed.
 *
 * Renaming used to break every link pointing at the document, silently:
 * navigation stopped working and — since backlinks — the document also
 * started claiming nothing pointed at it. Obsidian rewrites the links, and
 * so does this.
 *
 * The care is all in NOT rewriting too much. `index` is the vault as it is
 * AFTER the move, and a target that still resolves to something is left
 * alone even when it looks like the old name: `[[Najdorf]]` beside a note
 * actually called Najdorf means that note, and renaming an unrelated study
 * whose last segment was also "Najdorf" must not touch it. Only a target
 * that named the moved document and now names nothing is rewritten.
 *
 * How it is rewritten follows how it was written. A writer who typed the
 * last segment gets the new last segment, if that is unambiguous; a writer
 * who typed the full id gets the full new id. Turning every short link
 * into a path would be correct and would also rewrite the note into
 * something its author did not write.
 */
export function renameLinksIn(
  body: string,
  from: string,
  to: string,
  index: LinkIndex,
): string | null {
  const oldId = from.toLowerCase();
  const oldTail = tail(from).toLowerCase();
  const newTail = tail(to);
  // Is the new last segment enough on its own? Only then can a short link
  // stay short.
  const tailWorks = resolveWikiLink(newTail, index);
  const short = typeof tailWorks !== 'string' && tailWorks.id === to ? newTail : to;

  let touched = false;
  const next = body.replace(
    WIKI_RE,
    (whole, bang: string, target: string, display?: string) => {
      const wanted = target.trim().toLowerCase();
      if (wanted !== oldId && wanted !== oldTail) return whole;
      // Still means something? Then it was never pointing at what moved --
      // or the move did not disturb it -- and rewriting would be a guess.
      if (typeof resolveWikiLink(target, index) !== 'string') return whole;
      touched = true;
      const named = wanted === oldTail && wanted !== oldId ? short : to;
      // Only the target moves. The display text is the writer's sentence
      // and an embed stays an embed -- rewriting either would edit what
      // the note says, not where it points.
      return `${bang}[[${named}${display === undefined ? '' : `|${display}`}]]`;
    },
  );

  return touched ? next : null;
}

/** Nudge an offset to the nearest whitespace so a window starts on a word. */
function trimToWord(text: string, at: number, edge: 'start' | 'end'): number {
  if (at <= 0 || at >= text.length) return at;
  const step = edge === 'start' ? 1 : -1;
  let i = at;
  // Give up rather than walk far: a long unbroken run has no word edge to
  // find, and half of one is better than a window of nothing.
  for (let moved = 0; moved < 20 && i > 0 && i < text.length; moved += 1, i += step) {
    if (/\s/.test(text[i]!)) return edge === 'start' ? i + 1 : i;
  }
  return at;
}
