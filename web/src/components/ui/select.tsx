import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FieldContext } from '@/components/ui/field';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';

/**
 * shadcn's Select, owned — Radix underneath, which brings the combobox and
 * listbox roles, arrow keys, Home/End, typeahead, collision-aware placement
 * and the aria wiring the hand-rolled one carried itself (lanph3re's
 * standing verdict on bare <select>s: "plain and not aesthetically good";
 * their opened list is OS chrome the theme cannot reach).
 *
 * Two things this file does that the stock one does not:
 *
 *   - `position="popper"` by default. A dropdown belongs UNDER its
 *     trigger; Radix's item-aligned mode opens the list over the trigger
 *     with the chosen item on top of it, which is a native <select>'s
 *     idiom on a Mac and nobody else's.
 *   - The data-driven form every Select in the app is written in:
 *     `<Select value onValueChange groups ariaLabel …>` renders the whole
 *     control (see SelectField below), and on a PHONE that control's open
 *     list is the app's bottom sheet rather than a popover — the popover
 *     was a desktop shape shrunk to fit, anchored to wherever the trigger
 *     happened to sit and its rows a compromise between a menu and a
 *     thumb; a sheet rises where the thumb already is and gives every
 *     option a full-width row. Without `groups` it is the registry's Root.
 */

const PHONE = '(max-width: 39.9375rem)';

/**
 * Radix refuses an empty string as an item value (it is how a Select says
 * "nothing chosen"), and four of this app's lists use '' for their none
 * row. Mapped on the way in and out; nobody outside this file sees it.
 */
const NONE = '__none__';
const toRadix = (v: string): string => (v === '' ? NONE : v);
const fromRadix = (v: string): string => (v === NONE ? '' : v);

export interface SelectOption {
  value: string;
  label: string;
  /**
   * What the CLOSED trigger says, when the full label is more than a
   * narrow trigger can show. An option's label is written for the open
   * list, where there is room to qualify it — "2026-08 · 43 games" tells
   * you which months are worth opening. On the button that is 111px of
   * text in a 60px slot; the qualifier has done its job by the time the
   * list closes.
   */
  short?: string;
}

export interface SelectGroup {
  label?: string | null;
  options: SelectOption[];
}

/**
 * `pointer-coarse:` on both sizes, because a toolbar is a ROW: Button and
 * Input grow their touch targets on a coarse pointer, and a control
 * staying behind is what makes a row look wrong.
 */
