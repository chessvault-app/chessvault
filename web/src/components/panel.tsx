import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardAction, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { TitleTip } from '@/components/title-tip';

interface PanelProps {
  children: ReactNode;
  className?: string;
  /**
   * Makes the panel height-resizable on desktop: a grip appears along the
   * bottom edge, and the chosen height persists in localStorage under this
   * key. Double-click the grip to return to the default.
   */
  resizeKey?: string;
  /**
   * Height (px) used on desktop while the user has not dragged their own —
   * the compact out-of-the-box size. Without it, resets return the panel
   * to plain flex sizing.
   */
  defaultHeight?: number;
  /**
   * Size to the content and never clip it.
   *
   * A panel is normally allowed to shrink (`min-h-0`) and hides what does
   * not fit (`overflow-hidden`), which is right for a scrolling list in a
   * fixed column. It is wrong for a short form: squeezed by a tall board
   * above it, the panel simply cut its own last row off with nothing to
   * scroll — the Start button, on a phone.
   */
  fit?: boolean;
}

const storageKey = (key: string): string => `vault:panel-h:${key}`;

/** The smallest height the grip will drag a panel to — a header and a row. */
const DRAG_MIN_H = 100;

/** Tailwind's lg breakpoint — resizing only makes sense when every panel is
    on screen at once; below that the layouts flex a single visible pane.
    A grip-less panel passes enabled=false and never subscribes. */
function useLgViewport(enabled: boolean): boolean {
  return useMediaQuery('(min-width: 64rem)', enabled);
}

