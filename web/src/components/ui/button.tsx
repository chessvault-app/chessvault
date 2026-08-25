import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Button as ButtonPrimitive } from '@base-ui/react/button';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Button (nova), owned. The faces, sizes and focus ring are the
 * registry's; what this app adds:
 *
 *   - `destructive-solid`, the filled red for a confirmation's own confirm
 *     button (the registry's `destructive` is the tint, for the triggers
 *     that merely open the question);
 *   - `active`, the lit state of a toggle-like toolbar button — the
 *     registry's expanded look, set as `data-active` too;
 *   - bigger hit areas on coarse pointers (`pointer-coarse:`): 28px icon
 *     buttons are fine under a mouse and hostile under a thumb. Where
 *     that widens a size's padding it widens the icon side too, or the
 *     registry's trim below would grow with it — `sm` at `px-3` against
 *     an untouched `pl-1.5` was a 6px lean where the registry draws 4;
 *   - `title` as a Tooltip, and as the accessible name of an icon-only
 *     button; `type="button"` unless told otherwise;
 *   - `not-[.w-full]` on the registry's icon-side padding trim. That trim
 *     is optical balance for a button that shrinks to its contents: the
 *     button gets narrower, nothing inside it moves. A button told to
 *     fill its box instead centres its contents in what the padding
 *     leaves, so the same trim pushes them off-centre by half of it —
 *     measured 2px on the repertoire Start button, and 1px on the nine
 *     `default`-size ones in the dialogs and the review rows.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        'destructive-solid':
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:not-[.w-full]:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pl-2 pointer-coarse:h-9',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:not-[.w-full]:pr-1.5 has-data-[icon=inline-start]:not-[.w-full]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:not-[.w-full]:pr-1.5 has-data-[icon=inline-start]:not-[.w-full]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5 pointer-coarse:h-9 pointer-coarse:px-3 has-data-[icon=inline-end]:not-[.w-full]:pointer-coarse:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pointer-coarse:pl-2",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:not-[.w-full]:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pl-2',
        icon: 'size-8 pointer-coarse:size-11',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg pointer-coarse:size-9',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps extends ButtonPrimitive.Props, VariantProps<typeof buttonVariants> {
  /**
   * The lit state of a toggle-like button in a toolbar — the tool that is
   * selected, the panel that is open.
   *
   * (A link wearing the button's look renders the anchor itself, Base UI's
   * way: `<Button render={<a href=…/>} nativeButton={false}>…</Button>`. A
   * control that goes OUT of the app is an anchor and nothing else.)
   */
  active?: boolean;
  title?: string;
}

// Does the button say anything in text? A visible label is already the
// accessible name — and must stay it, or "click Cancel" stops working for
// voice control. Only icon-only buttons need naming by other means.
export function hasTextContent(children: React.ReactNode): boolean {
  if (typeof children === 'string') return children.trim().length > 0;
  if (Array.isArray(children)) return children.some(hasTextContent);
  return false;
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  active = false,
  title,
  ...props
}: ButtonProps) {
  const button = (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // An icon-only button's title doubles as its accessible name unless
      // one was given: the tooltip below is what a pointer sees, and the
      // name is what a screen reader and voice control get. (Base UI's
      // Button already defaults `type="button"`, so a bare one inside a
      // form does not submit it.)
      aria-label={props['aria-label'] ?? (hasTextContent(props.children) ? undefined : title)}
      data-active={active || undefined}
      className={cn(buttonVariants({ variant, size }), active && 'bg-accent text-accent-foreground', className)}
      {...props}
    />
  );
  // `title` is a tooltip, the shadcn way: the Tooltip on hover and on
  // keyboard focus, never on touch — instead of the browser's bubble. The
  // attribute itself is not set: two tips for one control would be the
  // worst of both.
  if (title === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

export { Button, buttonVariants };
