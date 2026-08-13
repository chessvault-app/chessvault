import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { t } from '@/lib/i18n';

/**
 * A themed replacement for `<select>`: native controls styled fine, but
 * their *opened* list is OS chrome — the one popup in the app the theme
 * could not reach (and lanph3re's standing verdict on bare selects: "plain and
 * not aesthetically good"). The trigger reads like an input; the list is
 * a fixed-position popover, so it escapes overflow-hidden panels.
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

const triggerSizes = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-xs',
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

  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const selected = flat.find((o) => o.value === value) ?? null;

  const show = (): void => {
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

  // The popover is position-fixed off a measured rect: a scroll of the PAGE
  // invalidates it, so dismiss — but scrolling INSIDE the list (a long
  // options list scrolls) must not close it. A click elsewhere dismisses too.
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

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
        aria-haspopup="listbox"
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
        <span className="min-w-0 flex-1 truncate text-left">
          {selected ? t(selected.short ?? selected.label) : '—'}
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
          fragment, so it is a sibling of the list and paints below it. */}
      {open && rect && createPortal(
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
      {open && rect && createPortal(
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
                <p className="text-subtle px-2 pb-0.5 pt-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
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
    </>
  );
}
