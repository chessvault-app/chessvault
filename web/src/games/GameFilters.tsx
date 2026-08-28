import { useState, type ReactNode } from 'react';
import { SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { parseSearchQuery } from '@shared/searchQuery';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ClearableInput } from '@/components/text-fields';
import { DatePicker } from '@/components/date-picker';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { autoFocusField } from '@/lib/media';
import { t } from '@/lib/i18n';

/**
 * The one filter vocabulary for every list of games.
 *
 * Four lists show games — the collection, the archive browser, the elite
 * browser, the explorer's My games — and each had begun to grow its own
 * filters with its own words. The selects live here once: a row of
 * compact selects under the list's header, each stating its value, the
 * shape the archive panel set. A list that cannot answer a filter (a
 * side that is nobody's, a corpus with no notes) simply does not render
 * that select — the words never change, only which of them appear.
 */

export type SideFilter = 'any' | 'white' | 'black';
export type ResultFilter = 'any' | '1-0' | '0-1' | '1/2-1/2';

/** The standard one-line rail the filter selects sit in. */
export function FilterRow({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('border-border flex flex-wrap items-center gap-1.5 px-3 py-2', className)}>
      {children}
    </div>
  );
}

/** Whose side of the board — YOUR side in the collection, the searched
    player's in the archive. The caller owns the semantics; the words and
    the options are the same everywhere. */
export function SideSelect({
  value,
  onChange,
}: {
  value: SideFilter;
  onChange: (value: SideFilter) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as SideFilter)}
      ariaLabel={t('Side')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t('Either side') },
            { value: 'white', label: t('As White') },
            { value: 'black', label: t('As Black') },
          ],
        },
      ]}
    />
  );
}

export function ResultSelect({
  value,
  onChange,
}: {
  value: ResultFilter;
  onChange: (value: ResultFilter) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as ResultFilter)}
      // 'Result', not 'Outcome': the options are literal scores, and the
      // filter window ALSO holds the player-outcome select — two
      // comboboxes both announcing "Outcome" was a screen-reader riddle.
      ariaLabel={t('Result')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t('Any result') },
            { value: '1-0', label: t('White won') },
            { value: '0-1', label: t('Black won') },
            { value: '1/2-1/2', label: t('Drawn') },
          ],
        },
      ]}
    />
  );
}

/** A floor under BOTH players' ratings — a 2700 flagged against a 2200
    is not a 2700-level game. */
export function StrengthSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v))}
      ariaLabel={t('Strength')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: '0', label: t('Any rating') },
            { value: '2300', label: '2300+' },
            { value: '2500', label: '2500+' },
            { value: '2700', label: '2700+' },
          ],
        },
      ]}
    />
  );
}

export type OwnershipFilter = 'any' | 'mine' | 'white' | 'black';

/**
 * Whose games — the collection holds reference games beside your own,
 * so "mine" is a filter, not an assumption. Picking a seat implies
 * mine: a reference game has nobody's seat to answer for, and the old
 * bare "As White" quietly dropped every reference game with nothing to
 * say it had.
 */
export function OwnershipSelect({
  value,
  onChange,
}: {
  value: OwnershipFilter;
  onChange: (value: OwnershipFilter) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as OwnershipFilter)}
      ariaLabel={t('Whose games')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t("Anyone's games") },
            { value: 'mine', label: t('My games') },
            { value: 'white', label: t('Mine as White') },
            { value: 'black', label: t('Mine as Black') },
          ],
        },
      ]}
    />
  );
}

/** The ownership sentence, answered against a game's userSide. */
export function matchesOwnership(
  f: OwnershipFilter,
  userSide: 'white' | 'black' | null,
): boolean {
  if (f === 'any') return true;
  if (f === 'mine') return userSide !== null;
  return userSide === f;
}

export type NotesFilter = 'any' | 'annotated';

