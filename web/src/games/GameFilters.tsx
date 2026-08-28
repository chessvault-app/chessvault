import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
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
      ariaLabel={t('Outcome')}
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

  // The always-impossible pairs only: a decisive outcome against a
  // drawn result, or "drew" against a decisive one. A decisive outcome
  // WITH a decisive result stays quiet — that pair pins the side, which
  // is a feature. Gated on a named player, since a playerless outcome
  // filters nothing (and has its own hint below).
  const contradictory =
    draftResult !== undefined &&
    draftResult !== 'any' &&
    draft.player.trim() !== '' &&
    (((draft.outcome === 'won' || draft.outcome === 'lost') && draftResult === '1/2-1/2') ||
      (draft.outcome === 'drawn' && draftResult !== '1/2-1/2'));

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

/** The structured search constraints, all optional, all composable. */
export interface StructuredFilters {
  player: string;
  side: 'any' | 'white' | 'black';
  outcome: 'any' | 'won' | 'lost' | 'drawn';
  opening: string;
  event: string;
  from: string;
  to: string;
}

export const EMPTY_STRUCTURED_FILTERS: StructuredFilters = {
  player: '',
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
