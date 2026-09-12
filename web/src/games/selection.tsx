import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { TitleTip } from '@/components/title-tip';
import { t } from '@/lib/i18n';

/**
 * Selecting several games at once: the pieces the online archive built
 * and the collection now shares, so the two lists that take turns in the
 * games column pick rows the same way.
 *
 * Selection is a MODE, not a permanent column: a checkbox on every row is
 * clutter for the common case, which is opening one game. A ghost
 * "Select…" beside the count turns it on; the count band becomes the bar,
 * what is selected on the left and what to do with it on the right, and
 * Cancel or Escape leaves. Each list keeps its own verbs (Add selected
 * there, Delete selected here) and its own reading of "all": the archive
 * ticks the games not yet collected, the collection ticks what the
 * filters show.
 */

/** The ghost entry into the mode, standing beside the count. */
export function SelectButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" disabled={disabled} onClick={onClick}>
      {t('Select…')}
    </Button>
  );
}

/**
 * A row's checkbox. Outside the hover tray: a checkbox that only appears
 * under the pointer is one you cannot tick with your eyes. The click is
 * stopped so ticking a row does not also open it.
 */
export function SelectRowCheckbox({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Checkbox
      aria-label={t('Select this game')}
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={(on) => onChange(on === true)}
    />
  );
}

/**
 * The bar the count band becomes while selecting.
 *
 * Four controls in one wrapping run gave the count the same weight as the
 * buttons and put Cancel wherever the text happened to end; this is the
 * master checkbox with its label, the count as a badge (the one number
 * that changes as you tick rows, so not another grey sentence), and the
 * verbs pushed right with Cancel first. Indeterminate is the honest state
 * for a partial selection: an unchecked box next to eight ticked rows
 * reads as a bug.
 */
export function SelectionBar({
  all,
  picked,
  onCancel,
  actions,
}: {
  all: {
    /** How many "all" would tick. Zero disables the box; `none` says why. */
    total: number;
    label: string;
    /** The label when nothing can be ticked, and the tip that explains it. */
    none?: { label: string; tip: string };
    onChange: (on: boolean) => void;
  };
  picked: number;
  onCancel: () => void;
  /** The verbs, primary last. */
  actions: ReactNode;
}) {
  const empty = all.total === 0;
  return (
    <>
      <TitleTip title={empty && all.none ? all.none.tip : undefined}>
        {/* pl-3: the master box stands over the column of row boxes. A
            table row's pinned cell and a card's leading slot both start
            12px in from the list's edge, and the band starts at 0
            (measured: rows at +12 in both modes). */}
        <label className={cn('flex min-w-0 items-center gap-1.5 pl-3', empty ? 'opacity-60' : 'cursor-pointer')}>
          <Checkbox
            checked={!empty && picked === all.total}
            indeterminate={picked > 0 && picked !== all.total}
            disabled={empty}
            onCheckedChange={(on) => all.onChange(on === true)}
          />
          <span className="text-muted-foreground truncate">{empty && all.none ? all.none.label : all.label}</span>
        </label>
      </TitleTip>
      <span
        className={cn(
          'shrink-0 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
          picked > 0 ? 'bg-muted text-primary' : 'bg-accent text-muted-foreground',
        )}
      >
        {t('{n} selected', { n: picked })}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        {actions}
      </div>
    </>
  );
}
