/**
 * The game-search box's small query language, parsed HERE so the server
 * (which compiles terms to SQL for the reference databases) and the
 * browser (which matches them over the collection's rows in the page)
 * speak the same words by the same parser — shared code, never a twin.
 *
 *   player:name · opponent:name    — a participant, either seat
 *   white:name · black:name        — a seat apiece
 *   opening:najdorf · eco:B90      — name substring; code prefix
 *   event:"tata steel"             — quotes hold spaces together
 *   result:1-0 | 0-1 | draw        — the literal score
 *   year:2014 · year:2010-2015     — a year, or a span
 *
 * Anything else stays plain text with the caller's own behaviour.
 * A known qualifier whose value is missing or unparseable becomes an
 * ISSUE — reported so the box can warn, and dropped from the search
 * (an intended filter that silently matched nothing, or silently
 * became text, was the worse of both).
 */

export type SearchTerm =
  | { kind: 'player' | 'white' | 'black' | 'opening' | 'event'; value: string }
  | { kind: 'eco'; value: string }
  | { kind: 'result'; value: '1-0' | '0-1' | '1/2-1/2' }
  | { kind: 'year'; from: number; to: number };

export interface SearchIssue {
  qualifier: string;
  kind: 'empty' | 'bad-result' | 'bad-year';
  value?: string;
}

export const SEARCH_PREFIXES = [
  'player',
  'opponent',
  'white',
  'black',
  'opening',
  'event',
  'eco',
  'result',
  'year',
] as const;
const PREFIX_SET = new Set<string>(SEARCH_PREFIXES);

export function parseSearchQuery(q: string): {
  text: string;
  terms: SearchTerm[];
  issues: SearchIssue[];
} {
  // Tokens split on whitespace, with double quotes holding a phrase
  // together — `event:"tata steel"` is one token.
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const unquote = (s: string): string => s.replace(/"/g, '').trim();
  const textParts: string[] = [];
  const terms: SearchTerm[] = [];
  const issues: SearchIssue[] = [];

  for (const raw of tokens) {
    const colon = raw.indexOf(':');
    const key = colon > 0 ? raw.slice(0, colon).toLowerCase() : '';
    if (colon > 0 && PREFIX_SET.has(key)) {
      const value = unquote(raw.slice(colon + 1));
      if (!value) {
        issues.push({ qualifier: key, kind: 'empty' });
        continue;
      }
      if (key === 'result') {
        const norm =
          value.toLowerCase() === 'draw' || value === '½-½' || value === '1/2-1/2'
            ? '1/2-1/2'
            : value;
        if (norm === '1-0' || norm === '0-1' || norm === '1/2-1/2') {
          terms.push({ kind: 'result', value: norm });
        } else {
          issues.push({ qualifier: key, kind: 'bad-result', value });
        }
        continue;
      }
      if (key === 'year') {
        const m = /^(\d{4})(?:-(\d{4}))?$/.exec(value);
        const from = m ? Number(m[1]) : 0;
        const to = m && m[2] !== undefined ? Number(m[2]) : from;
        if (m && to >= from) {
          terms.push({ kind: 'year', from, to });
        } else {
          issues.push({ qualifier: key, kind: 'bad-year', value });
        }
        continue;
      }
      // `opponent:` is the window's Against slot wearing its search
      // name — the same constraint as another player: term.
      terms.push({
        kind: key === 'opponent' ? 'player' : (key as 'player' | 'white' | 'black' | 'opening' | 'event' | 'eco'),
        value,
      });
      continue;
    }
    textParts.push(unquote(raw));
  }

  return { text: textParts.join(' ').trim(), terms, issues };
}

/**
 * The same terms, answered against a row already in the page — the
 * collection's side of the language. Mirrors what the server compiles
 * to SQL: substrings for names and events, a prefix for ECO, the
 * literal score, the date's year.
 */
export function matchesSearchTerms(
  terms: SearchTerm[],
  g: {
    white: string;
    black: string;
    result: string;
    date: string | null;
    eco: string | null;
    opening?: { eco: string; name: string } | string | null;
    event?: string | null;
  },
): boolean {
  const openingName = (
    typeof g.opening === 'string' ? g.opening : (g.opening?.name ?? '')
  ).toLowerCase();
  for (const term of terms) {
    if (term.kind === 'player') {
      const v = term.value.toLowerCase();
      if (!g.white.toLowerCase().includes(v) && !g.black.toLowerCase().includes(v)) return false;
    } else if (term.kind === 'white') {
      if (!g.white.toLowerCase().includes(term.value.toLowerCase())) return false;
    } else if (term.kind === 'black') {
      if (!g.black.toLowerCase().includes(term.value.toLowerCase())) return false;
    } else if (term.kind === 'opening') {
      if (!openingName.includes(term.value.toLowerCase())) return false;
    } else if (term.kind === 'eco') {
      if (!(g.eco ?? '').toLowerCase().startsWith(term.value.toLowerCase())) return false;
    } else if (term.kind === 'event') {
      if (!(g.event ?? '').toLowerCase().includes(term.value.toLowerCase())) return false;
    } else if (term.kind === 'result') {
      if (g.result !== term.value) return false;
    } else if (term.kind === 'year') {
      const year = Number((g.date ?? '').slice(0, 4));
      if (!Number.isFinite(year) || year < term.from || year > term.to) return false;
    }
  }
  return true;
}
