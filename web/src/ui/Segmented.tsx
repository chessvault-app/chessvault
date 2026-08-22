import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useRovingTabs } from './roving';
import { t } from '@/lib/i18n';

export interface Segment<T extends string> {
  value: T;
  /** Text, or an icon and text — whatever the segment reads as. */
  label: ReactNode;
  /** For an icon-only segment, which has no visible name. */
  title?: string;
  /**
   * The colour this segment answers to when it is the live one — a site's
   * own green, say. Where a segment stands for something that HAS a
   * colour, the raised surface alone made the two look interchangeable.
   */
  accent?: string;
}

/**
 * One choice out of two or three, all of them visible — in one of two
 * shapes, because it was being asked to do two different jobs in one.
 *
 * `tabs` is the original: a track with one lit segment inside it. That
 * shape says "these are faces of one surface and this is the one
 * showing", which is true of the databases panel and the archive's two
 * sites, and false of "play as". A track cannot say "here are the
 * options and this is the answer" — it says the answer IS the surface.
 *
 * `choice` is for a value: no track, the options standing as peers, the
 * chosen one filled in the accent and the rest outlined. It is sized to
 * its words rather than splitting a fixed track, which is what made
 * "Databases | PGN collections" sit oddly in a shape built for
 * "White | Black". lanph3re's call, from a mock of the two side by side.
 *
 * The outer height is the same either way, so a control in a toolbar row
 * does not move when its kind changes.
 *
 * The ROLES follow the shape, which is the half a screen reader hears: a
 * tablist announces panes, and a value that is not a pane is a
 * radiogroup. Both are driven by the same arrow keys (ui/roving).
 */
export function Segmented<T extends string>({
  value,
  onChange,
  segments,
  ariaLabel,
  size = 'md',
  kind = 'choice',
  look,
  even = false,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  segments: Segment<T>[];
  ariaLabel: string;
  /** `sm` is the icon-only size used in a toolbar. */
  size?: 'sm' | 'md';
  /**
   * What the strip IS: `tabs` where it switches what is shown under it,
   * `choice` where it sets a value. This decides the ROLES a screen
   * reader hears — a tablist announces panes, and a value that is not a
   * pane is a radiogroup — and, by default, the shape.
   *
   * Defaulting to `choice` because most of these are settings, and a
   * strip that really is a tablist should have to say so.
   */
  kind?: 'tabs' | 'choice';
  /**
   * The shape, where it should not follow from the kind.
   *
   * A `choice` is a row of outlined peers, which needs WORDS: the
   * shelf's grid/list pair is two icons, and the opening map's "at least
   * 2 / 5 / 10 games" is three numerals inside a sentence. Stripped of
   * the track, both read as separate toggles rather than as one question
   * — this component's own first argument, and it still holds. They keep
   * the track and stay a radiogroup, which is the half that was wrong
   * before.
   */
  look?: 'track' | 'row';
  /**
   * Halves (or thirds) of exactly equal width, whatever the labels say.
   *
   * The default sizes each segment by its own label first (see the
   * flex-auto note below), which is right for a control read on its
   * own. It is wrong for a COLUMN of them: stacked as fields in a form,
   * two tracks whose lit pills break at 48% and at 50% read as two
   * controls of slightly different make, and the eye finds the 7px it
   * cannot name. Where the segments are stacked, this lines them up.
   */
  even?: boolean;
  className?: string;
}) {
  // Concentric radii, or the lit segment reads as clipped: a child corner
  // rounded MORE than the space left inside the parent's own curve pushes
  // through it, and the difference shows first at the top-left. The rule
  // is child = parent − border − padding, so the two sizes carry matched
  // sets rather than one radius reused at both.
  // Derived from the radius token rather than a matching literal, so the
  // pair stays concentric if the scale ever moves.
  // The coarse-pointer height is set on the BOX and the segments fill it,
  // rather than growing the segments and letting the padding and border
  // add themselves on top. That way this lands on exactly the 36px a
  // Button's `icon-sm` and a Select take on touch — a toolbar is a row,
  // and 34 or 38 would be as visibly wrong as the 30 it used to be.
  const tabs = kind === 'tabs';
  const track = (look ?? (tabs ? 'track' : 'row')) === 'track';
  // `choice` has no track, so the buttons carry the height the box used
  // to: 28px at sm and 36px at md, which is what every neighbouring
  // control in a toolbar row already stands at. A kind change must not
  // move the row it sits in.
  const box = track
    ? size === 'sm'
      ? 'border-border bg-surface-inset border rounded-lg p-0.5 pointer-coarse:h-9'
      : 'border-border bg-surface-inset border rounded-xl p-1 pointer-coarse:h-9'
    : 'gap-2';
  const seg = track
    ? size === 'sm'
      ? 'h-6 pointer-coarse:h-full rounded-[calc(var(--radius-lg)-3px)] px-1.5 text-sm'
      : 'h-7 pointer-coarse:h-full rounded-[calc(var(--radius-xl)-5px)] px-2.5 text-sm'
    : size === 'sm'
      ? 'h-7 rounded-lg border px-2.5 text-sm pointer-coarse:h-9'
      : 'h-9 rounded-lg border px-3 text-sm';

  const roving = useRovingTabs(
    segments.map((seg) => seg.value),
    value,
    onChange,
  );
  return (
    <div
      role={tabs ? 'tablist' : 'radiogroup'}
      aria-label={t(ariaLabel)}
      {...roving.stripProps}
      className={cn('flex shrink-0 items-center', box, className)}
    >
      {segments.map(({ value: id, label, title, accent }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role={tabs ? 'tab' : 'radio'}
            {...(tabs ? { 'aria-selected': on } : { 'aria-checked': on })}
            tabIndex={roving.tabIndex(id)}
            title={title ? t(title) : undefined}
            onClick={() => onChange(id)}
            style={on && accent ? { color: accent } : undefined}
            className={cn(
              // whitespace-nowrap: a segment is one or two words by
              // definition, and `min-w-0` lets a crowded row squeeze it
              // narrower than they are. Beside a filter field in Korean
              // that broke "스터디" across two lines inside a 28px-tall
              // pill — a control taller than its track. It shrinks the
              // row's flexible neighbour instead now.
              // flex-auto, not flex-1: both grow into a track that has been
              // stretched (the archive's is w-full), but flex-1 starts every
              // segment from a basis of ZERO, so they end up the same width
              // whatever they say — and a pair like "Databases" and "PGN
              // collections" then sets one word in a box built for two, with
              // the short one adrift in its own padding. From a basis of
              // auto each segment is as wide as its label first and shares
              // what is left after.
              'flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap',
              // basis-0 is the half of flex-1 that does the work here:
              // it takes each segment's own width out of the sum, so
              // what is shared is the whole track.
              even ? 'flex-1 basis-0' : 'flex-auto',
              'font-medium transition-colors duration-100',
              seg,
              track
                ? on
                  ? // Raised, and in the segment's own colour where it has
                    // one. Two grey pills side by side made the live site
                    // and the dead one look interchangeable.
                    'bg-surface-3 shadow-panel ' + (accent ? 'font-semibold' : 'text-foreground')
                  : // Dimmer than it was, so the gap between live and dead
                    // is a step rather than a shade.
                    'text-subtle hover:text-foreground'
                : on
                  ? // The answer: filled in the accent, and outlined in it
                    // too, so it reads as chosen rather than merely tinted.
                    'border-primary/40 bg-primary-soft ' + (accent ? 'font-semibold' : 'text-primary')
                  : // A peer that was not chosen — an outline, not a hole.
                    'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
