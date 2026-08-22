import * as React from 'react';
import { Select as SelectPrimitive } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FieldContext } from '@/components/ui/field';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';

/**
 * shadcn's Select (nova), owned — Radix underneath: combobox and listbox
 * roles, arrow keys, Home/End, typeahead, collision-aware placement. The
 * registry's faces, with two additions of this app's:
 *
 *   - `position="popper"` by default: a dropdown belongs UNDER its
 *     trigger; Radix's item-aligned mode opens the list over it.
 *   - The data-driven form every Select in the app is written in:
 *     `<Select value onValueChange groups ariaLabel …>` renders the whole
 *     control (SelectField below), and on a PHONE its open list is the
 *     app's bottom sheet rather than a popover — a sheet rises where the
 *     thumb already is and gives every option a full-width row. Without
 *     `groups` it is the registry's Root.
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
  /** What the CLOSED trigger says, when the full label is more than a
      narrow trigger can show. */
  short?: string;
  /** A colour swatch before the label — for an option whose name says
      least about it (a colour scheme). `ring` outlines it, so a dot the
      colour of the list can still be seen. */
  dot?: { color: string; ring?: string };
}

/** The swatch an option's `dot` asks for, at text size. */
function OptionDot({ dot }: { dot: NonNullable<SelectOption['dot']> }) {
  return (
    <span
      aria-hidden
      className="size-3 shrink-0 rounded-full"
      style={{ background: dot.color, outline: dot.ring ? `2px solid ${dot.ring}` : undefined }}
    />
  );
}

export interface SelectGroup {
  label?: string | null;
  options: SelectOption[];
}

/**
 * The registry's trigger, with `pointer-coarse:h-9` on both sizes — a
 * toolbar is a ROW, and Button and Input grow there too.
 */
const selectTriggerVariants = cva(
  "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        sm: 'h-7 rounded-[min(var(--radius-md),10px)] pointer-coarse:h-9',
        default: 'h-8 pointer-coarse:h-9',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" className={cn('scroll-my-1 p-1', className)} {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(selectTriggerVariants({ size }), className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  onClick,
  onPointerDown,
  children,
  position = 'popper',
  align = 'start',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        // A press inside this layer must not reach what the layer was written
        // inside: React bubbles through portals, and a card or a row that
        // opens on click would open under a menu item or a dialog's button.
        onClick={(e) => {
          onClick?.(e);
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          onPointerDown?.(e);
          e.stopPropagation();
        }}
        data-align-trigger={position === 'item-aligned'}
        className={cn(
          'bg-popover text-popover-foreground ring-foreground/10 relative z-50 max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg shadow-md ring-1 duration-100',
          'data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
          className,
        )}
        position={position}
        align={align}
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
      className={cn('text-muted-foreground px-1.5 py-1 text-xs', className)}
      {...props}
    />
  );
}

function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // pointer-coarse:py-2.5 — a 28px row is a menu item for a mouse
        // and a misfire for a thumb.
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 pointer-coarse:py-2.5 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText asChild>
        <span className="min-w-0 flex-1 truncate">{children}</span>
      </SelectPrimitive.ItemText>
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
      className={cn("bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <ChevronUpIcon />
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
      className={cn("bg-popover z-10 flex cursor-default items-center justify-center py-1 [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      <ChevronDownIcon />
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
  /** Kept for the form/toolbar distinction the callers make; the registry's trigger is one face. */
  inset?: boolean;
  mono?: boolean;
  /**
   * Keep one width whatever is picked: reserve the width of the WIDEST
   * option (the options measure themselves — the invisible stack in the
   * trigger), so a toolbar does not shift on every pick.
   */
  steady?: boolean;
  /** Shown on the TRIGGER before the selection — "Status: Solved" — never inside the list. */
  prefix?: string;
  /** Phone only: open the list as tall as the sheet it was opened from. */
  fill?: boolean;
  className?: string;
}

/** The Root — or, given `groups`, the whole control (SelectField). */
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
  inset: _inset,
  mono = false,
  steady = false,
  prefix,
  fill = false,
  className,
  open: openProp,
  onOpenChange,
  ...root
}: SelectProps & { groups: SelectGroup[] }) {
  // Read for parity with Field (the context still marks a form control),
  // even though the registry's trigger wears one face in both places.
  React.useContext(FieldContext);
  const phone = useMediaQuery(PHONE);
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next: boolean): void => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const flat = React.useMemo(() => groups.flatMap((g) => g.options), [groups]);
  const face = (text: string): string => (prefix ? `${t(prefix)}: ${text}` : text);
  const selected = flat.find((o) => o.value === value) ?? null;
  const centered = React.useRef(false);

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
      <span className={cn('flex min-w-0 items-center gap-2', steady && 'col-start-1 row-start-1')}>
        {selected?.dot && <OptionDot dot={selected.dot} />}
        <span className="truncate">{selected ? face(t(selected.short ?? selected.label)) : '—'}</span>
      </span>
    </>
  );

  if (phone) {
    return (
      <>
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(selectTriggerVariants({ size: size === 'sm' ? 'sm' : 'default' }), mono && 'font-mono', className)}
        >
          <span className={labelClass}>{labelInner}</span>
          <ChevronDownIcon className="text-muted-foreground size-4" />
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
                    <p className="text-muted-foreground px-2 pb-1 pt-2 text-xs">{t(group.label)}</p>
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
                        option.value === value ? 'font-medium' : 'text-foreground',
                        mono && 'font-mono',
                      )}
                    >
                      {option.dot && <OptionDot dot={option.dot} />}
                      <span className="min-w-0 flex-1 truncate">{t(option.label)}</span>
                      {option.value === value && <CheckIcon className="size-4 shrink-0" />}
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
        className={cn('w-auto min-w-0 shrink', mono && 'font-mono', className)}
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
                {option.dot && <OptionDot dot={option.dot} />}
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
