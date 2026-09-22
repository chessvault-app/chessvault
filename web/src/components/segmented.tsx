import * as React from 'react';
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
 * the `row` look has no shape to draw so it draws as the track, and the
 * segments are forced to equal width ("Platform-specific design",
 * docs/design-principles.md). The sliding thumb itself is NOT one of
 * these: it is what a track-shaped segmented control does on every
 * platform now (see the thumb below).
 */
function useIosSegmented(): boolean {
  const phone = useMediaQuery(PHONE_MQ);
  return phone && currentPlatform() === 'ios';
}

/**
 * Where the thumb is, measured.
 *
 * The thumb used to be placed by index and percent, which only works
 * where every segment is the same width — true on an iPhone, where they
 * are forced to be, and false everywhere else: a `choice` sizes each
 * segment to its own label. So the pressed item's box is read instead,
 * as a delta from the group's own, and published as four variables the
 * thumb is drawn from. That box IS the fill the item used to paint, so
 * the strip at rest is the same pixels it was before the thumb existed.
 *
 * A ResizeObserver on the group and on the pressed item catches a reflow
 * (a language change, a column resize, a label that wraps). The first
 * measurement is written in a layout effect, before the first paint, and
 * the transition is hung on the element only once it has been: a thumb
 * that animated from 0 to its resting box on mount would slide in from
 * the strip's left edge every time the control appeared.
 *
 * CSS could not do this alone: anchor positioning is the shape that
 * would, and WebKit does not have it.
 */
function useSegmentedThumb(
  box: HTMLDivElement | null,
  on: boolean,
  value: string,
): boolean {
  const [placed, setPlaced] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!on || !box) return;
    const measure = (): void => {
      const item = box.querySelector<HTMLElement>('[data-slot=toggle-group-item][aria-pressed=true]');
      if (!item) return;
      const outer = box.getBoundingClientRect();
      const inner = item.getBoundingClientRect();
      box.style.setProperty('--seg-x', `${inner.left - outer.left}px`);
      box.style.setProperty('--seg-y', `${inner.top - outer.top}px`);
      box.style.setProperty('--seg-w', `${inner.width}px`);
      box.style.setProperty('--seg-h', `${inner.height}px`);
      setPlaced(true);
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const item = box.querySelector<HTMLElement>('[data-slot=toggle-group-item][aria-pressed=true]');
    if (item) observer.observe(item);
    return () => observer.disconnect();
  }, [on, box, value]);
  return placed;
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
 * Wherever the track is what is drawn, the raised pill is ONE element
 * that slides to the segment that was pressed, on every platform: a fill
 * that jumps from one segment to the next is the older idiom, and it was
 * kept here only because the sliding one arrived as part of an iOS pass.
 * At rest the thumb covers exactly the box the pressed segment used to
 * fill, so nothing moves until something is pressed.
 *
 * What stays iOS-only is the SHAPE: iOS has one segmented control and no
 * outlined-peers row to borrow, so a `choice` draws as a track there
 * whatever its `look` says, and its segments are forced to equal width.
 * The roles, the arrow keys and an `accent` on the live segment are the
 * same on every platform.
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
  // The raised pill is one element that MOVES, wherever the track look is
  // drawn and on every platform: a pill that jumps from segment to segment
  // is what every other track-shaped segmented control stopped doing years
  // ago, and it was iOS-only here out of caution rather than because the
  // idiom is the platform's. (The tabs track has no call site and its
  // selected fill carries dark: rules that only the registry file may
  // override, so that branch is untouched.)
  const slide = track && !tabs;
  const index = segments.findIndex((s) => s.value === value);
  const [thumbBox, setThumbBox] = React.useState<HTMLDivElement | null>(null);
  const thumbPlaced = useSegmentedThumb(thumbBox, slide && index >= 0, value);
  // pointer-coarse:h-9 on the box, because a toolbar is a ROW and Button
  // and Select grow there too.
  const box = cn('flex shrink-0 items-center', size === 'sm' ? 'h-7 pointer-coarse:h-9' : 'h-8 pointer-coarse:h-9', className);
  const item = cn(
    // whitespace-nowrap: a segment is one or two words by definition, and a
    // crowded row must squeeze its flexible neighbour, not break 스터디
    // across two lines. flex-auto, not flex-1: each segment is as wide as
    // its label first; `even` takes each segment's own width out of the sum.
    // iOS segments are always equal width, which is the platform's own
    // shape and not something the thumb needs: the thumb is measured, so
    // it sits over whatever width the segment it means happens to have.
    'min-w-0 whitespace-nowrap',
    even || (ios && !tabs) ? 'flex-1 basis-0' : 'flex-auto',
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
      ref={setThumbBox}
      // How far the track holds its contents in from its own edge, which
      // is also what makes the thumb's radius concentric with the track's
      // (`--tg-r-inner`, ui/toggle-group.tsx). Declared rather than
      // written into the padding class, so the two cannot drift.
      style={track ? ({ '--tg-inset': '3px' } as React.CSSProperties) : undefined}
      // w-auto: the group is a block that fills its line (a column of these
      // lines up), not the registry's w-fit strip. The track look borrows
      // the Tabs strip's muted fill and raised pill.
      className={cn('w-auto', box, track && 'bg-muted p-(--tg-inset) gap-0', slide && 'relative')}
    >
      {slide && index >= 0 && (
        /* The raised thumb, one element for the whole strip, drawn on the
           pressed segment's own measured box (useSegmentedThumb). It moves
           on `transform`, which is composited; the width is animated
           beside it because segments here are not all the same width, and
           an absolutely positioned element's width costs no layout to
           anything around it.
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
          className={cn(
            // Concentric with the track it sits in, not a rung of its own:
            // the track's radius less the 3px it holds the thumb in by
            // (ui/toggle-group.tsx). At `rounded-md` the thumb was as round
            // as the track around it and the gap splayed at the corners.
            'bg-background pointer-events-none absolute top-0 left-0 rounded-(--tg-r-inner) shadow-sm',
            thumbPlaced &&
              'transition-[transform,width] duration-(--pane-turn) ease-(--pane-turn-ease)',
          )}
          style={{
            width: 'var(--seg-w, 0px)',
            height: 'var(--seg-h, 0px)',
            transform: 'translate(var(--seg-x, 0px), var(--seg-y, 0px))',
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
            // The same concentric radius as the thumb: where the thumb is
            // not drawn (the tabs track), this fill IS the raised pill.
            track &&
              'h-[calc(100%-1px)] rounded-(--tg-r-inner) aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm',
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
