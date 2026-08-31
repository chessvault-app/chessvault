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
 * The caller translates, as Button's callers do. An undefined title is no
 * tip and no wrapper, the way Button and FilterChip already treat one —
 * a control that is only sometimes worth explaining says so by passing
 * undefined rather than by being written twice.
 *
 * Never nest one inside another. A tooltip opens on the pointer ENTERING
 * its trigger, and entering a child is entering the parent too — so a tip
 * inside a tip is both of them open at once, which is the thing this
 * component exists to stop. Where a row and something inside it each have
 * something to say, put the row's on the row's own words, beside the
 * inner control rather than around it (openingmap/FieldRow, and the
 * chapter rows in studies/StudyView).
 */
export function TitleTip({ title, children }: { title?: string; children: ReactElement }) {
  if (title === undefined) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      {/* A newline in a title is a line break, which is what the browser's
          bubble did with one. Two of these carry a fact and its footnote
          on separate lines (the puzzle tiles); everywhere else the class
          costs nothing, since it only collapses runs of spaces the way
          `normal` already does. */}
      <TooltipContent className="whitespace-pre-line">{title}</TooltipContent>
    </Tooltip>
  );
}
