import { ChevronDown, ChevronUp } from 'lucide-react';
import type { HomeLayout } from '@shared/homeLayout';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { Switch } from '@/ui/Switch';
import { announce } from '@/ui/announce';
import { t } from '@/lib/i18n';
import { HOME_DESTINATIONS, type Destination } from './destinations';
import { resolveHomeLayout } from './layout';

/**
 * Rearranging the landing page, from the landing page.
 *
 * A list of settings that applies as you touch it, so it has no Save and
 * no Cancel — Sheet's own X, Escape, the scrim and a phone's swipe are the
 * ways out, and each press is already stored by the time you use one. The
 * one button here is a verb: reset.
 *
 * The two groups are the point of the design. Switching a destination off
 * does not hide it, it moves it to the row under the grid — so the list
 * shows where everything IS rather than describing where it would go, and
 * nothing on this page can be made unreachable.
 *
 * Order is moved with buttons rather than by dragging. There is no
 * drag-and-drop anywhere in this app and nothing to copy, and two buttons
 * are a keyboard and a screen reader's only way to do this at all.
 */
export function CustomiseSheet({
  layout,
  onChange,
  onReset,
  onClose,
  error,
}: {
  /** The arrangement on screen, with its tiles already spelled out — an
      uncustomised vault arrives here as the defaults written down, so a
      first edit says what it kept as well as what it changed. */
  layout: HomeLayout;
  onChange: (next: HomeLayout) => void;
  onReset: () => void;
  onClose: () => void;
  error: string | null;
}) {
  const { tiles, launchers } = resolveHomeLayout(layout, HOME_DESTINATIONS);

  const promote = (entry: Destination): void =>
    onChange({ ...layout, tiles: [...layout.tiles, entry.id] });

  const demote = (entry: Destination): void =>
    onChange({ ...layout, tiles: layout.tiles.filter((id) => id !== entry.id) });

  const move = (from: number, by: -1 | 1): void => {
    const to = from + by;
    if (to < 0 || to >= layout.tiles.length) return;
    const next = [...layout.tiles];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onChange({ ...layout, tiles: next });
    announce(
      t('{name} is now {n} of {total}', {
        name: t(tiles[from]!.label),
        n: to + 1,
        total: next.length,
      }),
    );
  };

  return (
    <Sheet label={t('Customise home')} onClose={onClose}>
      <p className="text-muted text-xs leading-relaxed">
        {t('Anything you switch off keeps a button in the row under the grid — nothing here goes away.')}
      </p>

      <ToggleRow
        title={t('Continue')}
        blurb={t('Where you left off, above everything else.')}
        checked={layout.continueCard}
        onToggle={() => onChange({ ...layout, continueCard: !layout.continueCard })}
      />
      <ToggleRow
        title={t('Set up your vault')}
        blurb={t('The first steps for a new vault. It leaves once they are all done.')}
        checked={layout.checklist}
        onToggle={() => onChange({ ...layout, checklist: !layout.checklist })}
      />

      {/* overflow-x-hidden for the same reason home's page box has it: a
          box that scrolls in one axis scrolls in both unless it says
          otherwise, and this list has nothing to the side of it. */}
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto overflow-x-hidden">
        <Group label={t('On the grid')} empty={t('Nothing — every destination is a button below.')} count={tiles.length}>
          {tiles.map((entry, i) => (
            // Keyed by id, not position: React then MOVES the row that
            // moved, and the focus ring travels with it — keyed by index,
            // a second press would reorder the row that took its place.
            <Row key={entry.id} entry={entry} checked onToggle={() => demote(entry)}>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === 0}
                title={t('Move up')}
                aria-label={t('Move {name} up', { name: t(entry.label) })}
                onClick={() => move(i, -1)}
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={i === tiles.length - 1}
                title={t('Move down')}
                aria-label={t('Move {name} down', { name: t(entry.label) })}
                onClick={() => move(i, 1)}
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </Row>
          ))}
        </Group>

        <Group label={t('In the row below')} empty={t('Nothing — every destination is a tile.')} count={launchers.length}>
          {launchers.map((entry) => (
            <Row key={entry.id} entry={entry} checked={false} onToggle={() => promote(entry)} />
          ))}
        </Group>
      </div>

      {error !== null && (
        <p className="text-bad text-xs" role="status">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t('Reset to default')}
        </Button>
      </div>
    </Sheet>
  );
}

/** One of the page's cards, on or off. The Settings row, unchanged. */
function ToggleRow({
  title,
  blurb,
  checked,
  onToggle,
}: {
  title: string;
  blurb: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-subtle text-xs">{blurb}</div>
      </div>
      <Switch checked={checked} onToggle={onToggle} label={title} />
    </div>
  );
}

function Group({
  label,
  empty,
  count,
  children,
}: {
  label: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <p className="text-subtle px-1 pt-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {label}
      </p>
      {/* A group that has emptied says so. A heading over nothing reads as
          a page that failed to draw. */}
      {count === 0 ? <p className="text-subtle px-1 pb-1 text-xs">{empty}</p> : children}
    </div>
  );
}

function Row({
  entry,
  checked,
  onToggle,
  children,
}: {
  entry: Destination;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { icon: Icon, label } = entry;
  return (
    // px-3, not px-2, and the 3 is a measurement rather than a taste: on a
    // coarse pointer `Switch` grows its touch target with an absolutely
    // positioned ::before inset by -12px, which is invisible but still
    // counts towards scrollable overflow. Against 8px of padding it stood
    // 4px outside the row, which made the list — a scroll container in
    // both axes, as `overflow-y-auto` always is — pannable sideways by 3px
    // on a phone, with no scrollbar to say why. 12px of padding contains
    // it exactly, so the whole touch target survives.
    <div className="border-line bg-surface-inset flex items-center gap-2 rounded-md border px-3 py-1.5">
      <Icon className="text-muted size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm">{t(label)}</span>
      {children}
      <Switch checked={checked} onToggle={onToggle} label={t(label)} />
    </div>
  );
}
