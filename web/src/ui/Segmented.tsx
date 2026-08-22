import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
 * sites, and false of "play as". `choice` is for a value: no track, the
 * options standing as peers, the chosen one filled in the accent and the
 * rest outlined. lanph3re's call, from a mock of the two side by side.
 *
 * The ROLES follow the shape, which is the half a screen reader hears —
 * and they are shadcn's: a tablist (Tabs) announces panes, and a value
 * that is not a pane is a single-choice ToggleGroup, which Radix gives
 * radio semantics. Both are driven by the same arrow keys.
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
   * `choice` where it sets a value. Defaulting to `choice` because most
   * of these are settings, and a strip that really is a tablist should
   * have to say so.
   */
  kind?: 'tabs' | 'choice';
  /**
   * The shape, where it should not follow from the kind: a `choice` of two
   * icons or three numerals inside a sentence keeps the track and stays a
   * radiogroup.
   */
  look?: 'track' | 'row';
  /**
   * Halves (or thirds) of exactly equal width, whatever the labels say —
   * for a COLUMN of these, where two tracks whose lit pills break at 48%
   * and at 50% read as two controls of slightly different make.
   */
  even?: boolean;
  className?: string;
}) {
  const tabs = kind === 'tabs';
  const track = (look ?? (tabs ? 'track' : 'row')) === 'track';
  // Concentric radii, or the lit segment reads as clipped: child = parent −
  // border − padding, derived from the radius token. The coarse-pointer
  // height is set on the BOX and the segments fill it, so this lands on
  // exactly the 36px a Button's icon-sm and a Select take on touch.
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
  // The lit state is written as data-active / data-[state=on] variants, so
  // the same classes serve both shapes and Radix's own state attribute is
  // what lights them.
  const segClass = (accent?: string): string =>
    cn(
      // whitespace-nowrap: a segment is one or two words by definition, and
      // a crowded row must squeeze its flexible neighbour, not break 스터디
      // across two lines. flex-auto, not flex-1: each segment is as wide as
      // its label first and shares what is left after; `even` takes each
      // segment's own width out of the sum.
      'flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap',
      even ? 'flex-1 basis-0' : 'flex-auto',
      'font-medium transition-colors duration-100',
      seg,
      track
        ? // Raised, and in the segment's own colour where it has one;
          // the dead ones dimmer, so the gap between live and dead is a
          // step rather than a shade.
          cn(
            'text-subtle hover:text-foreground',
            'data-active:bg-surface-3 data-active:shadow-panel data-[state=on]:bg-surface-3 data-[state=on]:shadow-panel',
            accent
              ? 'data-active:font-semibold data-[state=on]:font-semibold'
              : 'data-active:text-foreground data-[state=on]:text-foreground',
          )
        : // The answer: filled in the accent, and outlined in it too, so it
          // reads as chosen rather than merely tinted; a peer that was not
          // chosen is an outline, not a hole.
          cn(
            'border-border text-muted-foreground hover:border-border-strong hover:text-foreground',
            'data-[state=on]:border-primary/40 data-[state=on]:bg-primary-soft',
            accent ? 'data-[state=on]:font-semibold' : 'data-[state=on]:text-primary',
          ),
    );
  const boxClass = cn('flex shrink-0 items-center', box, className);

  if (tabs) {
    return (
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="contents">
        <TabsList aria-label={t(ariaLabel)} className={cn('gap-0', boxClass)}>
          {segments.map(({ value: id, label, title, accent }) => (
            <TabsTrigger
              key={id}
              value={id}
              title={title ? t(title) : undefined}
              style={id === value && accent ? { color: accent } : undefined}
              className={segClass(accent)}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    );
  }

  return (
    <ToggleGroup
      type="single"
      value={value}
      // A press on the chosen segment must not un-choose it: a choice here
      // always has an answer.
      onValueChange={(v) => {
        if (v) onChange(v as T);
      }}
      aria-label={t(ariaLabel)}
      variant="plain"
      size="none"
      // w-auto: the group is a block that fills its line (a column of these
      // lines up), not the stock w-fit strip.
      className={cn('w-auto gap-0', boxClass)}
    >
      {segments.map(({ value: id, label, title, accent }) => (
        <ToggleGroupItem
          key={id}
          value={id}
          title={title ? t(title) : undefined}
          style={id === value && accent ? { color: accent } : undefined}
          className={segClass(accent)}
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