/** Only the games with your annotations on them. */
export function NotesSelect({
  value,
  onChange,
}: {
  value: NotesFilter;
  onChange: (value: NotesFilter) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as NotesFilter)}
      ariaLabel={t('Notes')}
      size="sm"
      className="min-w-0 flex-1"
      groups={[
        {
          options: [
            { value: 'any', label: t('All games') },
            { value: 'annotated', label: t('With notes') },
          ],
        },
      ]}
    />
  );
}

/**
 * The structured search, drafted in a window and applied on Done.
 *
 * "List the games [who] played [opening] as [white/black] at [dates] in
 * [tournament], and [won/lost/drew]" — every slot its own field, every
 * combination composable, resolved server-side (lanph3re's ask). A draft
 * rather than live application: these are text fields, and re-searching
 * two million rows per keystroke would be noise.
 */
export function StructuredFiltersWindow({
  initial,
  onApply,
  onClose,
  showEvent = true,
  extraFields,
  onClear,
  draftResult,
}: {
  initial: StructuredFilters;
  onApply: (filters: StructuredFilters) => void;
  onClose: () => void;
  /** The collection's games carry no Event header worth filtering. */
  showEvent?: boolean;
  /**
   * The caller's quick filters, mirrored into this window so it is the
   * COMPLETE editor: the row outside and these fields edit the same
   * state — a toolbar button and its menu item, never two filters. The
   * caller drafts them alongside this window's own draft and commits
   * both on Apply.
   */
  extraFields?: ReactNode;
  /** Reset the caller's mirrored drafts when Clear filters is pressed. */
  onClear?: () => void;
  /** The caller's drafted absolute Result (one of the extraFields) —
      handed in so the window can say when it contradicts the player's
      outcome above, instead of letting Apply produce a silent zero. */
  draftResult?: ResultFilter;
}) {
  const [draft, setDraft] = useState<StructuredFilters>(initial);
  const patch = (part: Partial<StructuredFilters>): void => setDraft((d) => ({ ...d, ...part }));

  // The impossible pairs only. Which results the player row still
  // allows: "drew" allows only the draw; a decisive outcome with a
  // chosen SIDE allows exactly one score (won as White is 1-0 and
  // nothing else); side-agnostic won/lost allows either decisive
  // score. An absolute Result outside that set can never match — a
  // decisive outcome WITH a compatible result stays quiet, since that
  // pair pins the side, which is a feature. Gated on a named player: a
  // playerless outcome filters nothing (and has its own hint below).
  const allowedResults = ((): ResultFilter[] | null => {
    if (draft.outcome === 'any') return null;
    if (draft.outcome === 'drawn') return ['1/2-1/2'];
    // The score this outcome produces, per seat the player might hold.
    const asWhite = draft.outcome === 'won' ? '1-0' : '0-1';
    const asBlack = draft.outcome === 'won' ? '0-1' : '1-0';
    if (draft.side === 'white') return [asWhite];
    if (draft.side === 'black') return [asBlack];
    return ['1-0', '0-1'];
  })();
  const contradictory =
    draftResult !== undefined &&
    draftResult !== 'any' &&
    draft.player.trim() !== '' &&
    allowedResults !== null &&
    !allowedResults.includes(draftResult);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent title="Filter games" icon={SlidersHorizontal}>
        <Field label="Player">
          <div className="flex gap-2">
            <ClearableInput
              // Desktop only — the mouse saves a click; a thumb gets the
              // keyboard over a window that is six fields to be READ, and
              // this window opens as a page of the list it filters.
              autoFocus={autoFocusField()}
              inputSize="sm"
              value={draft.player}
              onChange={(e) => patch({ player: e.target.value })}
              placeholder={t('Any player')}
              className="min-w-0 flex-1"
            />
            {/* Static widths sized to their longest option: without
                one, a select is as wide as its current VALUE, and the
                pair breathed every time a pick changed. */}
            <Select
              value={draft.side}
              onValueChange={(v) => patch({ side: v as StructuredFilters['side'] })}
              ariaLabel={t('Side')}
              size="sm"
              className="w-28 shrink-0"
              groups={[
                {
                  options: [
                    { value: 'any', label: t('Either side') },
                    { value: 'white', label: t('As White') },
                    { value: 'black', label: t('As Black') },
                  ],
                },
              ]}
            />
            <Select
              value={draft.outcome}
              onValueChange={(v) => patch({ outcome: v as StructuredFilters['outcome'] })}
              ariaLabel={t('Outcome')}
              size="sm"
              className="w-32 shrink-0"
              groups={[
                {
                  options: [
                    { value: 'any', label: t('Any outcome') },
                    { value: 'won', label: t('Won') },
                    { value: 'lost', label: t('Lost') },
                    { value: 'drawn', label: t('Drew') },
                  ],
                },
              ]}
            />
          </div>
          {/* The outcome is the player's, so it needs one. */}
          {draft.outcome !== 'any' && !draft.player.trim() && (
            <p className="text-muted-foreground mt-1 text-sm">{t('Won or lost by whom? Name a player above.')}</p>
          )}
        </Field>

        {/* The head-to-head slot: somebody ELSE in the same game, either
            seat. No side or outcome of their own — the player's above
            pin the pair's. */}
        <Field label="Against">
          <ClearableInput
            inputSize="sm"
            value={draft.player2}
            onChange={(e) => patch({ player2: e.target.value })}
            placeholder={t('Any opponent')}
            className="w-full"
          />
        </Field>

        <Field label="Opening or ECO">
          <ClearableInput
            inputSize="sm"
            value={draft.opening}
            onChange={(e) => patch({ opening: e.target.value })}
            placeholder={t('Najdorf, B90…')}
            className="w-full"
          />
        </Field>

        {showEvent && (
          <Field label="Tournament">
            <ClearableInput
              inputSize="sm"
              value={draft.event}
              onChange={(e) => patch({ event: e.target.value })}
              placeholder={t('Any event')}
              className="w-full"
            />
          </Field>
        )}

        <Field label="Played between">
          <div className="flex items-center gap-2">
            <DatePicker
              value={draft.from}
              onValueChange={(v) => patch({ from: v })}
              aria-label={t('From date')}
              className="w-[9.5rem]"
            />
            <span className="text-muted-foreground" aria-hidden>
              –
            </span>
            <DatePicker
              value={draft.to}
              onValueChange={(v) => patch({ to: v })}
              aria-label={t('To date')}
              className="w-[9.5rem]"
            />
          </div>
        </Field>

        {extraFields}

        {contradictory && (
          <p className="text-warn text-sm">
            {t('That outcome and that result can never happen in the same game — no game will match.')}
          </p>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => {
              setDraft(EMPTY_STRUCTURED_FILTERS);
              onClear?.();
            }}
          >
            {t('Clear filters')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="default" size="sm" onClick={() => onApply(draft)}>
            {t('Apply')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The search box's query language, listed under the box while it has
 * focus — the way GitHub's search suggests its qualifiers. One panel
 * for every box that speaks the language (the databases pane and the
 * collection tab); the language itself lives in shared/searchQuery.
 */
const QUERY_OPS: {
  key: string;
  sample: string;
  desc: string;
  /** Enumerable values, clickable; absent means free text. */
  values?: { v: string; desc: string }[];
  /** What a free-text value should be, said while one is awaited. */
  valueHint?: string;
}[] = [
  { key: 'player', sample: 'player:name', desc: 'This player, either side', valueHint: 'Type a player name' },
  { key: 'opponent', sample: 'opponent:name', desc: 'Somebody else in the same game', valueHint: 'Type a player name' },
  { key: 'white', sample: 'white:name', desc: 'This player as White', valueHint: 'Type a player name' },
  { key: 'black', sample: 'black:name', desc: 'This player as Black', valueHint: 'Type a player name' },
  { key: 'opening', sample: 'opening:najdorf', desc: 'Opening name contains', valueHint: 'Type an opening name' },
  { key: 'eco', sample: 'eco:B90', desc: 'ECO code starts with', valueHint: 'Type an ECO code — B90, C6…' },
  {
    key: 'event',
    sample: 'event:"tata steel"',
    desc: 'Tournament name contains — quotes hold spaces',
    valueHint: 'Type a tournament name',
  },
  {
    key: 'result',
    sample: 'result:1-0',
    desc: 'Exact score',
    values: [
      { v: '1-0', desc: 'White won' },
      { v: '0-1', desc: 'Black won' },
      { v: 'draw', desc: 'Drawn' },
    ],
  },
  {
    key: 'year',
    sample: 'year:2014',
    desc: 'A year, or a span of years',
    valueHint: 'Type a year, or a span — 2014, 2010-2015',
  },
];

/** One issue line: the offending piece as a badge, the reason beside it. */
function IssueLine({ badge, message }: { badge: string; message: string }) {
  return (
    <li className="flex items-baseline gap-2 px-2 py-1">
      <TriangleAlert className="text-warn size-3 shrink-0 self-center" aria-hidden />
      <Badge variant="outline" className="shrink-0 font-mono">
        {badge}
      </Badge>
      <span className="text-warn min-w-0 truncate text-xs">{message}</span>
    </li>
  );
}

/**
 * The suggestion panel. Plain text keeps plain behaviour, so this is
 * reference, not a gate: while the box is empty it lists every
 * qualifier, a half-typed one narrows the list, a completed one shows
 * its VALUES (clickable where they enumerate, described where they are
 * free text), and a qualifier gone wrong warns instead of silently
 * matching nothing. mousedown (not click) with preventDefault, or the
 * press would blur the input and close the panel under the click.
 */
export function SearchQueryHints({
  query,
  onPick,
}: {
  query: string;
  onPick: (nextQuery: string) => void;
}) {
  const { issues } = parseSearchQuery(query);
  const lastToken = query.slice(query.lastIndexOf(' ') + 1).toLowerCase();
  const colon = lastToken.indexOf(':');
  const typedKey = colon > 0 ? lastToken.slice(0, colon) : null;
  const typedValue = colon > 0 ? lastToken.slice(colon + 1) : '';
  const head = query.slice(0, query.length - lastToken.length);

  const valueOp = typedKey ? QUERY_OPS.find((op) => op.key === typedKey) : undefined;
  const prefixOps =
    typedKey === null
      ? QUERY_OPS.filter((op) => lastToken === '' || `${op.key}:`.startsWith(lastToken))
      : [];
  const values =
    valueOp?.values?.filter((val) => typedValue === '' || val.v.startsWith(typedValue)) ?? [];

  const issueLines = issues.map((issue, i) =>
    issue.kind === 'empty' ? (
      <IssueLine key={i} badge={`${issue.qualifier}:`} message={t('needs a value')} />
    ) : issue.kind === 'bad-result' ? (
      <IssueLine key={i} badge={issue.value ?? ''} message={t('is not a result — 1-0, 0-1 or draw')} />
    ) : (
      <IssueLine
        key={i}
        badge={issue.value ?? ''}
        message={t('is not a year or a span — 2014, 2010-2015')}
      />
    ),
  );

  const suggestions =
    prefixOps.length > 0 ? (
      <>
        <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
          {t('Narrow the search with')}
        </p>
        <ul>
          {prefixOps.map((op) => (
            <li key={op.key}>
              <button
                type="button"
                tabIndex={-1}
                className="hover:bg-accent flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(`${head}${op.key}:`);
                }}
              >
                <span className="text-foreground shrink-0 font-mono text-xs">{op.sample}</span>
                <span className="text-muted-foreground min-w-0 truncate text-xs">{t(op.desc)}</span>
              </button>
            </li>
          ))}
        </ul>
      </>
    ) : valueOp && values.length > 0 ? (
      <ul>
        {values.map((val) => (
          <li key={val.v}>
            <button
              type="button"
              tabIndex={-1}
              className="hover:bg-accent flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left"
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(`${head}${valueOp.key}:${val.v} `);
              }}
            >
              <Badge variant="secondary" className="shrink-0 font-mono">
                {val.v}
              </Badge>
              <span className="text-muted-foreground min-w-0 truncate text-xs">{t(val.desc)}</span>
            </button>
          </li>
        ))}
      </ul>
    ) : valueOp && !valueOp.values && typedValue === '' ? (
      <p className="text-muted-foreground px-2 py-1 text-xs">{t(valueOp.valueHint ?? '')}</p>
    ) : null;

  if (issueLines.length === 0 && suggestions === null) return null;
  return (
    <div className="bg-popover border-border absolute inset-x-0 top-full z-20 mt-1 rounded-md border p-1 shadow-md">
      {issueLines.length > 0 && <ul>{issueLines}</ul>}
      {suggestions}
    </div>
  );
}

