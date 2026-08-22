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
   * colour, the raised pill alone made the two look interchangeable.
   */
  accent?: string;
}

/**
 * One choice out of two or three, all of them visible — in one of two
 * shapes, because it was being asked to do two different jobs in one.
 *
 * `tabs` is shadcn's Tabs track: one raised pill inside a muted strip,
 * which says "these are faces of one surface and this is the one
 * showing" — true of the databases panel and the archive's two sites.
 * `choice` is for a value: shadcn's ToggleGroup, the options standing as
 * joined outlined peers with the chosen one filled (lanph3re's call, from
 * a mock of the two side by side). The ROLES follow the shape, which is
 * the half a screen reader hears: a tablist announces panes, and a value
 * that is not a pane is a radiogroup. Both are driven by the same arrows.
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
  /** What the strip IS: `tabs` switches what is shown under it, `choice` sets a value. */
  kind?: 'tabs' | 'choice';
  /** The shape, where it should not follow from the kind: a `choice` of two icons keeps the track. */
  look?: 'track' | 'row';
  /** Halves (or thirds) of exactly equal width, for a COLUMN of these. */
  even?: boolean;
  className?: string;
}) {
  const tabs = kind === 'tabs';
  const track = (look ?? (tabs ? 'track' : 'row')) === 'track';
  // pointer-coarse:h-9 on the box, because a toolbar is a ROW and Button
  // and Select grow there too.
  const box = cn('flex shrink-0 items-center', size === 'sm' ? 'h-7 pointer-coarse:h-9' : 'h-8 pointer-coarse:h-9', className);
  const item = cn(
    // whitespace-nowrap: a segment is one or two words by definition, and a
    // crowded row must squeeze its flexible neighbour, not break 스터디
    // across two lines. flex-auto, not flex-1: each segment is as wide as
    // its label first; `even` takes each segment's own width out of the sum.
    'min-w-0 whitespace-nowrap',
    even ? 'flex-1 basis-0' : 'flex-auto',
    size === 'sm' ? 'px-1.5' : 'px-2.5',
  );

  if (tabs) {
    return (
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="contents">
        <TabsList aria-label={t(ariaLabel)} className={cn('w-auto', box)}>
          {segments.map(({ value: id, label, title, accent }) => (
            <TabsTrigger
              key={id}
              value={id}
              title={title ? t(title) : undefined}
              style={id === value && accent ? { color: accent } : undefined}
              className={cn(item, id === value && accent && 'font-semibold')}
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
      variant={track ? 'default' : 'outline'}
      size={size === 'sm' ? 'sm' : 'default'}
      spacing={0}
      // w-auto: the group is a block that fills its line (a column of these
      // lines up), not the registry's w-fit strip. The track look borrows
      // the Tabs strip's muted fill and raised pill.
      className={cn('w-auto', box, track && 'bg-muted rounded-lg p-[3px] gap-0')}
    >
      {segments.map(({ value: id, label, title, accent }) => (
        <ToggleGroupItem
          key={id}
          value={id}
          title={title ? t(title) : undefined}
          style={id === value && accent ? { color: accent } : undefined}
          className={cn(
            item,
            track &&
              'h-[calc(100%-1px)] rounded-md data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
            id === value && accent && 'font-semibold',
          )}
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
