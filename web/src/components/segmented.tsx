import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { currentPlatform } from '@/lib/platform';

/** Below `md`: the phone shell, the only place the chrome is platform-specific. */
const PHONE_MQ = '(max-width: 47.9375rem)';

/**
 * Whether this strip draws iOS's segmented control.
 *
 * iOS has exactly one: a rounded track with a raised thumb that slides.
 * There is no outlined-peers shape on the platform, so the `row` look has
 * none to draw either, and a phone-sized iPad or a rotated iPhone has to
 * be able to change its mind — hence a media query rather than a class.
 * In TypeScript and not a variant because what changes is the GEOMETRY:
 * one thumb element instead of a fill per item, and segments of equal
 * width for it to travel over ("Platform-specific design",
 * docs/design-principles.md).
 */
function useIosSegmented(): boolean {
  const phone = useMediaQuery(PHONE_MQ);
  return phone && currentPlatform() === 'ios';
}

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
 * that is not a pane is a group of toggles with one pressed. Both are
 * driven by the same arrows.
 *
 * On an iPhone there is only the first shape: iOS has one segmented
 * control, a rounded track whose raised thumb SLIDES between segments of
 * equal width, and no outlined-peers row to borrow. So a `choice` draws
 * as a track there whatever its `look` says, and the pill is one moving
 * element rather than a fill per item. The roles, the arrow keys and an
 * `accent` on the live segment are the same on every platform; Android
 * and desktop draw exactly what they drew before.
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
  /**
   * The shape, where it should not follow from the kind: a `choice` of two
   * icons keeps the track; `line` is the registry's underlined tabs, for
   * `tabs` that head a surface rather than sit in a toolbar. A line list
   * is 40px and its underline sits on the row's own bottom rule, so the
   * caller draws that rule (`border-b`) and no vertical padding, as the
   * Games page's pane strip does.
   */
  look?: 'track' | 'row' | 'line';
  /** Halves (or thirds) of exactly equal width, for a COLUMN of these. */
  even?: boolean;
  className?: string;
}) {
  const ios = useIosSegmented();
  const tabs = kind === 'tabs';
  const line = tabs && look === 'line';
  // On an iPhone the `row` look draws as the track, so every `choice` is
  // the one segmented control the platform has. `line` is untouched: it
  // heads a surface and is a tab bar, not a segmented control.
  const track = (look ?? (tabs ? 'track' : 'row')) === 'track' || (ios && !tabs);
  // The raised pill becomes one element that MOVES, on the choice strip
  // (the tabs track has no call site and its selected fill carries dark:
  // rules that only the registry file may override).
  const slide = ios && !tabs;
  const index = segments.findIndex((s) => s.value === value);
  // pointer-coarse:h-9 on the box, because a toolbar is a ROW and Button
  // and Select grow there too.
  const box = cn('flex shrink-0 items-center', size === 'sm' ? 'h-7 pointer-coarse:h-9' : 'h-8 pointer-coarse:h-9', className);
  const item = cn(
    // whitespace-nowrap: a segment is one or two words by definition, and a
    // crowded row must squeeze its flexible neighbour, not break 스터디
    // across two lines. flex-auto, not flex-1: each segment is as wide as
    // its label first; `even` takes each segment's own width out of the sum.
    // iOS segments are always equal width, and the sliding thumb needs
    // them to be: it travels one segment per step, so an unequal strip
    // would land it beside the label it means.
    'min-w-0 whitespace-nowrap',
    even || slide ? 'flex-1 basis-0' : 'flex-auto',
    size === 'sm' ? 'px-1.5' : 'px-2.5',
  );

  if (tabs) {
    return (
      <Tabs value={value} onValueChange={(v) => onChange(v as T)} className="contents">
        <TabsList
          variant={line ? 'line' : 'default'}
          aria-label={t(ariaLabel)}
          className={cn(
            'w-auto',
            // The line list: the Games page's geometry (GamesBrowser), so
            // the two read as one control. 40px triggers, no track, and
            // the underline ON the caller's rule rather than 5px under it.
            // group-data-horizontal/tabs:h-10, in the list's own variant, since
            // its base rule sets h-8 under that variant and a bare h-10 lost.
            line
              ? cn('flex shrink-0 items-center gap-1 rounded-none border-0 bg-transparent p-0 group-data-horizontal/tabs:h-10 pointer-coarse:group-data-horizontal/tabs:h-10', className)
              : box,
          )}
        >
          {segments.map(({ value: id, label, title, accent }) => (
            <TabsTrigger
              key={id}
              value={id}
              title={title ? t(title) : undefined}
              style={id === value && accent ? { color: accent } : undefined}
              className={cn(
                item,
                line && 'h-10 flex-none rounded-none px-1.5 font-semibold group-data-horizontal/tabs:after:bottom-0',
                id === value && accent && 'font-semibold',
              )}
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
      value={[value]}
      // A press on the chosen segment must not un-choose it: a choice here
      // always has an answer. (Base UI's group value is an array; one
      // entry long here, and empty when the chosen segment was re-pressed
      // — which is the press that must change nothing.)
      onValueChange={(v: string[]) => {
        if (v[0]) onChange(v[0] as T);
      }}
      aria-label={t(ariaLabel)}
      variant={track ? 'default' : 'outline'}
      size={size === 'sm' ? 'sm' : 'default'}
      spacing={0}
      // w-auto: the group is a block that fills its line (a column of these
      // lines up), not the registry's w-fit strip. The track look borrows
      // the Tabs strip's muted fill and raised pill.
      className={cn('w-auto', box, track && 'bg-muted rounded-lg p-[3px] gap-0', slide && 'relative')}
    >
      {slide && index >= 0 && (
        /* The raised thumb, one element for the whole strip. Its box is
           the track's padding box, so a segment is (100% - 2 * 3px) / n
           wide and one step is exactly its own width — which is why it
           moves on `transform` (composited, and a percentage translate
           is read against the thumb itself) rather than on `left`.
           The app's spring is the easing: 337ms to rest, 90% of the way
           at about 180ms, so it arrives as a 200ms ease would and only
           the tail is softer (styles/pane-swipe.css). The bottom bar's
           pill already moves on it, and two sliding pills on one screen
           at two speeds read as two apps. `prefers-reduced-motion` is
           honoured by the blanket clamp in styles/base.css: the thumb
           then jumps, which is the point. */
        <span
          aria-hidden
          data-segmented-thumb
          className="bg-background pointer-events-none absolute inset-y-[3px] left-[3px] rounded-md shadow-sm transition-transform duration-(--pane-turn) ease-(--pane-turn-ease)"
          style={{
            width: `calc((100% - 6px) / ${segments.length})`,
            transform: `translateX(calc(100% * ${index}))`,
          }}
        />
      )}
      {segments.map(({ value: id, label, title, accent }) => (
        <ToggleGroupItem
          key={id}
          value={id}
          title={title ? t(title) : undefined}
          style={id === value && accent ? { color: accent } : undefined}
          className={cn(
            item,
            track &&
              'h-[calc(100%-1px)] rounded-md aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm',
            // The thumb paints the raised fill for whichever segment it
            // is under, so the item must not paint its own; `relative`
            // puts the label over the thumb, which is positioned.
            slide && 'relative aria-pressed:bg-transparent aria-pressed:shadow-none',
            id === value && accent && 'font-semibold',
          )}
        >
          {label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
