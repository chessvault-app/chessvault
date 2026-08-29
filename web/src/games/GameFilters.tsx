import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import {
  composeQueryChips,
  findCrossImpossible,
  parseSearchQuery,
  splitQueryChips,
  type FilterConstraints,
} from '@shared/searchQuery';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { ClearableInput, SearchInput } from '@/components/text-fields';
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

/**
 * The More-filters toggle, once for the three browsers that carried it
 * as pasted literals. While the WINDOW holds filters, the button is lit
 * and wears a primary dot — the quick selects beside it display their
 * own values, so the dot answers for exactly the constraints the row
 * cannot show. A lit-only state read as "pressed", not "narrowing your
 * list" (lanph3re's report).
 */
export function MoreFiltersButton({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      active={on}
      title={t('More filters')}
      className="relative shrink-0"
      onClick={onClick}
    >
      <SlidersHorizontal className="size-3.5" />
      {on && (
        <span aria-hidden className="bg-primary absolute right-1 top-1 size-1.5 rounded-full" />
      )}
    </Button>
  );
}

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
  className,
}: {
  value: SideFilter;
  onChange: (value: SideFilter) => void;
  /** See ResultSelect — the merged control row passes flex-none. */
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as SideFilter)}
      ariaLabel={t('Side')}
      size="sm"
      className={cn('min-w-0 flex-1', className)}
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
  className,
}: {
  value: ResultFilter;
  onChange: (value: ResultFilter) => void;
  /** The dedicated filter row stretches its selects across the band
      (the default); a merged control row passes flex-none so they take
      their label's width and WRAP when the row is tight — stretched,
      they crushed to two letters beside a search box instead. */
  className?: string;
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
      className={cn('min-w-0 flex-1', className)}
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
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  /** See ResultSelect — the merged control row passes flex-none. */
  className?: string;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(v) => onChange(Number(v))}
      ariaLabel={t('Strength')}
      size="sm"
      className={cn('min-w-0 flex-1', className)}
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
  className,
}: {
  value: OwnershipFilter;
  onChange: (value: OwnershipFilter) => void;
  /** See ResultSelect — the merged control row passes flex-none. */
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as OwnershipFilter)}
      ariaLabel={t('Whose games')}
      size="sm"
      className={cn('min-w-0 flex-1', className)}
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
  className,
}: {
  value: NotesFilter;
  onChange: (value: NotesFilter) => void;
  /** See ResultSelect — the merged control row passes flex-none. */
  className?: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as NotesFilter)}
      ariaLabel={t('Notes')}
      size="sm"
      className={cn('min-w-0 flex-1', className)}
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
  { key: 'opening', sample: 'opening:name', desc: 'Opening name contains', valueHint: 'Type an opening name' },
  { key: 'eco', sample: 'eco:code', desc: 'ECO code starts with', valueHint: 'Type an ECO code — B90, C6…' },
  {
    key: 'event',
    sample: 'event:"name"',
    desc: 'Tournament name contains — quotes hold spaces',
    valueHint: 'Type a tournament name',
  },
  {
    key: 'result',
    sample: 'result:score',
    desc: 'Exact score',
    values: [
      { v: '1-0', desc: 'White won' },
      { v: '0-1', desc: 'Black won' },
      { v: 'draw', desc: 'Drawn' },
    ],
  },
  {
    key: 'year',
    sample: 'year:when',
    desc: 'A year, or a span of years',
    valueHint: 'Type a year, or a span — 2014, 2010-2015',
  },
  {
    key: 'elo',
    sample: 'elo:floor',
    desc: 'Both players at least — or a band',
    valueHint: 'Type a floor, or a band — 2500, 2400-2600',
  },
];

/**
 * One committed query term, standing in the field as a chip: the
 * qualifier in the muted ink, its value in the accent, an X to take
 * it out again. mousedown-preventDefault on the X so the press does
 * not blur the input it stands inside.
 */
