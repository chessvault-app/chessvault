import { Dialog, DialogContent } from '@/components/ui/dialog';
import { announce } from '@/lib/announce';
import { t } from '@/lib/i18n';
import { CustomiseBody } from './customise-parts';
import type { Destination } from './destinations';
import { cardOn, type HomeLayout } from './layout';

/**
 * Rearranging the landing page, from the landing page.
 *
 * A list of settings that applies as you touch it, so it has no Save and
 * no Cancel: the dialog's own X, Escape, the scrim and a phone's swipe are
 * the ways out, and each press is already stored by the time you use one.
 * The one button here is a verb: reset.
 *
 * Two halves. The cards come first, one switch each, and the list is
 * `HOME_CARDS`, the same list the page draws from, so a panel added to
 * the page is offered here the same moment. The dialog used to write its
 * own two switches and fell four panels behind the page.
 *
 * Then the destinations, in groups, which are the point of the design:
 * the list shows where everything IS rather than describing where it
 * would go. Switching a destination off moves it to the row under the
 * grid; hiding takes it off home altogether, into a third group it can be
 * brought back from.
 *
 * Hiding used to be refused on the grounds that nothing here should become
 * unreachable, which was the right worry aimed at the wrong page: home is
 * not the only way anywhere. The sidebar reaches every section, More lists
 * the rest, and a book is under Puzzles wherever home puts it. What hiding
 * costs is a shortcut, and a shortcut nobody uses is clutter, so the
 * third group is the honest place for it, listed by name and one press
 * from coming back.
 *
 * Order is moved with buttons rather than by dragging. There is no
 * drag-and-drop anywhere in this app and nothing to copy, and two buttons
 * are a keyboard and a screen reader's only way to do this at all.
 */
export function CustomiseDialog({
  layout,
  onChange,
  onReset,
  onClose,
}: {
  /** The arrangement on screen, with its tiles already spelled out: a
      never-customised device arrives here as the defaults written down,
      so a first edit says what it kept as well as what it changed. */
  layout: HomeLayout;
  onChange: (next: HomeLayout) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const toggleCard = (id: string): void =>
    onChange({
      ...layout,
      off: cardOn(layout, id) ? [...layout.off, id] : layout.off.filter((c) => c !== id),
    });

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

  // One press from wherever it stands, tile or button: hiding a tile via
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

  const move = (entry: Destination, from: number, by: -1 | 1): void => {
    const to = from + by;
    if (to < 0 || to >= layout.tiles.length) return;
    const next = [...layout.tiles];
    [next[from], next[to]] = [next[to]!, next[from]!];
    onChange({ ...layout, tiles: next });
    announce(
      t('{name} is now {n} of {total}', {
        name: t(entry.label),
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
        <CustomiseBody
          layout={layout}
          onToggleCard={toggleCard}
          onPromote={promote}
          onDemote={demote}
          onHide={hide}
          onUnhide={unhide}
          onMove={move}
          onReset={onReset}
        />
      </DialogContent>
    </Dialog>
  );
}