/** The structured search constraints, all optional, all composable. */
export interface StructuredFilters {
  player: string;
  /** Somebody ELSE in the same game, either seat — the head-to-head
      slot. No side or outcome of their own: the named player's pin
      the pair's. */
  player2: string;
  side: 'any' | 'white' | 'black';
  outcome: 'any' | 'won' | 'lost' | 'drawn';
  opening: string;
  event: string;
  from: string;
  to: string;
}

export const EMPTY_STRUCTURED_FILTERS: StructuredFilters = {
  player: '',
  player2: '',
  side: 'any',
  outcome: 'any',
  opening: '',
  event: '',
  from: '',
  to: '',
};

/** True while any slot of the sentence is filled. */
export function hasStructuredFilters(f: StructuredFilters): boolean {
  return (
    f.player !== '' ||
    f.player2 !== '' ||
    f.opening !== '' ||
    f.event !== '' ||
    f.from !== '' ||
    f.to !== '' ||
    f.side !== 'any' ||
    f.outcome !== 'any'
  );
}

/**
 * The same sentence, answered client-side — for the collection, whose
 * few dozen games are already in the page. Mirrors gamesWhere on the
 * server (player/side/outcome, opening or ECO prefix, dates with dots
 * normalised) so the two lists mean the same thing by the same words.
 */
