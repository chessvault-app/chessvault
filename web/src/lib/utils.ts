import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge, told about the one font size the app added.
 *
 * It groups utilities by parsing the class name, and its list of font
 * sizes is Tailwind's own ramp — so `text-micro` (index.css, the rung
 * below `text-xs`) matched nothing it knew and fell through to the group
 * every other unrecognised `text-*` lands in: COLOUR. Beside a colour on
 * the same element the two then read as one conflict and the later one
 * won, silently dropping the size.
 *
 * That is not hypothetical. The eval bar's readout is
 * `text-micro … text-on-eval-white`, and the number inside a 28px bar was
 * being drawn at the inherited 16px (lanph3re spotted it growing). Naming
 * the tier here is what makes a named tier behave like the ramp it was
 * added to; any future `--text-*` rung belongs in this list too.
 */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['micro'] }] } },
});

/**
 * Merge conditional class names, with later Tailwind utilities winning.
 *
 * Where shadcn keeps it (`@/lib/utils`, see components.json): every
 * component the registry adds imports `cn` from here, so this is the one
 * path that must exist.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
