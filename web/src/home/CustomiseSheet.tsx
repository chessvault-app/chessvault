import { ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import type { HomeLayout } from '@shared/homeLayout';
import { Button } from '@/ui/Button';
import { SettingRow } from '@/ui/SettingRow';
import { Dialog, DialogContent } from '@/components/ui/dialog';
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
 * The groups are the point of the design: the list shows where everything
 * IS rather than describing where it would go. Switching a destination off
 * moves it to the row under the grid; hiding takes it off home altogether,
 * into a third group it can be brought back from.
 *
 * Hiding used to be refused on the grounds that nothing here should become
 * unreachable, which was the right worry aimed at the wrong page: home is
 * not the only way anywhere. The sidebar reaches every section, More lists
 * the rest, and a book is under Puzzles wherever home puts it. What hiding
 * costs is a shortcut, and a shortcut nobody uses is clutter — so the
 * third group is the honest place for it, listed by name and one press
 * from coming back.
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
  const { tiles, launchers, hidden } = resolveHomeLayout(layout, HOME_DESTINATIONS);

  // Promoting also un-hides: the grid is the most visible place there is,
  // so asking for it cannot leave the entry listed as off the page.
  const promote = (entry: Destination): void =>
    onChange({
      ...layout,
      tiles: [...layout.tiles, entry.id],
      hidden: layout.hidden.filter((id) => id !== entry.id),
    });

  const demote = (entry: Destination): void =>
    onChange({ ...layout, tiles: layout.tiles.filter((id) => id !== entry.id) });

  // One press from wherever it stands, tile or button — hiding a tile via
  // the row below would be two presses to say one thing.
  const hide = (entry: Destination): void =>
    onChange({
      ...layout,
      tiles: layout.tiles.filter((id) => id !== entry.id),
      hidden: layout.hidden.includes(entry.id) ? layout.hidden : [...layout.hidden, entry.id],
    });

  // Back to the row under the grid, which is where anything not asked for
  // as a tile lives.
  const unhide = (entry: Destination): void =>
    onChange({ ...layout, hidden: layout.hidden.filter((id) => id !== entry.id) });

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" title={t('Customise home')}>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {t('Switch a destination off to keep it as a button under the grid, or hide it to take it off home altogether. The sidebar still reaches everything.')}
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

        {/* No scroller of its own. Sheet's body already scrolls, so capping
            this at max-h-72 made a second one inside the first — which held
            the two card switches and the paragraph above them permanently on
            screen while only the destinations moved. Nothing here is worth
            pinning: the switches are two rows among fourteen, and a short
            list in a tall sheet was scrolling in a box while the sheet
            around it had room to spare. */}
        <div className="flex flex-col gap-1">
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
                <HideButton entry={entry} onHide={() => hide(entry)} />
              </Row>
            ))}
          </Group>

          <Group label={t('In the row below')} empty={t('Nothing — every destination is a tile.')} count={launchers.length}>
            {launchers.map((entry) => (
              <Row key={entry.id} entry={entry} checked={false} onToggle={() => promote(entry)}>
                <HideButton entry={entry} onHide={() => hide(entry)} />
              </Row>
            ))}
          </Group>

          <Group
            label={t('Off the page')}
            empty={t('Nothing — every destination is on home.')}
            count={hidden.length}
          >
            {hidden.map((entry) => (
              // No switch: a switch offers two states, and this row is in
              // neither of them. One button, and it says where it goes.
              <Row key={entry.id} entry={entry}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Bring back')}
                  aria-label={t('Bring {name} back', { name: t(entry.label) })}
                  onClick={() => unhide(entry)}
                >
                  <Eye className="size-3.5" />
                </Button>
              </Row>
            ))}
          </Group>
        </div>

        {error !== null && (
          <p className="text-destructive text-sm" role="status">
            {error}
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('Reset to default')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One of the page's cards, on or off. The Settings row, shared. */
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
    <SettingRow title={title} blurb={blurb}>
      <Switch checked={checked} onCheckedChange={onToggle} aria-label={title} />
    </SettingRow>
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
      <p className="text-subtle px-1 pt-1 text-xs label-caps">
        {label}
      </p>
      {/* A group that has emptied says so. A heading over nothing reads as
          a page that failed to draw. */}
      {count === 0 ? <p className="text-subtle px-1 pb-1 text-sm">{empty}</p> : children}
    </div>
  );
}

/** Shared by all three groups; the hidden ones pass no toggle. */
function HideButton({ entry, onHide }: { entry: Destination; onHide: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={t('Hide')}
      aria-label={t('Hide {name}', { name: t(entry.label) })}
      onClick={onHide}
    >
      <EyeOff className="size-3.5" />
    </Button>
  );
}

function Row({
  entry,
  checked,
  onToggle,
  children,
}: {
  entry: Destination;
  checked?: boolean;
  /** Omitted for a row that is on neither the grid nor the row below. */
  onToggle?: () => void;
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
    <div className="border-border bg-surface-inset flex items-center gap-2 rounded-md border px-3 py-1.5">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-base">{t(label)}</span>
      {children}
      {onToggle && <Switch checked={checked ?? false} onCheckedChange={onToggle} aria-label={t(label)} />}
    </div>
  );
}
