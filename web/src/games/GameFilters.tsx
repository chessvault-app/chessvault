import { useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Select } from '@/ui/Select';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { DateInput, Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
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
    <div className={cn('border-line flex flex-wrap items-center gap-1.5 px-3 py-2', className)}>
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
      onChange={(v) => onChange(v as SideFilter)}
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
      onChange={(v) => onChange(v as ResultFilter)}
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
}: {
  initial: StructuredFilters;
  onApply: (filters: StructuredFilters) => void;
  onClose: () => void;
  /** The collection's games carry no Event header worth filtering. */
  showEvent?: boolean;
}) {
  const [draft, setDraft] = useState<StructuredFilters>(initial);
  const patch = (part: Partial<StructuredFilters>): void => setDraft((d) => ({ ...d, ...part }));

  return (
    <Modal title="Filter games" icon={SlidersHorizontal} onClose={onClose}>
      <Field label="Player">
        <div className="flex gap-2">
          <Input
            autoFocus
            inputSize="sm"
            value={draft.player}
            onChange={(e) => patch({ player: e.target.value })}
            placeholder={t('Any player')}
            className="min-w-0 flex-1"
          />
          <Select
            value={draft.side}
            onChange={(v) => patch({ side: v as StructuredFilters['side'] })}
            ariaLabel={t('Side')}
            size="sm"
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
            onChange={(v) => patch({ outcome: v as StructuredFilters['outcome'] })}
            ariaLabel={t('Outcome')}
            size="sm"
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
          <p className="text-subtle mt-1 text-xs">{t('Won or lost by whom? Name a player above.')}</p>
        )}
      </Field>

      <Field label="Opening or ECO">
        <Input
          inputSize="sm"
          value={draft.opening}
          onChange={(e) => patch({ opening: e.target.value })}
          placeholder={t('Najdorf, B90…')}
          className="w-full"
        />
      </Field>

      {showEvent && (
        <Field label="Tournament">
          <Input
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
          <DateInput
            value={draft.from}
            onChange={(e) => patch({ from: e.target.value })}
            aria-label={t('From date')}
            className="w-[9.5rem]"
          />
          <span className="text-subtle" aria-hidden>
            –
          </span>
          <DateInput
            value={draft.to}
            onChange={(e) => patch({ to: e.target.value })}
            aria-label={t('To date')}
            className="w-[9.5rem]"
          />
        </div>
      </Field>

      <div className="mt-1 flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="mr-auto"
          onClick={() => setDraft(EMPTY_STRUCTURED_FILTERS)}
        >
          {t('Clear filters')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => onApply(draft)}>
          {t('Apply')}
        </Button>
      </div>
    </Modal>
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