function QueryChip({ raw, onRemove }: { raw: string; onRemove: () => void }) {
  const colon = raw.indexOf(':');
  return (
    // The app's own text face, not mono — a chip is a phrase, not
    // code — and an explicit accent-on-border coat: the secondary
    // wash sat on the input's own surface and vanished in the dark
    // theme.
    <Badge variant="outline" className="bg-accent border-border shrink-0 gap-0.5 pr-1">
      <span className="text-muted-foreground">{raw.slice(0, colon + 1)}</span>
      <span className="text-info font-medium">{raw.slice(colon + 1).replace(/"/g, '')}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('Remove this term')}
        className="text-muted-foreground hover:text-foreground -mr-0.5 grid size-3.5 shrink-0 place-items-center rounded-full"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
      >
        <X className="size-2.5" />
      </button>
    </Badge>
  );
}

/**
 * The query search box, whole: a finished valid qualifier becomes a
 * chip inside the field (the string stays the single source of truth
 * — chips are DERIVED by splitQueryChips, and every edit recomposes
 * it), the text still under the caret stays text, the qualifier panel
 * hangs below while focused. Backspace at the text's start pops the
 * last chip back into the text for editing; a chip's X removes its
 * term outright.
 */
export function QueryBox({
  query,
  onQuery,
  suggest,
  placeholder,
  onOpenChange,
  className,
}: {
  query: string;
  onQuery: (next: string) => void;
  suggest?: (field: string, value: string) => Promise<ValueSuggestion[]>;
  placeholder: string;
  /** The panel's focus state, for the caller's issues box gating. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const control = useRef<SearchQueryHintsHandle | null>(null);
  const { chips, text } = splitQueryChips(query);
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <SearchInput
        inputSize="sm"
        value={text}
        onChange={(e) => onQuery(composeQueryChips(chips, e.target.value))}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (open && control.current?.handleKey(e)) return;
          if (e.key === 'Backspace' && chips.length > 0) {
            const el = e.currentTarget as HTMLInputElement;
            if (el.selectionStart === 0 && el.selectionEnd === 0) {
              e.preventDefault();
              const last = chips[chips.length - 1]!;
              onQuery(composeQueryChips(chips.slice(0, -1), text ? `${last} ${text}` : last));
            }
          }
        }}
        // With chips standing in the field the box is not empty, and a
        // placeholder beside them read as text someone typed.
        placeholder={chips.length > 0 ? undefined : placeholder}
        spellCheck={false}
        className="w-full"
        onClearAll={() => onQuery('')}
        tokens={
          chips.length > 0
            ? chips.map((raw, i) => (
                <QueryChip
                  key={`${raw}-${i}`}
                  raw={raw}
                  onRemove={() =>
                    onQuery(
                      composeQueryChips(
                        chips.filter((_, j) => j !== i),
                        text,
                      ),
                    )
                  }
                />
              ))
            : undefined
        }
      />
      {open && (
        <SearchQueryHints query={query} onPick={onQuery} suggest={suggest} controlRef={control} />
      )}
    </div>
  );
}

/** One suggestion a completed qualifier can offer for its value. */
export interface ValueSuggestion {
  v: string;
  desc?: string;
}

/**
 * Opening and ECO suggestions come from the vendored catalogue — the
 * app's own 3,810 named lines, not whatever a particular database
 * happens to contain — fetched once through the endpoint the
 * repertoire picker already uses and kept for the session.
 */
let catalogCache: Promise<{ eco: string; name: string }[]> | null = null;
const openingCatalog = (): Promise<{ eco: string; name: string }[]> => {
  catalogCache ??= api<{ openings: { eco: string; name: string }[] }>('/api/openings')
    .then((body) => body.openings)
    .catch(() => {
      catalogCache = null;
      return [];
    });
  return catalogCache;
};

export async function catalogSuggest(
  field: 'opening' | 'eco',
  value: string,
): Promise<ValueSuggestion[]> {
  const needle = value.toLowerCase();
  const lines = await openingCatalog();
  // The WHOLE catalogue answers, not a top slice — the panel scrolls,
  // and a dictionary with no popularity axis has no honest way to
  // pick six. An empty value is simply the everything-prefix.
  if (field === 'eco') {
    const seen = new Map<string, string>();
    for (const line of lines) {
      const eco = line.eco.toUpperCase();
      if (eco.toLowerCase().startsWith(needle) && !seen.has(eco)) seen.set(eco, line.name);
    }
    return [...seen].sort(([a], [b]) => a.localeCompare(b)).map(([v, desc]) => ({ v, desc }));
  }
  // Names that START with the needle first — "naj" should offer the
  // Najdorf before every line merely containing it. The catalogue's
  // own order (ECO order, families together) carries within each half.
  const starts = lines.filter((l) => l.name.toLowerCase().startsWith(needle));
  const contains = needle
    ? lines.filter(
        (l) => !l.name.toLowerCase().startsWith(needle) && l.name.toLowerCase().includes(needle),
      )
    : [];
  return [...starts, ...contains].map((l) => ({ v: l.name, desc: l.eco }));
}

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
/** How a caller forwards the input's key events into the panel:
    ↓/↑ move the active row, Enter takes it; anything unhandled
    returns false and stays the input's. */
export interface SearchQueryHintsHandle {
  handleKey: (e: React.KeyboardEvent) => boolean;
}

/** One suggestion row's data, plain values only — the row component
    is memoised on it, so walking the active highlight through a
    catalogue of thousands re-renders two rows, not all of them. */
interface HintItem {
  id: string;
  insert: string;
  kind: 'sample' | 'value' | 'name';
  primary: string;
  secondary?: string;
}

/** Every row stands exactly this tall (h-7) — the windowing below
    turns a scroll offset into a row index with plain division, so the
    height must be pinned, not measured. */
const HINT_ROW_PX = 28;

const HintRow = memo(function HintRow({
  item,
  active,
  pick,
}: {
  item: HintItem;
  active: boolean;
  pick: (insert: string) => void;
}) {
  return (
    <li className="h-7">
      <button
        type="button"
        tabIndex={-1}
        data-active={active || undefined}
        className={cn(
          'hover:bg-accent flex h-full w-full items-center gap-2 rounded-sm px-2 text-left',
          active && 'bg-accent',
        )}
        onMouseDown={(e) => {
          e.preventDefault();
          pick(item.insert);
        }}
      >
        {item.kind === 'sample' ? (
          <span className="text-foreground shrink-0 font-mono text-xs">{item.primary}</span>
        ) : item.kind === 'value' ? (
          <Badge variant="secondary" className="shrink-0 font-mono">
            {item.primary}
          </Badge>
        ) : (
          <span className="text-foreground min-w-0 truncate text-xs font-medium">
            {item.primary}
          </span>
        )}
        {item.secondary !== undefined && (
          <span
            className={cn(
              'text-muted-foreground text-xs',
              item.kind === 'name' ? 'shrink-0 font-mono' : 'min-w-0 truncate',
            )}
          >
            {item.secondary}
          </span>
        )}
      </button>
    </li>
  );
});

export function SearchQueryHints({
  query,
  onPick,
  suggest,
  controlRef,
}: {
  query: string;
  onPick: (nextQuery: string) => void;
  /** Live values for a free-text qualifier — player names from the
      database's own aggregate, openings and ECO from the vendored
      catalogue. Absent fields simply keep the typed-value hint. */
  suggest?: (field: string, value: string) => Promise<ValueSuggestion[]>;
  /** Where the caller reaches the keyboard handle. */
  controlRef?: { current: SearchQueryHintsHandle | null };
}) {
  const rawLast = query.slice(query.lastIndexOf(' ') + 1);
  const lastToken = rawLast.toLowerCase();
  const colon = lastToken.indexOf(':');
  const typedKey = colon > 0 ? lastToken.slice(0, colon) : null;
  const typedValue = colon > 0 ? rawLast.slice(colon + 1).replace(/"/g, '') : '';
  const head = query.slice(0, query.length - rawLast.length);

  const valueOp = typedKey ? QUERY_OPS.find((op) => op.key === typedKey) : undefined;
  const prefixOps =
    typedKey === null
      ? QUERY_OPS.filter((op) => lastToken === '' || `${op.key}:`.startsWith(lastToken))
      : [];
  const values =
    valueOp?.values?.filter((val) => typedValue === '' || val.v.startsWith(typedValue)) ?? [];

  // The live values, debounced a beat behind the typing; a stale
  // answer must not overwrite a fresher question's. An EMPTY value
  // asks too — a completed qualifier opens on the field's top names
  // before a character is typed.
  const [fetched, setFetched] = useState<ValueSuggestion[]>([]);
  const fetchKey = valueOp && !valueOp.values ? `${valueOp.key}:${typedValue}` : null;
  useEffect(() => {
    if (!suggest || fetchKey === null) {
      setFetched([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      const [field, ...rest] = fetchKey.split(':');
      void suggest(field!, rest.join(':'))
        .then((got) => {
          if (!stale) setFetched(got);
        })
        .catch(() => {});
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [suggest, fetchKey]);

  // One flat list whatever the mode, so the keyboard walks it blind.
  // Memoised as DATA: the rows are memo components over these, and an
  // active-row change must not reconcile a catalogue of thousands.
  const entries = useMemo<HintItem[]>(
    () =>
      prefixOps.length > 0
        ? prefixOps.map((op) => ({
            id: `op:${op.key}`,
            insert: `${head}${op.key}:`,
            kind: 'sample' as const,
            primary: op.sample,
            secondary: t(op.desc),
          }))
        : valueOp && values.length > 0
          ? values.map((val) => ({
              id: `enum:${val.v}`,
              insert: `${head}${valueOp.key}:${val.v} `,
              kind: 'value' as const,
              primary: val.v,
              secondary: t(val.desc),
            }))
          : valueOp && !valueOp.values
            ? fetched.map((val) => ({
                id: `live:${val.v}`,
                insert: `${head}${valueOp.key}:${/\s/.test(val.v) ? `"${val.v}"` : val.v} `,
                kind: 'name' as const,
                primary: val.v,
                secondary: val.desc,
              }))
            : [],
    // Everything above derives from the query and the fetched values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, fetched],
  );
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pick = useCallback((insert: string) => pickRef.current(insert), []);

  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    setActive(-1);
  }, [query]);
  // The list mounts only the rows in view (plus overscan): a catalogue
  // of thousands rendered whole was cheap for React after memoising but
  // still thousands of DOM nodes for layout on every change — the lag
  // the memo pass didn't cure. Fixed-height rows make the window pure
  // arithmetic on scrollTop.
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [entries]);
  // Walking with the keyboard must not leave the active row outside the
  // fold — computed from the row index, since the row may not be
  // mounted yet for scrollIntoView to find.
  useEffect(() => {
    const ul = listRef.current;
    if (!ul || active < 0) return;
    const top = active * HINT_ROW_PX;
    const bottom = top + HINT_ROW_PX;
    let next = ul.scrollTop;
    if (top < next) next = top;
    else if (bottom > next + ul.clientHeight) next = bottom - ul.clientHeight;
    if (next !== ul.scrollTop) {
      ul.scrollTop = next;
      // The scroll event echoing this assignment arrives a frame late —
      // shift the mounted window now, or the active row it must show
      // isn't in the DOM yet.
      setScrollTop(next);
    }
  }, [active]);

  const handleKey = (e: React.KeyboardEvent): boolean => {
    if (entries.length === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % entries.length);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? entries.length - 1 : a - 1));
      return true;
    }
    if (e.key === 'Enter' && active >= 0 && entries[active]) {
      e.preventDefault();
      onPick(entries[active].insert);
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (controlRef) controlRef.current = { handleKey };
  });
  useEffect(
    () => () => {
      if (controlRef) controlRef.current = null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hint =
    valueOp && !valueOp.values && entries.length === 0
      ? t(valueOp.valueHint ?? '')
      : null;

  if (entries.length === 0 && hint === null) return null;
  return (
    <div className="bg-popover border-border absolute inset-x-0 top-full z-20 mt-1 rounded-md border p-1 shadow-md">
      {prefixOps.length > 0 && (
        <p className="text-muted-foreground px-2 py-1 text-xs font-medium">
          {t('Narrow the search with')}
        </p>
      )}
      {entries.length > 0 &&
        (() => {
          // Capped and scrollable: the catalogue fields answer with
          // EVERYTHING they know, but only the rows in the viewport
          // (max-h-72 = 288px) plus overscan are mounted; spacer items
          // hold the scrollbar honest for the rest.
          const overscan = 8;
          const start = Math.max(0, Math.floor(scrollTop / HINT_ROW_PX) - overscan);
          const end = Math.min(
            entries.length,
            Math.ceil((scrollTop + 288) / HINT_ROW_PX) + overscan,
          );
          return (
            <ul
              ref={listRef}
              className="max-h-72 overflow-y-auto"
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {start > 0 && <li aria-hidden style={{ height: start * HINT_ROW_PX }} />}
              {entries.slice(start, end).map((entry, j) => (
                <HintRow
                  key={entry.id}
                  item={entry}
                  active={start + j === active}
                  pick={pick}
                />
              ))}
              {end < entries.length && (
                <li aria-hidden style={{ height: (entries.length - end) * HINT_ROW_PX }} />
              )}
            </ul>
          );
        })()}
      {hint && <p className="text-muted-foreground px-2 py-1 text-xs">{hint}</p>}
    </div>
  );
}

/**
 * The query's problems, as a BLOCK under the search bar — GitHub's
 * warning box, not a floating layer: it stands in the layout while the
 * query stands wrong, focused or not. While the box is focused, an
 * issue on the token still under the caret waits for the space that
 * finishes it; once focus leaves, everything wrong is said.
 */
export function SearchQueryIssues({
  query,
  pending = false,
  filters,
  className,
}: {
  query: string;
  /** True while the box has focus — the last token may still be
      mid-type. */
  pending?: boolean;
  /** The OTHER surface's constraints — the quick row and the filter
      window — so a query term the filters leave no room for warns
      here too, instead of silently finding nothing. */
  filters?: FilterConstraints;
  className?: string;
}) {
  const { issues } = parseSearchQuery(query);
  const all = filters ? [...issues, ...findCrossImpossible(query, filters)] : issues;
  const rawLast = query.slice(query.lastIndexOf(' ') + 1);
  const shown = pending && !query.endsWith(' ') ? all.filter((i) => i.raw !== rawLast) : all;
  if (shown.length === 0) return null;
  return (
    <div className={cn('border-warn/40 bg-warn/10 rounded-md border px-1 py-0.5', className)}>
      <ul>
        {shown.map((issue, i) =>
          issue.kind === 'empty' ? (
            <IssueLine key={i} badge={`${issue.qualifier}:`} message={t('needs a value')} />
          ) : issue.kind === 'bad-result' ? (
            <IssueLine
              key={i}
              badge={issue.value ?? ''}
              message={t('is not a result — 1-0, 0-1 or draw')}
            />
          ) : issue.kind === 'bad-year' ? (
            <IssueLine
              key={i}
              badge={issue.value ?? ''}
              message={t('is not a year or a span — 2014, 2010-2015')}
            />
          ) : issue.kind === 'bad-elo' ? (
            <IssueLine
              key={i}
              badge={issue.value ?? ''}
              message={t('is not an Elo floor or band — 2500, 2400-2600')}
            />
          ) : (
            <IssueLine
              key={i}
              badge={issue.value ?? ''}
              message={
                issue.cross
                  ? t('cannot hold with the active filters')
                  : t('cannot all hold in one game')
              }
            />
          ),
        )}
      </ul>
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
