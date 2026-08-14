import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { useCloseRequest } from './dialogFocus';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * A themed replacement for `<select>`: native controls styled fine, but
 * their *opened* list is OS chrome — the one popup in the app the theme
 * could not reach (and lanph3re's standing verdict on bare selects: "plain and
 * not aesthetically good"). The trigger reads like an input; the list is
 * a fixed-position popover, so it escapes overflow-hidden panels.
 *
 * On a PHONE the open list is a bottom sheet instead — the same Sheet as
 * every other phone window, scrim, drag and all. The popover was a
 * desktop shape shrunk to fit: anchored to wherever the trigger happened
 * to sit, capped to the space left under it, its rows a compromise
 * between a menu and a thumb. A sheet rises where the thumb already is
 * and gives every option a full-width row.
 */

export interface SelectOption {
  value: string;
  label: string;
  /**
   * What the CLOSED trigger says, when the full label is more than a
   * narrow trigger can show.
   *
   * An option's label is written for the open list, where there is room
   * to qualify it — "2026-08 · 43 games" tells you which months are worth
   * opening. On the button that is 111px of text in a 60px slot, and what
   * survived the ellipsis was "2026-08 · 4…". The qualifier is the part
   * that has done its job by the time the list closes.
   */
  short?: string;
}

export interface SelectGroup {
  label?: string;
  options: SelectOption[];
}

/**
 * `pointer-coarse:` on both, because a toolbar is a ROW.
 *
 * Button and Input have grown their touch targets on a coarse pointer for
 * a long time and this had not, so on an iPad the shelf toolbar's
 * bookmark button stood 36px beside a 28px sort menu — the same row, two
 * heights. A touch target that grows is right; one control staying behind
 * is what makes it look wrong.
 */
const triggerSizes = {
  sm: 'h-7 px-2 text-xs pointer-coarse:h-9',
  md: 'h-8 px-2.5 text-xs pointer-coarse:h-9',
} as const;

export function Select({
  value,
  onChange,
  groups,
  ariaLabel,
  size = 'md',
  align = 'start',
  inset = false,
  mono = false,
  steady = false,
  prefix,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: SelectGroup[];
  ariaLabel: string;
  size?: keyof typeof triggerSizes;
  /** Which trigger edge the popover hugs. */
  align?: 'start' | 'end';
  /** Input-like trigger for form contexts (matches ui/Input's backdrop). */
  inset?: boolean;
  mono?: boolean;
  /**
   * Keep one width whatever is picked.
   *
   * A trigger sized to its current option moves the controls beside it
   * every time the option changes — the shelf's sort menu shifted its
   * layout switch and Create button sideways on each pick. With this it
   * reserves the width of its WIDEST option instead, so nothing moves.
   *
   * Not a number: "Last modified" is 73px and "최근 수정순" is 55px, so any
   * width picked for one language clips or floats in the other. The
   * options measure themselves — see the stack in the trigger.
   */
  steady?: boolean;
  /**
   * Shown on the TRIGGER before the selection — "Status: Solved" — and
   * never inside the list, where every row would repeat it.
   *
   * A filter menu has to say what it filters even when nothing is
   * chosen: a bare "All" at the top of a list is not a control anyone
   * can identify without pressing it.
   */
  prefix?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Where the current touch started, to tell a tap from a list scroll.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Open upward when the trigger sits below mid-screen, so a long list has
  // room instead of being crushed into the gap under a low field.
  const [dropUp, setDropUp] = useState(false);
  // The Sheet/Modal breakpoint: below it the open list is a bottom sheet,
  // not a popover, so everything anchored — the rect, the dismiss-on-tap
  // and dismiss-on-scroll listeners, the touch backdrop — is popover-only.
  const phone = useMediaQuery('(max-width: 39.9375rem)');
  // The sheet centres its current option once per opening — a months list
  // is longer than a sheet — and only once, so a browse of the list is not
  // yanked back to where it started by a later re-render.
  const centered = useRef(false);

  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  // The prefix rides on the trigger only, and on the invisible sizers too,
  // or `steady` would reserve a width the real label overflows.
  const face = (text: string): string => (prefix ? `${t(prefix)}: ${text}` : text);
  const selected = flat.find((o) => o.value === value) ?? null;

  const show = (): void => {
    if (phone) {
      centered.current = false;
      setOpen(true);
      return;
    }
    const r = trigger.current?.getBoundingClientRect() ?? null;
    setRect(r);
    setDropUp(r ? r.bottom > window.innerHeight * 0.55 : false);
    setActive(Math.max(0, flat.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const pick = (v: string): void => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  // The POPOVER's close request — an Android tablet's Back gesture must
  // put an open list away, and the trigger's own Escape handling only
  // hears a keyboard while the trigger has focus. In sheet mode the
  // Sheet brings its own.
  useCloseRequest(() => setOpen(false), open && !phone);

  // The popover is position-fixed off a measured rect: a scroll of the PAGE
  // invalidates it, so dismiss — but scrolling INSIDE the list (a long
  // options list scrolls) must not close it. A click elsewhere dismisses too.
  useEffect(() => {
    // The sheet needs none of this: its scrim owns the outside tap, and a
    // sheet is not anchored to anything a scroll could carry away.
    if (!open || phone) return;
    const close = (): void => setOpen(false);
    // Both mousedown AND touchstart: iOS never synthesizes mouse events for
    // document-level listeners when the tap lands on dead space, so without
    // the touch listener a tap outside could not close the list on a phone.
    const onDown = (e: MouseEvent | TouchEvent): void => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) {
        close();
        // A dismissing TAP must only dismiss — swallow its synthesized
        // click so it can't also press whatever it landed on.
        if (e.type === 'touchstart') suppressNextClick();
      }
    };
    // Scrolling the LIST is fine (ignore). A scroll of the page behind must
    // NOT dismiss — that's what closed a short, non-scrollable dropdown on a
    // touch drag. Instead follow the trigger; only close if it scrolls away.
    const onScroll = (e: Event): void => {
      if (list.current?.contains(e.target as Node)) return;
      const r = trigger.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) {
        close();
        return;
      }
      setRect(r);
      setDropUp(r.bottom > window.innerHeight * 0.55);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, phone]);

  /**
   * The gesture stops here, whatever the browser thinks.
   *
   * overscroll-behavior:contain was supposed to be enough and is not: on a
   * phone, dragging this list still scrolled the PAGE behind the sheet it
   * was opened from. So the list judges its own edges — nothing to scroll,
   * or nothing left in the direction being pulled, and the move is
   * cancelled outright rather than handed upwards.
   *
   * Native and non-passive, because React attaches touchmove passively at
   * the root and a passive listener cannot cancel anything.
   */
  useEffect(() => {
    const el = list.current;
    if (!open || !el) return;
    let last = 0;
    const start = (e: TouchEvent): void => {
      last = e.touches[0]?.clientY ?? 0;
    };
    const move = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (y === undefined) return;
      const dy = y - last;
      last = y;
      const room = el.scrollHeight - el.clientHeight;
      const spent = room <= 0 || (dy > 0 && el.scrollTop <= 0) || (dy < 0 && el.scrollTop >= room);
      if (spent && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        show();
      }
      return;
    }
    // An open listbox owns its keys outright. The board's arrow shortcuts
    // listen on the window, and preventDefault does not stop a bubble:
    // stepping through options was also stepping through the game.
    e.stopPropagation();
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = flat[active];
      if (opt) pick(opt.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  let index = -1;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup={phone ? 'dialog' : 'listbox'}
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={cn(
          'border-line text-fg flex min-w-0 shrink items-center gap-1 rounded-md border',
          'transition-colors duration-100',
          inset ? 'bg-surface-inset focus:border-primary/50' : 'bg-surface-2 hover:bg-surface-3',
          triggerSizes[size],
          mono && 'font-mono',
          className,
        )}
      >
        {/* One grid cell holding every option at once. The invisible ones
            set the column's width — the widest of them wins — and the
            visible one is laid over the top of it. That is what makes the
            trigger keep one width without a number being chosen for it. */}
        <span className={cn('min-w-0 flex-1 text-left', steady ? 'grid' : 'truncate')}>
          {steady &&
            flat.map((option) => (
              <span
                key={option.value}
                aria-hidden
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
              >
                {face(t(option.short ?? option.label))}
              </span>
            ))}
          <span className={cn('truncate', steady && 'col-start-1 row-start-1')}>
            {selected ? face(t(selected.short ?? selected.label)) : '—'}
          </span>
        </span>
        <ChevronDown className="text-subtle size-3 shrink-0" />
      </button>

      {/* A touch-only backdrop, invisible and inert, under the list and
          over everything else.

          An open dropdown is modal in practice on a phone, and without
          this every touch that landed BESIDE the list went to whatever
          was under it — a sheet, which read the drag as a push and slid
          away with its own dropdown still open on top of it. touch-none,
          so a drag here moves nothing at all; the tap that dismisses is
          the document listener above, which already treats anything
          outside the list as a dismissal. Its own portal rather than a
          fragment, so it is a sibling of the list and paints below it.
          Coarse-pointer DESKTOPS and tablets only in practice: a phone
          gets the sheet below, whose scrim does this job properly. */}
      {open && !phone && rect && createPortal(
        <div aria-hidden className="pointer-fine:hidden fixed inset-0 z-50 touch-none" />,
        document.body,
      )}

      {/* On the BODY, not where it was written. Two reasons, both of which
          bit: this list is position-fixed off a measured rect, and `fixed`
          resolves against any ancestor that has a transform — a bottom
          sheet has one the moment it is dragged, so the list would ride
          the sheet instead of staying put. And a touch inside it BUBBLES
          to whatever it was written inside: dragging this list inside a
          sheet dragged the sheet. A floating layer has no business living
          inside the thing it floats over. Dismissal is unaffected — it
          asks `list.contains(target)`, which does not care where the node
          sits. */}
      {open && !phone && rect && createPortal(
        <div
          ref={list}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            ...(dropUp
              ? { bottom: window.innerHeight - rect.top + 4 }
              : { top: rect.bottom + 4 }),
            ...(align === 'end'
              ? { right: window.innerWidth - rect.right }
              : { left: rect.left }),
            minWidth: rect.width,
            maxHeight: dropUp
              ? Math.max(140, rect.top - 16)
              : Math.max(140, window.innerHeight - rect.bottom - 16),
          }}
          className={cn(
            // overscroll-contain: scrolling the list must not chain to the
            // page — a page scroll is what the dismiss handler listens for,
            // so without this a touch-scroll of the list closed the dropdown.
            'border-line bg-surface z-50 w-max max-w-72 overflow-y-auto overscroll-contain rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
        >
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="text-subtle px-2 pb-0.5 pt-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                  {t(group.label)}
                </p>
              )}
              {group.options.map((option) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    // Hover-tracking only where hover exists: iOS treats a
                    // first tap on an element whose mouseenter MUTATES
                    // content as hover alone (sticky-hover heuristic), which
                    // demanded a second tap to actually pick an option.
                    onMouseEnter={() => {
                      if (window.matchMedia('(hover: hover)').matches) setActive(i);
                    }}
                    onClick={() => pick(option.value)}
                    // Touch picks natively on touchend — iOS click synthesis
                    // has proven too fickle to carry the ONE action this
                    // control exists for. A moved finger is a scroll, not a
                    // pick; preventDefault stops the synthesized click from
                    // double-firing after we picked.
                    onTouchStart={(e) => {
                      const t = e.touches[0]!;
                      touchStart.current = { x: t.clientX, y: t.clientY };
                    }}
                    onTouchEnd={(e) => {
                      const start = touchStart.current;
                      touchStart.current = null;
                      const t = e.changedTouches[0];
                      if (!start || !t) return;
                      if (Math.abs(t.clientX - start.x) < 12 && Math.abs(t.clientY - start.y) < 12) {
                        e.preventDefault();
                        pick(option.value);
                      }
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                      // A 28px row is a menu item for a mouse and a
                      // misfire for a thumb.
                      'pointer-coarse:py-2.5',
                      'transition-colors duration-100',
                      i === active && 'bg-surface-2',
                      option.value === value ? 'text-primary font-medium' : 'text-fg',
                      mono && 'font-mono',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
                    {option.value === value && <Check className="size-3 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body,
      )}

      {/* The phone's version of the open list: the same bottom sheet as
          every other phone window, titled with what the trigger says it
          is. Sheet brings the scrim, the drag, Escape, the focus trap and
          the scrolling, so the anchored machinery above — rect, backdrop,
          dismiss-on-scroll — has no phone duties at all. */}
      {open && phone && (
        <Sheet label={prefix ?? ariaLabel} onClose={() => setOpen(false)}>
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="text-subtle px-2 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                  {t(group.label)}
                </p>
              )}
              {group.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  // The current option starts on screen — a months list is
                  // longer than a sheet, and a picker that opens on rows
                  // far from the one that is picked reads as a fresh list.
                  ref={(el) => {
                    if (el && option.value === value && !centered.current) {
                      centered.current = true;
                      el.scrollIntoView({ block: 'center' });
                    }
                  }}
                  onClick={() => pick(option.value)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm',
                    'hover:bg-surface-2 transition-colors duration-100',
                    option.value === value ? 'text-primary font-medium' : 'text-fg',
                    mono && 'font-mono',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
                  {option.value === value && <Check className="size-4 shrink-0" />}
                </button>
              ))}
            </div>
          ))}
        </Sheet>
      )}
    </>
  );
}