const selectTriggerVariants = cva(
  'border-border text-foreground flex min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-md border transition-colors duration-100 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      size: {
        sm: 'h-7 px-2 text-sm pointer-coarse:h-9',
        default: 'h-8 px-2.5 text-sm pointer-coarse:h-9',
      },
      /**
       * Input-like (components/ui/input's sunken backdrop) instead of the raised menu
       * face. Inside a Field, where the control is a form answer beside
       * other form answers, it is sunken; in a toolbar or a settings row —
       * itself a sunken strip, where a sunken trigger would vanish — it is
       * raised.
       */
      look: {
        inset: 'bg-surface-inset focus:border-primary/50',
        raised: 'bg-muted hover:bg-surface-3',
      },
    },
    defaultVariants: { size: 'default', look: 'raised' },
  },
);

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn(className)} {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = 'default',
  look,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(selectTriggerVariants({ size, look }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="text-subtle size-3" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          // overscroll-contain: scrolling the list must not chain to the
          // page behind it.
          'border-border bg-popover text-popover-foreground relative z-50 max-h-(--radix-select-content-available-height) w-max max-w-72 min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-pop duration-100',
          'data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        position={position}
        align={align}
        sideOffset={sideOffset}
        // An open listbox owns its keys outright. The board's arrow
        // shortcuts listen on the window, and preventDefault does not stop
        // a bubble: stepping through options was also stepping through
        // the game. Radix's own handler still runs — it is composed after
        // this one and reads defaultPrevented, not propagation.
        onKeyDown={(e) => e.stopPropagation()}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          data-position={position}
          className="data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn('text-subtle label-caps px-2 pb-0.5 pt-1.5 text-xs', className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // A 28px row is a menu item for a mouse and a misfire for a thumb.
        'relative flex w-full cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-7 text-left text-sm outline-hidden transition-colors duration-100 pointer-coarse:py-2.5',
        'focus:bg-accent data-[state=checked]:text-primary data-[state=checked]:font-medium data-disabled:pointer-events-none data-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText asChild>
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </SelectPrimitive.ItemText>
      <span className="pointer-events-none absolute right-2 flex size-3 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-3" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('bg-border pointer-events-none -mx-1 my-1 h-px', className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn('bg-popover z-10 flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronUp className="size-3.5" />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn('bg-popover z-10 flex cursor-default items-center justify-center py-1', className)}
      {...props}
    >
      <ChevronDown className="size-3.5" />
    </SelectPrimitive.ScrollDownButton>
  );
}

type RootProps = React.ComponentProps<typeof SelectPrimitive.Root>;

export interface SelectProps extends Omit<RootProps, 'children'> {
  children?: React.ReactNode;
  /** The options, grouped; given, the control renders itself (below). */
  groups?: SelectGroup[];
  /** The trigger's accessible name; it renders no label of its own. */
  ariaLabel?: string;
  size?: 'sm' | 'md';
  /** Which trigger edge the popover hugs. */
  align?: 'start' | 'end';
  /** Overrule the form/toolbar look the surroundings decide. */
  inset?: boolean;
  mono?: boolean;
  /**
   * Keep one width whatever is picked.
   *
   * A trigger sized to its current option moves the controls beside it
   * every time the option changes. With this it reserves the width of
   * its WIDEST option instead — not a number: "Last modified" is 73px and
   * "최근 수정순" is 55px, so any width picked for one language clips or
   * floats in the other. The options measure themselves (the invisible
   * stack in the trigger).
   */
  steady?: boolean;
  /**
   * Shown on the TRIGGER before the selection — "Status: Solved" — and
   * never inside the list, where every row would repeat it. A filter menu
   * has to say what it filters even when nothing is chosen.
   */
  prefix?: string;
  /**
   * Phone only: open the list as tall as the sheet it was opened from —
   * for a Select that IS a section of the window it sits in.
   */
  fill?: boolean;
  className?: string;
}

/**
 * The Root — or, given `groups`, the whole control (SelectField).
 */
function Select({ groups, ...props }: SelectProps) {
  if (groups) return <SelectField groups={groups} {...props} />;
  const {
    ariaLabel: _a,
    size: _s,
    align: _al,
    inset: _i,
    mono: _m,
    steady: _st,
    prefix: _p,
    fill: _f,
    className: _c,
    ...root
  } = props;
  return <SelectPrimitive.Root data-slot="select" {...root} />;
}

function SelectField({
  value,
  onValueChange,
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
  open: openProp,
  onOpenChange,
  ...root
}: SelectProps & { groups: SelectGroup[] }) {
  const inField = React.useContext(FieldContext);
  const sunken = inset ?? inField;
  const phone = useMediaQuery(PHONE);
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean): void => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const flat = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  // The prefix rides on the trigger only, and on the invisible sizers too,
  // or `steady` would reserve a width the real label overflows.
  const face = (text: string): string => (prefix ? `${t(prefix)}: ${text}` : text);
  const selected = flat.find((o) => o.value === value) ?? null;
  // The sheet centres its current option once per opening — a months list
  // is longer than a sheet — and only once, so a browse of the list is not
  // yanked back to where it started by a later re-render.
  const centered = React.useRef(false);

  // One grid cell holding every option at once: the invisible ones set the
  // column's width and the visible one is laid over the top. minmax(0,auto)
  // so a trigger with less room than its widest option truncates instead
  // of painting across its own border.
  const labelClass = cn(
    'min-w-0 flex-1 text-left',
    steady ? 'grid grid-cols-[minmax(0,auto)] overflow-hidden' : 'truncate',
  );
  const labelInner = (
    <>
      {steady &&
        flat.map((option) => (
          <span key={option.value} aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
            {face(t(option.short ?? option.label))}
          </span>
        ))}
      <span className={cn('truncate', steady && 'col-start-1 row-start-1')}>
        {selected ? face(t(selected.short ?? selected.label)) : '—'}
      </span>
    </>
  );
  const label = <span className={labelClass}>{labelInner}</span>;

  if (phone) {
    return (
      <>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(
            selectTriggerVariants({ size: size === 'sm' ? 'sm' : 'default', look: sunken ? 'inset' : 'raised' }),
            mono && 'font-mono',
            className,
          )}
        >
          {label}
          <ChevronDown className="text-subtle size-3" />
        </button>
        {open && (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
          >
            <DialogContent size="sm" title={prefix ?? ariaLabel ?? ''} fill={fill}>
              {groups.map((group, gi) => (
                <div key={gi}>
                  {group.label && (
                    <p className="text-subtle label-caps px-2 pb-1 pt-2 text-xs">{t(group.label)}</p>
                  )}
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      ref={(el) => {
                        if (el && option.value === value && !centered.current) {
                          centered.current = true;
                          el.scrollIntoView({ block: 'center' });
                        }
                      }}
                      onClick={() => {
                        setOpen(false);
                        centered.current = false;
                        if (option.value !== value) onValueChange?.(option.value);
                      }}
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
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }

  return (
    <SelectPrimitive.Root
      data-slot="select"
      value={value === undefined ? undefined : toRadix(value)}
      onValueChange={(v) => onValueChange?.(fromRadix(v))}
      open={open}
      onOpenChange={setOpen}
      {...root}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        size={size === 'sm' ? 'sm' : 'default'}
        look={sunken ? 'inset' : 'raised'}
        className={cn(mono && 'font-mono', className)}
      >
        {/* asChild, because Radix's Value drops className and style on
            purpose (it is meant to be unstyled); as the flex item it has
            to carry the truncation and the steady stack itself. */}
        <SelectValue asChild>
          <span className={labelClass}>{labelInner}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent align={align} className={cn(mono && 'font-mono')}>
        {groups.map((group, gi) => (
          <SelectGroup key={gi}>
            {group.label && <SelectLabel>{t(group.label)}</SelectLabel>}
            {group.options.map((option) => (
              <SelectItem key={option.value} value={toRadix(option.value)}>
                {t(option.label)}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </SelectPrimitive.Root>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
};
