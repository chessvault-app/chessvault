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
 *   elo:2500 · elo:2400-2600       — the weaker player's floor, or band
 *
 * Anything else stays plain text with the caller's own behaviour.
 * A known qualifier whose value is missing or unparseable becomes an
 * ISSUE — reported so the box can warn, and dropped from the search
 * (an intended filter that silently matched nothing, or silently
 * became text, was the worse of both). Terms that PARSE but cannot
 * all hold in one game — two exact scores, years that share no span,
 * two names on one seat, more names than a game has seats — become an
 * `impossible` issue and stay in the search: the zero rows they find
 * are correct, the warning says why.
 */

export type SearchTerm =
  | { kind: 'player' | 'white' | 'black' | 'opening' | 'event'; value: string }
  | { kind: 'eco'; value: string }
  | { kind: 'result'; value: '1-0' | '0-1' | '1/2-1/2' }
  | { kind: 'year'; from: number; to: number }
  /** The game's WEAKER player in [lo, hi] — `elo:2500` is a floor on
      both (hi null), `elo:2400-2600` a band, `elo:2400-` the open-top
      spelling of the floor. The window's strength filters compile the
      same clause. */
  | { kind: 'elo'; lo: number; hi: number | null };

export interface SearchIssue {
  qualifier: string;
  kind: 'empty' | 'bad-result' | 'bad-year' | 'bad-elo' | 'impossible';
  /** For `impossible`: the conflicting tokens, ` · `-joined, for the
      warning to quote. */
  value?: string;
  /** The offending token exactly as typed — how a box can tell a
      finished mistake from one still under the caret. For
      `impossible`, the LAST token of the conflict, so the warning
      waits until the token that completes it is finished. */
  raw: string;
  /** True when the conflict is with the ACTIVE FILTERS rather than
      inside the query — findCrossImpossible's issues, worded
      differently by the box. */
  cross?: boolean;
}

/**
 * The other surface's constraints, as findCrossImpossible reads them:
 * the quick row's score and strength, and the filter window's sentence.
 * Every slot optional — pass what is set, the same values the search
 * request itself carries.
 */
export interface FilterConstraints {
  result?: string;
  minElo?: number;
  band?: { lo: number; hi: number | null };
  player?: string;
  side?: 'any' | 'white' | 'black';
  outcome?: 'any' | 'won' | 'lost' | 'drawn';
  player2?: string;
  /** ISO dates, as the from/to fields hold them. */
  from?: string;
  to?: string;
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
  'elo',
] as const;
const PREFIX_SET = new Set<string>(SEARCH_PREFIXES);

const normalizeResult = (value: string): '1-0' | '0-1' | '1/2-1/2' | null => {
  const norm =
    value.toLowerCase() === 'draw' || value === '½-½' || value === '1/2-1/2' ? '1/2-1/2' : value;
  return norm === '1-0' || norm === '0-1' || norm === '1/2-1/2' ? norm : null;
};

const parseYearSpan = (value: string): { from: number; to: number } | null => {
  const m = /^(\d{4})(?:-(\d{4}))?$/.exec(value);
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] !== undefined ? Number(m[2]) : from;
  return to >= from ? { from, to } : null;
};

/** "2500" (floor), "2400-2600" (band), "2400-" (open top — the same
    floor, spelled as a span). */
const parseEloSpan = (value: string): { lo: number; hi: number | null } | null => {
  const m = /^(\d{3,4})(?:-(\d{3,4})?)?$/.exec(value);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = m[2] !== undefined ? Number(m[2]) : null;
  if (hi !== null && hi < lo) return null;
  return { lo, hi };
};

/** Two name constraints that can hold on ONE name — one contains the
    other, the way `white:carl` and `white:carlsen` both match Carlsen.
    Matching is substring matching, so this is the honest test of
    "these could be the same person". */
const namesCompatible = (a: string, b: string): boolean => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.includes(y) || y.includes(x);
};

/** Constraints bucketed into "could be the same name" groups —
    containment-greedy, which is enough for a warning. */
const nameGroups = <T extends { value: string }>(vals: T[]): T[][] => {
  const groups: T[][] = [];
  for (const v of vals) {
    const g = groups.find((members) => members.some((m) => namesCompatible(m.value, v.value)));
    if (g) g.push(v);
    else groups.push([v]);
  }
  return groups;
};

