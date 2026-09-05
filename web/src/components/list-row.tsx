import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row of a list inside a panel, which goes somewhere when pressed.
 *
 * Extracted from seven hand-rolled copies across the home page, the
 * puzzle hub and the puzzle dashboard — the same ten classes retyped,
 * which is how a hover colour or a coarse-pointer rule ends up true of
 * five rows and false of two. It is the shape the app reaches for
 * whenever a panel holds a short list you can press: a recent game, a
 * book, a puzzle you have already seen.
 *
 * Not a Button, and not a Button variant. A Button is a control with an
 * edge you aim at; this is a whole row, full width and flush to the
 * panel's sides, and what you aim at is the text. Expressing it as a
 * variant would have meant a variant that switches off almost
 * everything a Button is — the radius, the inline width, the border,
 * the press-scale.
 *
 * Two props, because two are what the call sites actually differed on.
 * `divided` draws the hairline between rows, for a list whose panel
 * gives it no other separation. Both rhythms are read from the density
 * tokens in index.css rather than written here, so the Appearance card's
 * Density knob reaches every one of these rows.
 *
 * `dense` is the tighter rhythm of the
 * single-line history rows, against the two-line default. Type size
 * deliberately stays with the caller: the rows that carry their own
 * sized spans set it on those instead, and folding a text-sm in here
 * would have changed two of the seven.
 *
 * The hover is `enabled:`, so a row that is off does not light up under
 * the pointer. Only the home page's setup checklist disables itself, one
 * step at a time as they are done; for the other six, which are never
 * disabled, `enabled:hover` and `hover` are the same rule.
 */
export interface ListRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Hairline under every row but the last. */
  divided?: boolean;
  /** The one-line rhythm, a rung tighter than the default at either density. */
  dense?: boolean;
}

export function ListRow({
  divided = false,
  dense = false,
  className,
  type = 'button',
  ...props
}: ListRowProps) {
  return (
    <button
      type={type}
      className={cn(
        // The coarse floor: Home's Continue rows measured 37px on a phone,
        // the first thing a thumb reaches for and the smallest target on
        // the page. A row is a control and takes the icon rung.
        'flex w-full items-center gap-2.5 px-3 text-left transition-colors duration-100 pointer-coarse:min-h-11',
        'enabled:hover:bg-accent disabled:opacity-60',
        // The registry's ring, drawn INSET. Every panel these rows sit in
        // is `overflow-hidden rounded-xl`, and the global outline is drawn
        // outside the row, so on a full-width row three of its four sides
        // were clipped by the panel and the fourth lay on the hairline.
        // Measured on the phone home: tabbing to the Continue rows moved
        // nothing visible. Inside the row the ring survives the clip.
        'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none',
        divided && 'border-border border-b last:border-b-0',
        dense ? 'py-(--row-py-dense)' : 'py-(--row-py)',
        className,
      )}
      {...props}
    />
  );
}
