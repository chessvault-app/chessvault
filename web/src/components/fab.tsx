import { ChevronDown, Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ActionMenu } from '@/components/action-menu';
import { t } from '@/lib/i18n';

export interface FabAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Drawn but not pressable: for an action whose precondition is still
      being checked, so its place in the row is held rather than filled
      in late. */
  disabled?: boolean;
}

/**
 * Making something new: a button in the page header, at every width.
 *
 * It was a header button on a desktop and a round one floating over the
 * bottom-right corner on a phone, on the argument that the top corner of
 * a phone is the worst place for the button people press most. Two
 * things turned that around. The disc fanned its several actions out as
 * a stack of pills over the last rows of the shelf, which is the shape
 * every current phone platform has stepped back from (Material 3
 * Expressive retired the stacked FAB; iOS never had one), and the disc
 * hid the more-actions button of whichever row Tab or a scroll ended on,
 * which two rounds of measured clearance only worked around. A shelf's
 * create verb is not the button people press most on it; the rows are.
 * So the button sits on the title row on a phone as well, where Studies,
 * Notes and Books already draw it for a mouse, and the several actions
 * open as the same action sheet every ⋯ on the page opens.
 *
 * The cost is honest: after a long scroll, making something means
 * scrolling back to the header. The row's own verbs, which are the ones
 * reached from the middle of a list, are unchanged.
 */
export function CreateControl({ actions, label = 'Create' }: { actions: FabAction[]; label?: string }) {
  const single = actions.length === 1 ? actions[0] : null;
  const button = (
    <Button variant="default" size="sm" onClick={single ? single.onSelect : undefined}>
      <Plus className="size-3.5" data-icon="inline-start" />
      {single ? t(single.label) : t(label)}
      {!single && <ChevronDown className="ml-1 size-3" />}
    </Button>
  );

  if (single) return button;
  return (
    <ActionMenu title={label} actions={actions}>
      {button}
    </ActionMenu>
  );
}

/**
 * The round button in the corner, phones only. One caller: the opening
 * map, whose verbs act on a canvas that pans under the finger, so a
 * header would be out of reach the moment the map is in use. A canvas
 * is where a floating control belongs; a shelf is not (see
 * CreateControl).
 *
 * One action fires on tap. Several open the action sheet, the same one a
 * row's ⋯ opens, titled with the disc's own label. They fanned upwards as
 * labelled pills for a while, on the argument that pills answer the
 * question in place beside the thumb. Over a map the pills stood on the
 * map, six of them, with no scrim and no title, and the sheet is the one
 * menu idiom the phone has everywhere else.
 */
export function Fab({
  actions,
  label = 'Create',
  icon: Icon = Plus,
  className,
}: {
  actions: FabAction[];
  label?: string;
  /** The closed disc's glyph. Plus reads "create"; a page whose FAB is
      its menu (the opening map) passes its own. */
  icon?: LucideIcon;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const single = actions.length === 1 ? actions[0] : null;

  const disc = (
    // aria-label and no tip: every call site draws this `md:hidden`, so
    // the only pointer that reaches it is a thumb — and no tooltip in
    // this app opens on touch. The title beside it could not be shown
    // to anyone.
    <button
      type="button"
      aria-label={single ? t(single.label) : t(label)}
      onClick={single ? single.onSelect : undefined}
      // Above the phone's bottom bar and its home indicator. Fixed, so a
      // panning canvas never takes it away.
      //
      // The hairline every other floating thing in the app has. A disc
      // of flat colour with only a shadow under it has no edge of its
      // own: over a pale panel it ended where the eye guessed, and the
      // shadow — which is what a phone's own buttons do NOT have — was
      // carrying the whole job. Drawn in the button's own foreground at
      // low alpha, so it darkens the rim in dark mode and lightens it
      // in light, instead of dropping a grey ring on a blue disc.
      //
      // Pressed is a dimming, not a squash. active:scale-95 was the only
      // press-scale in the app, and a control that shrinks under the
      // thumb is a toy's idea of feedback.
      //
      // Its shadow goes while it has keyboard focus: the ring it wears
      // is the page's own 3px outline, drawn in the band immediately
      // outside the disc, which is exactly where `shadow-lg` is darkest.
      // Measured on a phone in light, the disc's ring read 3.03:1
      // against its shadow on #/openingmap, 3.776 once the shadow is
      // out of the band the ring is drawn in.
      className={cn(
        'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30',
        'bg-primary text-primary-foreground hover:bg-primary-hover grid size-14 place-items-center rounded-full',
        'border border-primary-foreground/30',
        'shadow-lg transition-opacity duration-100 active:opacity-80',
        'focus-visible:shadow-none',
        className,
      )}
    >
      {/* The glyph TURNS into the close mark rather than swapping: both
          sit in one cell and the cell rotates a quarter turn on the
          spring while they cross-fade, which is Material's FAB-to-close
          and reads as the same button changing its mind. */}
      <span
        aria-hidden
        className={cn(
          'grid transition-[rotate] duration-(--pane-turn) ease-(--pane-turn-ease) *:col-start-1 *:row-start-1',
          open && 'rotate-90',
        )}
      >
        <Icon
          className={cn('size-6 transition-opacity duration-(--pane-turn)', open && 'opacity-0')}
          strokeWidth={2.5}
        />
        <X className={cn('size-6 transition-opacity duration-(--pane-turn)', !open && 'opacity-0')} />
      </span>
    </button>
  );

  if (single) return disc;
  return (
    <ActionMenu title={label} actions={actions} open={open} onOpenChange={setOpen}>
      {disc}
    </ActionMenu>
  );
}