/** The standard raised surface: every pane in the app sits in one of these. */
export function Panel({ children, className, resizeKey, defaultHeight, fit = false }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [height, setHeight] = useState<number | null>(() => {
    if (!resizeKey) return null;
    const stored = Number(localStorage.getItem(storageKey(resizeKey)));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const lg = useLgViewport(resizeKey !== undefined);

  useEffect(() => {
    if (!resizeKey) return;
    if (height === null) localStorage.removeItem(storageKey(resizeKey));
    else localStorage.setItem(storageKey(resizeKey), String(Math.round(height)));
  }, [resizeKey, height]);

  // The inline style must beat whatever flex/min/max classes the call site
  // uses by default — but only on desktop, where the grip is visible; small
  // screens keep their flex behaviour untouched. Both the dragged height
  // and the default one are EXACT: a panel's size is a property of the
  // layout, never of what happens to be in it.
  //
  // The default used to be only a cap, so that sparse content wasn't padded
  // out to an empty box — but a panel sized to its content resizes itself
  // every time the content changes, and in a fixed-height column that comes
  // out of its neighbours. Stepping through a study, each explorer lookup
  // returned a different number of continuations, the explorer grew or
  // shrank to fit, and the chapters list above it jumped by the same amount
  // on every move. Empty space below the last row costs nothing; a list
  // that moves while you are aiming at it does.
  //
  // Shrinkable in both cases (`0 1 auto`, not `none`), because these panels
  // live in a column whose height is the board's and cannot grow: a panel
  // that refuses to shrink does not push the column out, it is CLIPPED by
  // it, and the column's scrollbar is hidden on desktop — so the explorer's
  // last row simply vanished under the board's bottom edge on any window
  // short enough. Measured at 1549x776: column 640px against 712px of
  // panels, 72px of explorer cut off with nothing to say so.
  //
  // Where the shrinking stops is the call site's `min-h`, which is why the
  // default case no longer states `minHeight: 0` — that zero was quietly
  // cancelling the floor ExplorerPane sets for exactly this reason. A
  // dragged height keeps its own zero (the user's chosen size is allowed to
  // be smaller than the floor) but keeps the drag's own 100px minimum, so a
  // squeezed column cannot make the panel disappear altogether.
  const style =
    !lg || resizeKey === undefined
      ? undefined
      : height !== null
        ? {
            height,
            minHeight: Math.min(height, DRAG_MIN_H),
            maxHeight: height,
            flex: '0 1 auto' as const,
          }
        : defaultHeight !== undefined
          ? { height: defaultHeight, maxHeight: defaultHeight, flex: '0 1 auto' as const }
          : undefined;

  return (
    <Card
      ref={ref}
      style={style}
      // The padding is the Card's now, not this component's: the registry
      // root pads itself vertically and its slots pad themselves across,
      // which is why there is no longer a `flush` prop to turn off. Every
      // panel in the app passed it, so the padding it switched off was
      // never once switched on.
      //
      // `overflow-hidden` likewise comes from the root; `fit` still has to
      // beat it, and does, because the call site's classes are merged last.
      //
      // A panel is a stack of full-bleed bands — a header, an engine
      // block, a tab bar, a scrolling body, a controls row — and every
      // one of them brings its own height and its own rule. The card's
      // top padding had nothing to space and only pushed the first band
      // down; its gap pushed the bands apart and left the rules floating.
      // So `pt-0 gap-0`: bands sit flush, against the card's top edge and
      // against each other, which is where they were before the registry
      // adoption and what the borders were drawn for.
      //
      // The one slot that keeps the card's spacing is the footer, because
      // a footer standing on the panel's floor is a different thing from
      // a band in the stack, and the space above it is what this whole
      // change set out to fix. Stated once here rather than at each call
      // site — that was the mistake being undone. The `>` matters: the
      // two trainers keep their footer INSIDE the scrolling body, where
      // it is spaced by that body's own gap and must not be touched.
      className={cn(
        fit ? 'min-h-max overflow-visible' : 'min-h-0',
        'gap-0 pt-0 [&>[data-slot=card-footer]]:mt-(--card-spacing)',
        className,
      )}
    >
      {children}
      {resizeKey !== undefined && (
        <TitleTip title={t('Drag to resize · double-click to reset')}>
          <div
            onDoubleClick={() => {
              drag.current = null;
              setHeight(null);
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              drag.current = { y: e.clientY, h: ref.current?.offsetHeight ?? 0 };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              // The buttons check drops stray moves delivered after release
              // (synthetic double-clicks emit them), which would otherwise
              // resurrect the height a reset just cleared.
              if (!drag.current || (e.buttons & 1) === 0) return;
              const next = drag.current.h + e.clientY - drag.current.y;
              setHeight(Math.min(Math.max(next, DRAG_MIN_H), window.innerHeight * 0.8));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            className={cn(
              // mt-auto pins the grip to the panel's bottom edge even when a
              // dragged height leaves the panel taller than its content —
              // otherwise it floats mid-panel right under the last row. The
              // negative bottom margin takes back the card's own floor, the
              // way CardFooter's `has-` rule does for a footer: the grip is
              // the panel's edge, so it has to reach it. (No resizable panel
              // carries a footer as well; one that did would zero the card's
              // pb and this would then overshoot by --card-spacing.)
              'border-border/60 hover:bg-accent mt-auto -mb-(--card-spacing) hidden h-2.5 shrink-0 touch-none',
              'cursor-row-resize items-center justify-center border-t transition-colors lg:flex',
            )}
          >
            <div className="bg-border h-[3px] w-8 rounded-full" />
          </div>
        </TitleTip>
      )}
    </Card>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  /** For a header that wraps: `max-[560px]:w-full` sends the actions to
      their own line rather than letting them squeeze the title. */
  actionsClassName?: string;
  className?: string;
}

export function PanelHeader({ title, actions, actionsClassName, className }: PanelHeaderProps) {
  return (
    // No rule under the title: the registry's card header draws none, and
    // neither does its dialog title row, so panels and windows agree (the
    // old look's rule went with the old look).
    // min-h-11 (13 on touch): the height an icon button gives it — 28 on
    // a desktop, 36 on a coarse pointer — plus the room around it, so
    // a header holding only a switch, or nothing, is as tall as its
    // neighbours. Measured before: Chapters 44, Engine 44, Explorer 36 —
    // the title and its rule jumped 4px when the phone's pane tabs
    // switched between them.
    //
    // That floor is ALSO this header's padding — which is why it needs no
    // margin of its own to sit where it always did. Panel turns the card's
    // gap off for its bands (see above), so this is simply one of them.
    //
    // It briefly did carry negative margins to claw the spacing back, and
    // they were wrong in a way worth recording: a `:not(:first-child)`
    // guard is not a guard here, because a `display:none` sibling still
    // counts for `:first-child` while contributing no flex gap. On the
    // board page the engine block is hidden, so the guard passed and the
    // header was dragged 16px above the card's own box — measured at -16,
    // and under `overflow-hidden` that is out of sight, not merely tight.
    <CardHeader
      className={cn(
        'flex min-h-11 pointer-coarse:min-h-13 shrink-0 flex-row items-center justify-between gap-2',
        className,
      )}
    >
      {/* Translated HERE, not at every call site. A panel title is always
          user-facing, so a caller that forgets t() is a bug that renders
          fine in English and ships. Doing it once means it cannot be
          forgotten; a caller that already translated passes Korean, and
          t() on a string with no entry returns it unchanged. */}
      <CardTitle className="min-w-0 flex-1 truncate text-sm">
        {typeof title === 'string' ? t(title) : title}
      </CardTitle>
      {/* The actions take exactly their own width and the title takes the
          rest. They used to `grow` while the title merely `shrink`: on a
          phone the buttons — every one of them shrink-0 — overflowed their
          box and painted over the opening name instead of squeezing it. */}
      {actions ? (
        <CardAction className={cn('col-auto row-auto flex shrink-0 items-center justify-end gap-1 self-center', actionsClassName)}>
          {actions}
        </CardAction>
      ) : null}
    </CardHeader>
  );
}
