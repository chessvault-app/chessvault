import { Check, ChevronDown } from 'lucide-react';
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/media';
import { useDismiss, useFloating } from '@/lib/floating';
import { useCloseRequest } from './dialogFocus';
import { FieldContext } from './Field';
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
/** How long a run of letters counts as one search. */
const TYPEAHEAD_MS = 700;

const triggerSizes = {
  sm: 'h-7 px-2 text-sm pointer-coarse:h-9',
  md: 'h-8 px-2.5 text-sm pointer-coarse:h-9',
} as const;

export function Select({
  value,
  onChange,
  groups,
  ariaLabel,
  size = 'md',
  align = 'start',
  inset,
  mono = false,
  steady = false,
  prefix,
  fill = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: SelectGroup[];
  ariaLabel: string;
  size?: keyof typeof triggerSizes;
  /** Which trigger edge the popover hugs. */
  align?: 'start' | 'end';
  /**
   * Input-like trigger (ui/Input's sunken backdrop) instead of the raised
   * menu face. Unset, it follows the surroundings: on inside a Field,
   * where the control is a form answer beside other form answers, off in
   * a toolbar or a SettingRow — which is itself a sunken strip, so a
   * sunken trigger there would vanish into it. Pass it to overrule either.
   */
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
  /**
   * Phone only: open the list as tall as the sheet it was opened from,
   * instead of as tall as its own options — Sheet's `fill`.
   *
   * For a Select that IS a section of the window it sits in: the map's
   * "check coverage against" offers ten rating bands behind one trigger,
   * and a list that rises to a third of the height of the window it came
   * out of reads as that window having been replaced by a smaller one.
   * At its parent's height it reads as the same window, turned to the
   * page that answers this question — and Sheet gives it the chevron
   * back, since a sheet that covers its parent owes one.
   *
   * Off by default: a Select in a toolbar or a settings row has no sheet
   * behind it to match, and `fill` measures nothing there anyway.
   */
  fill?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /**
   * The listbox's id, and a stem for its options'.
   *
   * Focus never leaves the trigger while the list is open — arrowing
   * moves a highlight, not the caret — so without ids and
   * aria-activedescendant there is nothing for a screen reader to
   * announce, and stepping through the options was silent. The highlight
   * was a colour and nothing else.
   */
  const listId = useId();
  const optionId = (i: number): string => `${listId}-o${i}`;
  const inField = useContext(FieldContext);
  const sunken = inset ?? inField;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Where the current touch started, to tell a tap from a list scroll.
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The Sheet/Modal breakpoint: below it the open list is a bottom sheet,
  // not a popover, so everything anchored — the rect, the dismiss-on-tap
  // and dismiss-on-scroll listeners, the touch backdrop — is popover-only.
  const phone = useMediaQuery('(max-width: 39.9375rem)');
  // The sheet centres its current option once per opening — a months list
  // is longer than a sheet — and only once, so a browse of the list is not
  // yanked back to where it started by a later re-render.
  const centered = useRef(false);

  /**
   * Where the list goes: under the trigger unless under it has no room.
   *
   * It used to flip up whenever the trigger sat below mid-screen, which
   * is a guess about room rather than a measurement of it. A Select
   * inside a centred window is past that line the moment it is the
   * second field — so the map's "check coverage against" opened its
   * database list UPWARDS, over the very rows it belongs under, with
   * half the window free underneath. A list that covers the thing it
   * came from reads as a replacement, not as an answer.
   *
   * lib/floating now decides it from the list's OWN measured height
   * rather than from a 160px stand-in for one, and ties still go down,
   * where a dropdown is expected. It also clamps horizontally, which
   * nothing here did: `left: rect.left` on a trigger near the right edge
   * put a 288px list straight off the side of the window.
   */
  const popover = useFloating(open && !phone ? rect : null, {
    side: 'bottom',
    align,
    gap: 4,
    margin: 16,
  });

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
    setRect(trigger.current?.getBoundingClientRect() ?? null);
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

  // A press outside puts the list away — mousedown and touchstart both,
  // and the tap's synthesized click swallowed, which lib/floating now
  // owns for every popover in the app rather than each one remembering.
  //
  // Scrolling the LIST is fine (a long options list scrolls itself, and
  // useDismiss ignores anything inside the layer). A scroll of the page
  // behind must NOT dismiss either — that is what closed a short,
  // non-scrollable dropdown on a touch drag. Instead the list follows
  // its trigger, and only gives up when the trigger has left the window.
  useDismiss(open && !phone, () => setOpen(false), [trigger, list], {
    onScroll: () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > window.innerHeight) setOpen(false);
      else setRect(r);
    },
  });

  // A resize moves everything at once and re-measuring mid-drag would
  // chase it; the list is cheap to reopen.
  useEffect(() => {
    if (!open || phone) return;
    const close = (): void => setOpen(false);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
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
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      jumpTo(e.key);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, flat.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = flat[active];
      if (opt) pick(opt.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  /**
   * Typeahead: the last listbox convention this was missing.
   *
   * Letters typed in quick succession are one search — "ki" finds
   * Kiwen-suwi past Kosikov — and a pause starts a new one. Repeating
   * the SAME letter cycles the options beginning with it instead, which
   * is what a list of eleven piece sets is usually being asked for.
   *
   * It moves the highlight rather than the value: nothing is chosen
   * until Enter, the way arrowing already works here.
   */
  const typed = useRef({ buffer: '', at: 0 });
  const jumpTo = (char: string): void => {
    const now = Date.now();
    const fresh = now - typed.current.at > TYPEAHEAD_MS;
    const repeat = !fresh && typed.current.buffer === char;
    const buffer = fresh || repeat ? char : typed.current.buffer + char;
    typed.current = { buffer, at: now };

    const query = buffer.toLowerCase();
    const labelOf = (o: SelectOption): string => t(o.label).toLowerCase();
    // From the one after the current, so a repeated letter walks the
    // matches instead of sticking to the first.
    const from = repeat ? active + 1 : active;
    const order = flat.map((_, i) => (from + i) % flat.length);
    const hit = order.find((i) => labelOf(flat[i]!).startsWith(query));
    if (hit !== undefined) setActive(hit);
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
        aria-controls={open && !phone ? listId : undefined}
        aria-activedescendant={open && !phone ? optionId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className={cn(
          'border-border text-foreground flex min-w-0 shrink items-center gap-1 rounded-md border',
          'transition-colors duration-100',
          sunken ? 'bg-surface-inset focus:border-primary/50' : 'bg-muted hover:bg-surface-3',
          triggerSizes[size],
          mono && 'font-mono',
          className,
        )}
      >
        {/* One grid cell holding every option at once. The invisible ones
            set the column's width — the widest of them wins — and the
            visible one is laid over the top of it. That is what makes the
            trigger keep one width without a number being chosen for it.

            minmax(0,auto), because a bare `grid` column never shrinks past
            its widest option even when the trigger has less room than that:
            in the settings row for artificial latency the trigger got 74px
            for 86px of content, and "0.5 seconds" was painted straight
            across the button's own right border and out over the chevron.
            A 0 floor lets the track take whatever width the trigger really
            has, so the label truncates the way a too-narrow label should.
            overflow-hidden clips the invisible sizers with it — they are
            whitespace-nowrap and would otherwise still spill. */}
        <span
          className={cn(
            'min-w-0 flex-1 text-left',
            steady ? 'grid grid-cols-[minmax(0,auto)] overflow-hidden' : 'truncate',
          )}
        >
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
          ref={(node) => {
            list.current = node;
            popover.ref(node);
          }}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            ...popover.style,
            minWidth: rect.width,
            // The floor is the old one: below about 140px a list is not
            // worth opening as a list, and it is allowed to overhang.
            maxHeight: Math.max(140, popover.placement?.room ?? 0),
          }}
          className={cn(
            // overscroll-contain: scrolling the list must not chain to the
            // page — a page scroll is what the dismiss handler listens for,
            // so without this a touch-scroll of the list closed the dropdown.
            'border-border bg-card z-50 w-max max-w-72 overflow-y-auto overscroll-contain rounded-lg border p-1',
            'shadow-pop',
          )}
        >
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="text-subtle px-2 pb-0.5 pt-1.5 text-xs label-caps">
                  {t(group.label)}
                </p>
              )}
              {group.options.map((option) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={option.value}
                    id={optionId(i)}
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
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      // A 28px row is a menu item for a mouse and a
                      // misfire for a thumb.
                      'pointer-coarse:py-2.5',
                      'transition-colors duration-100',
                      i === active && 'bg-muted',
                      option.value === value ? 'text-primary font-medium' : 'text-foreground',
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
        <Sheet label={prefix ?? ariaLabel} fill={fill} onClose={() => setOpen(false)}>
          {groups.map((group, gi) => (
            <div key={gi}>
              {group.label && (
                <p className="text-subtle px-2 pb-1 pt-2 text-xs label-caps">
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
                    'flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-base',
                    'hover:bg-accent transition-colors duration-100',
                    option.value === value ? 'text-primary font-medium' : 'text-foreground',
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