/** The provable contradictions, appended as `impossible` issues. The
    judged cases: two exact scores, year spans with no common year,
    incompatible names on one seat, and more distinct names than a
    game's two seats. `eco:` against `opening:` is deliberately NOT
    judged — opening: matches the database's own free-text names,
    which no catalogue can be trusted to mirror. */
const findImpossible = (withRaw: { term: SearchTerm; raw: string }[], issues: SearchIssue[]) => {
  const impossible = (qualifier: string, raws: string[]) => {
    // The same token typed twice is one constraint — quote it once.
    const involved = [...new Set(raws)];
    issues.push({
      qualifier,
      kind: 'impossible',
      value: involved.join(' · '),
      raw: involved[involved.length - 1] ?? '',
    });
  };

  const results = withRaw.filter((t) => t.term.kind === 'result');
  if (new Set(results.map((t) => (t.term as { value: string }).value)).size > 1) {
    impossible('result', results.map((t) => t.raw));
  }

  const years = withRaw.filter((t) => t.term.kind === 'year');
  if (years.length > 1) {
    const spans = years.map((t) => t.term as { from: number; to: number });
    const lo = Math.max(...spans.map((s) => s.from));
    const hi = Math.min(...spans.map((s) => s.to));
    if (lo > hi) impossible('year', years.map((t) => t.raw));
  }

  const elos = withRaw.filter((t) => t.term.kind === 'elo');
  if (elos.length > 1) {
    const spans = elos.map((t) => t.term as { lo: number; hi: number | null });
    const lo = Math.max(...spans.map((s) => s.lo));
    const hi = Math.min(...spans.map((s) => s.hi ?? Infinity));
    if (lo > hi) impossible('elo', elos.map((t) => t.raw));
  }

  const seat = (kind: 'white' | 'black' | 'player') =>
    withRaw
      .filter((t) => t.term.kind === kind)
      .map((t) => ({ value: (t.term as { value: string }).value, raw: t.raw }));
  const firstRaws = (groups: { raw: string }[][]) =>
    groups.flatMap((g) => (g.length > 0 ? [g[0]!.raw] : []));
  const whites = nameGroups(seat('white'));
  const blacks = nameGroups(seat('black'));
  if (whites.length > 1) impossible('white', firstRaws(whites));
  else if (blacks.length > 1) impossible('black', firstRaws(blacks));
  else {
    // Each seat holds at most one name, so more than two distinct
    // names across every player constraint leaves somebody standing.
    const all = nameGroups([...seat('white'), ...seat('black'), ...seat('player')]);
    if (all.length > 2) impossible('player', firstRaws(all));
  }
};

/** The parse with each term's raw token kept — parseSearchQuery's
    public shape drops the raws; findCrossImpossible needs them. */
