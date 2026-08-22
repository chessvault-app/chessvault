import { ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionSheet } from './ActionSheet';
import { Button } from './Button';
import { useCloseRequest } from './dialogFocus';
import { t } from '@/lib/i18n';

export interface FabAction {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
}

/**
 * The room a scrolling page has to leave at its bottom for the Fab.
 *
 * A fixed button cannot push anything, so the page has to know about it:
 * the Fab floats 4.5rem off the bottom of the WINDOW and stands 3.5rem
 * tall, which puts its top 8rem up — about 4rem into a page whose own
 * bottom edge is the top of the phone's tab bar. Without this the last
 * row of every shelf sits under it, and the last row is exactly where
 * you end up after scrolling.
 *
 * An ELEMENT, not padding-bottom on the scroll container. Browsers drop
 * the bottom padding of a `flex-col` + `overflow-y-auto` box once its
 * content overflows — so the first version of this worked on whichever
 * shelf happened to be short enough not to scroll and silently did
 * nothing on the rest. lanph3re saw the gap on notes and nowhere else,
 * which is exactly that shape. A real box in the flow cannot be dropped.
 *
 * shrink-0 because it lives in a flex column, which would otherwise
 * squash it back to nothing. Gone from md, where the Fab is hidden and
 * the header's Create button takes over.
 */
export function FabSpacer() {
  return <div aria-hidden className="h-[5.5rem] w-full shrink-0 md:hidden" />;
}

/**
 * Making something new: a button in the page header on a desktop, a round
 * one in the bottom-right corner on a phone.
 *
 * Both, from one list of actions. A header is where a mouse expects the
 * page's own controls and there is no reach to worry about; a thumb has
 * the opposite problem, and the top corner of a phone is the worst place
 * on the screen for the button people press most.
 */
export function CreateControl({ actions, label = 'Create' }: { actions: FabAction[]; label?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const single = actions.length === 1 ? actions[0] : null;

  return (
    <>
      <Button
        ref={trigger}
        variant="primary"
        size="sm"
        className="hidden md:inline-flex"
        onClick={() => (single ? single.onSelect() : setMenuOpen(true))}
      >
        <Plus className="mr-1 size-3.5" />
        {single ? t(single.label) : t(label)}
        {!single && <ChevronDown className="ml-1 size-3" />}
      </Button>

      {menuOpen && (
        <ActionSheet
          title={label}
          anchor={trigger}
          onClose={() => setMenuOpen(false)}
          actions={actions.map((a) => ({ ...a }))}
        />
      )}

      <Fab actions={actions} label={label} className="md:hidden" />
    </>
  );
}

/**
 * The round button in the corner, phones only (see CreateControl).
 *
 * One action fires on tap. Several fan upwards as labelled pills, so the
 * choice reads as a list of things you can make rather than a menu to open
 * and then read.
 *
 * These were briefly a bottom sheet, on the theory that one menu idiom per
 * phone beats two. It is the wrong comparison. A row's ⋯ is a menu about
 * that row, and a sheet that covers the list is fine because the row is
 * named at the top of it. This is two or three ways to make one thing, and
 * a sheet for them buys a scrim, a title bar and a handle to answer a
 * question the button already asked. The pills answer it in place, beside
 * the thumb that is still on the button, and the page stays visible behind
 * them — which matters, because what you make lands in that page.
 *
 * What the sheet was actually right about is the PAGES these open, and
 * those stayed sheets.
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
  const host = useRef<HTMLDivElement>(null);
  const single = actions.length === 1 ? actions[0] : null;

  // No scrim, so dismissal is a press anywhere else. Both mousedown and
  // touchstart: a phone fires touchstart first and would otherwise leave
  // the pills up until the click landed.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);
  // Escape, and Android's Back gesture — open pills are the most
  // Back-shaped thing on the screen while they are up.
  useCloseRequest(() => setOpen(false), open);

  return (
    <div
      ref={host}
      // Above the phone's bottom bar and its home indicator. Fixed, so a
      // scrolling list never takes it away — making something new is
      // available from anywhere in the list, not only from the top of it.
      className={cn(
        'fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-30',
        'flex flex-col items-end gap-2',
        className,
      )}
    >
      {open &&
        actions.map(({ label: itemLabel, icon: Icon, onSelect }) => (
          <button
            key={itemLabel}
            type="button"
            onClick={() => {
              setOpen(false);
              onSelect();
            }}
            // The INVERTED surface, like the undo chip — not `bg-card`,
            // which is the colour of the cards these float over. A pill in
            // card colours over a shelf of cards is a card-coloured shape
            // among card-coloured shapes: it read as part of the list
            // rather than as something that had just opened. The opposite
            // of the page needs no help being told from it.
            className={cn(
              'bg-toast text-toast-foreground flex items-center gap-2 rounded-full py-2 pl-3 pr-4',
              'text-base shadow-pop transition-opacity duration-100 active:opacity-80',
            )}
          >
            <Icon className="size-4 shrink-0 opacity-70" />
            {t(itemLabel)}
          </button>
        ))}

      <button
        type="button"
        title={single ? t(single.label) : t(label)}
        aria-label={single ? t(single.label) : t(label)}
        aria-expanded={single ? undefined : open}
        onClick={() => (single ? single.onSelect() : setOpen((v) => !v))}
        // The hairline every other floating thing in the app has. A disc
        // of flat colour with only a shadow under it has no edge of its
        // own: over a pale panel it ended where the eye guessed, and the
        // shadow — which is what a phone's own buttons do NOT have — was
        // carrying the whole job. Drawn in the button's own foreground at
        // low alpha, so it darkens the rim in dark mode and lightens it
        // in light, instead of dropping a grey ring on a blue disc.
        className={cn(
          'bg-primary text-primary-foreground hover:bg-primary-hover grid size-14 place-items-center rounded-full',
          'border border-primary-foreground/30',
          'shadow-pop transition-transform duration-100 active:scale-95',
        )}
      >
        {open ? <X className="size-6" /> : <Icon className="size-6" strokeWidth={2.5} />}
      </button>
    </div>
  );
}
