import type { ReactElement } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A `title` shown the way Button shows one, for a control that cannot be
 * a Button.
 *
 * `title` is a tooltip everywhere the registry primitives reach — Button,
 * Toggle, ToggleGroupItem, TabsTrigger, Switch — and the attribute itself
 * is never set there, so no control ever grows two tips. A hand-rolled
 * `<button>` reached none of that and fell back to the browser's bubble
 * instead: a different shape, a different delay, and nothing at all on
 * keyboard focus. Which tip you got was decided by whether the control's
 * geometry happened to fit Button's, and the disc inside an input sat two
 * pixels from a ⋯ that answered differently.
 *
 * The geometry is still a reason to keep the element — it is not a reason
 * to keep the browser's tip. The title goes here and the attribute is not
 * set, exactly as Button does it.
 *
 * Put it on the element the tip is ABOUT and on no ancestor of one: an
 * ancestor's `title` is what the browser falls back to while our own
 * tooltip shows for a child, which is two tips at once, one native and one
 * themed, overlapping. (The note in openingmap/FieldRow is where that was
 * found.) And a control that never sees a hover — anything drawn only
 * under a coarse pointer — wants `aria-label` and no tip at all, since
 * neither kind opens on touch.
 *
 * The caller translates, as Button's callers do.
 */
export function TitleTip({ title, children }: { title: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}