export function matchesStructured(
  f: StructuredFilters,
  g: {
    white: string;
    black: string;
    result: string;
    date: string | null;
    eco: string | null;
    opening?: { eco: string; name: string } | string | null;
  },
): boolean {
  const openingName = typeof g.opening === 'string' ? g.opening : (g.opening?.name ?? '');
  const player = f.player.trim().toLowerCase();
  if (player) {
    const asWhite = g.white.toLowerCase().includes(player);
    const asBlack = g.black.toLowerCase().includes(player);
    if (f.side === 'white' ? !asWhite : f.side === 'black' ? !asBlack : !asWhite && !asBlack) {
      return false;
    }
    if (f.outcome !== 'any') {
      if (f.outcome === 'drawn') {
        if (g.result !== '1/2-1/2') return false;
      } else {
        const winsAsWhite = g.result === (f.outcome === 'won' ? '1-0' : '0-1');
        const winsAsBlack = g.result === (f.outcome === 'won' ? '0-1' : '1-0');
        const ok =
          f.side === 'white'
            ? asWhite && winsAsWhite
            : f.side === 'black'
              ? asBlack && winsAsBlack
              : (asWhite && winsAsWhite) || (asBlack && winsAsBlack);
        if (!ok) return false;
      }
    }
  }
  const player2 = f.player2.trim().toLowerCase();
  if (player2) {
    if (!g.white.toLowerCase().includes(player2) && !g.black.toLowerCase().includes(player2))
      return false;
  }
  const opening = f.opening.trim().toLowerCase();
  if (opening) {
    const eco = (g.eco ?? '').toLowerCase();
    if (!openingName.toLowerCase().includes(opening) && !eco.startsWith(opening)) return false;
  }
  if (f.from || f.to) {
    const date = (g.date ?? '').replaceAll('.', '-');
    if (!date) return false;
    if (f.from && date < f.from) return false;
    if (f.to && date > f.to) return false;
  }
  return true;
}