function parseWithRaws(q: string): {
  text: string;
  terms: SearchTerm[];
  issues: SearchIssue[];
  withRaw: { term: SearchTerm; raw: string }[];
} {
  // Tokens split on whitespace, with double quotes holding a phrase
  // together — `event:"tata steel"` is one token.
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const unquote = (s: string): string => s.replace(/"/g, '').trim();
  const textParts: string[] = [];
  const terms: SearchTerm[] = [];
  const issues: SearchIssue[] = [];
  const withRaw: { term: SearchTerm; raw: string }[] = [];

  const add = (term: SearchTerm, raw: string) => {
    terms.push(term);
    withRaw.push({ term, raw });
  };

  for (const raw of tokens) {
    const colon = raw.indexOf(':');
    const key = colon > 0 ? raw.slice(0, colon).toLowerCase() : '';
    if (colon > 0 && PREFIX_SET.has(key)) {
      const value = unquote(raw.slice(colon + 1));
      if (!value) {
        issues.push({ qualifier: key, kind: 'empty', raw });
        continue;
      }
      if (key === 'result') {
        const norm = normalizeResult(value);
        if (norm) {
          add({ kind: 'result', value: norm }, raw);
        } else {
          issues.push({ qualifier: key, kind: 'bad-result', value, raw });
        }
        continue;
      }
      if (key === 'year') {
        const span = parseYearSpan(value);
        if (span) {
          add({ kind: 'year', from: span.from, to: span.to }, raw);
        } else {
          issues.push({ qualifier: key, kind: 'bad-year', value, raw });
        }
        continue;
      }
      if (key === 'elo') {
        const span = parseEloSpan(value);
        if (span) {
          add({ kind: 'elo', lo: span.lo, hi: span.hi }, raw);
        } else {
          issues.push({ qualifier: key, kind: 'bad-elo', value, raw });
        }
        continue;
      }
      // `opponent:` is the window's Against slot wearing its search
      // name — the same constraint as another player: term.
      add(
        {
          kind: key === 'opponent' ? 'player' : (key as 'player' | 'white' | 'black' | 'opening' | 'event' | 'eco'),
          value,
        },
        raw,
      );
      continue;
    }
    textParts.push(unquote(raw));
  }

  findImpossible(withRaw, issues);
  return { text: textParts.join(' ').trim(), terms, issues, withRaw };
}

export function parseSearchQuery(q: string): {
  text: string;
  terms: SearchTerm[];
  issues: SearchIssue[];
} {
  const { text, terms, issues } = parseWithRaws(q);
  return { text, terms, issues };
}

/**
 * The contradictions BETWEEN the surfaces: a query term the active
 * filters leave no room for. Same judged cases as inside the query —
 * exact scores, date spans, elo bands, seats — with the filter
 * window's relative constraints translated first (a player's
 * "won as White" IS result 1-0; "won" with no side merely excludes
 * the draw). Only conflicts a query term participates in are
 * reported: the window arguing with itself is the window's own
 * business, and it has its own hint for that.
 */
export function findCrossImpossible(q: string, f: FilterConstraints): SearchIssue[] {
  const { withRaw } = parseWithRaws(q);
  const issues: SearchIssue[] = [];
  const cross = (qualifier: string, involved: string[], lastRaw: string) => {
    issues.push({
      qualifier,
      kind: 'impossible',
      cross: true,
      value: [...new Set(involved)].join(' · '),
      raw: lastRaw,
    });
  };

  // What the filters say about the exact score. A named player's
  // outcome pins it only WITH a side; without one, won/lost still
  // rules out the draw.
  const exactResult =
    f.result === '1-0' || f.result === '0-1' || f.result === '1/2-1/2'
      ? f.result
      : f.player && f.outcome === 'drawn'
        ? '1/2-1/2'
        : f.player && (f.outcome === 'won' || f.outcome === 'lost') && f.side === 'white'
          ? f.outcome === 'won'
            ? '1-0'
            : '0-1'
          : f.player && (f.outcome === 'won' || f.outcome === 'lost') && f.side === 'black'
            ? f.outcome === 'won'
              ? '0-1'
              : '1-0'
            : null;
  const excludesDraw =
    Boolean(f.player) && (f.outcome === 'won' || f.outcome === 'lost') && f.side === 'any';
  for (const t of withRaw) {
    if (t.term.kind !== 'result') continue;
    if (exactResult && t.term.value !== exactResult) cross('result', [t.raw], t.raw);
    else if (excludesDraw && t.term.value === '1/2-1/2') cross('result', [t.raw], t.raw);
  }

  // Dates: the query's years against the window's from/to, compared as
  // dates. Skipped when the years already contradict each other — that
  // warning stands on its own.
  const years = withRaw.filter((t) => t.term.kind === 'year');
  if (years.length > 0 && (f.from || f.to)) {
    const spans = years.map((t) => t.term as { from: number; to: number });
    let lo = `${Math.max(...spans.map((s) => s.from))}-01-01`;
    let hi = `${Math.min(...spans.map((s) => s.to))}-12-31`;
    if (lo <= hi) {
      if (f.from && f.from > lo) lo = f.from;
      if (f.to && f.to < hi) hi = f.to;
      if (lo > hi) cross('year', years.map((t) => t.raw), years[years.length - 1]!.raw);
    }
  }

  // Elo: the query's bands against the quick row's floor and the
  // window's band, one intersection.
  const elos = withRaw.filter((t) => t.term.kind === 'elo');
  if (elos.length > 0 && ((f.minElo ?? 0) > 0 || f.band)) {
    const spans = elos.map((t) => t.term as { lo: number; hi: number | null });
    let lo = Math.max(...spans.map((s) => s.lo));
    let hi = Math.min(...spans.map((s) => s.hi ?? Infinity));
    if (lo <= hi) {
      lo = Math.max(lo, f.minElo ?? 0, f.band?.lo ?? 0);
      hi = Math.min(hi, f.band?.hi ?? Infinity);
      if (lo > hi) cross('elo', elos.map((t) => t.raw), elos[elos.length - 1]!.raw);
    }
  }

  // Seats: the window's player takes the seat its side names (either
  // seat on "any"), the opponent either seat — then the same grouping
  // as inside the query. Filter names show as bare names in the
  // warning; query terms as typed.
  const qSeat = (kind: 'white' | 'black' | 'player') =>
    withRaw
      .filter((t) => t.term.kind === kind)
      .map((t) => ({ value: (t.term as { value: string }).value, raw: t.raw as string | undefined }));
  const fName = (name: string | undefined) =>
    name?.trim() ? [{ value: name.trim(), raw: undefined }] : [];
  const fWhite = f.side === 'white' ? fName(f.player) : [];
  const fBlack = f.side === 'black' ? fName(f.player) : [];
  const fEither = [...(f.side === 'white' || f.side === 'black' ? [] : fName(f.player)), ...fName(f.player2)];
  const seatConflict = (
    qualifier: string,
    entries: { value: string; raw: string | undefined }[],
    seats: number,
  ) => {
    if (!entries.some((e) => e.raw !== undefined)) return false; // window-internal
    const groups = nameGroups(entries);
    if (groups.length <= seats) return false;
    const qRaws = entries.filter((e) => e.raw !== undefined).map((e) => e.raw!);
    cross(
      qualifier,
      groups.map((g) => g[0]!.raw ?? g[0]!.value),
      qRaws[qRaws.length - 1]!,
    );
    return true;
  };
  if (
    !seatConflict('white', [...qSeat('white'), ...fWhite], 1) &&
    !seatConflict('black', [...qSeat('black'), ...fBlack], 1)
  ) {
    seatConflict(
      'player',
      [...qSeat('white'), ...fWhite, ...qSeat('black'), ...fBlack, ...qSeat('player'), ...fEither],
      2,
    );
  }

  return issues;
}

/**
 * The query split for a token-chip search box: every FINISHED valid
 * qualifier token becomes a chip, and everything else — plain words,
 * invalid qualifiers (the warning box explains those), and the token
 * still under the caret — stays editable text. "Finished" means not
 * the trailing token, unless the query ends in whitespace. Composing
 * `[...chips, text]` back with spaces reproduces an equivalent query,
 * which is what keeps the string the single source of truth.
 */
export function splitQueryChips(q: string): { chips: string[]; text: string } {
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const endsSpace = /\s$/.test(q);
  const chips: string[] = [];
  const rest: string[] = [];
  tokens.forEach((raw, i) => {
    const unfinished = i === tokens.length - 1 && !endsSpace;
    const colon = raw.indexOf(':');
    const key = colon > 0 ? raw.slice(0, colon).toLowerCase() : '';
    if (!unfinished && colon > 0 && PREFIX_SET.has(key)) {
      const value = raw
        .slice(colon + 1)
        .replace(/"/g, '')
        .trim();
      const valid =
        value !== '' &&
        (key === 'result'
          ? normalizeResult(value) !== null
          : key === 'year'
            ? parseYearSpan(value) !== null
            : key === 'elo'
              ? parseEloSpan(value) !== null
              : true);
      if (valid) {
        chips.push(raw);
        return;
      }
    }
    rest.push(raw);
  });
  return { chips, text: rest.join(' ') + (endsSpace && rest.length > 0 ? ' ' : '') };
}

/** The chips and the tail back into one query string. */
export function composeQueryChips(chips: string[], text: string): string {
  const base = chips.join(' ');
  if (!base) return text;
  return text ? `${base} ${text}` : `${base} `;
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
    whiteElo?: number | null;
    blackElo?: number | null;
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
    } else if (term.kind === 'elo') {
      // The WEAKER player carries the game into the band — the same
      // MIN(white_elo, black_elo) the server compiles. An unrated game
      // (0 or absent) never qualifies, as 0 never clears a floor.
      const min = Math.min(g.whiteElo ?? 0, g.blackElo ?? 0);
      if (min < term.lo || (term.hi !== null && min > term.hi)) return false;
    }
  }
  return true;
}
