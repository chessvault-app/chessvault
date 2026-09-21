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
    <Button
      variant="default"
      size="sm"
      // Under md the button is its plus alone: a square here, and on iOS
      // the filled circle among the chrome's glass ones (styles/shell.css,
      // data-chrome-circle, whose rules are under md too). A phone's
      // title row holds a magnifier and a switch or two beside it, and
      // the word was what wrapped that row, first under 360px and then
      // under 640 on the puzzle books shelf, each patched with a
      // breakpoint of its own. The platform's own apps make this button
      // a bare plus, and one rule replaces the patches (lanph3re,
      // 2026-09-19). The word is still read out.
      data-chrome-circle=""
      className="max-md:aspect-square max-md:px-0!"
      onClick={single ? single.onSelect : undefined}
    >
      <Plus className="glyph" data-icon="inline-start" />
      <span className="max-md:sr-only">{single ? t(single.label) : t(label)}</span>
      {!single && <ChevronDown className="ml-1 glyph-sm max-md:hidden" />}
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
        'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-30',
        // On iOS the bar is a capsule lifted off the edge, and its
        // footprint reaches higher than the docked bar's: the disc clears
        // the measured footprint by 1rem instead (styles/shell.css).
        'ios:bottom-[calc(var(--bottom-bar-h)+1rem)]',
        // Android: the same sum, which is the same number at rest (the
        // docked bar's 3.75rem plus its inset plus 1rem IS 4.75rem plus
        // the inset) and the right one when a page claims the edge, since
        // a claimed bar is the floating toolbar there now and stands
        // taller than the tab bar (shell/mobile-nav). The opening map is
        // both the one page with this disc and a page that claims the
        // edge, so the constant would have put the disc on the pill.
        'android:bottom-[calc(var(--bottom-bar-h)+1rem)]',
        'bg-primary text-primary-foreground hover:bg-primary-hover grid size-14 place-items-center rounded-full',
        // Android: Material 3 Expressive's FAB is a rounded SQUARE, 56px
        // with a 16px corner, not a disc. The size is already the M3
        // one; only the corner changes.
        'android:rounded-2xl',
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
