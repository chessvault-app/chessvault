import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Button, owned.
 *
 * The variants are the registry's names with this app's looks behind them,
 * and the sizes are this app's measured heights under shadcn-shaped names
 * — a `sm` button is 28px because a `sm` Input and a `sm` Select are, and a
 * toolbar is a row (see ui/Input for the scale). Two things the stock file
 * does differently, on purpose:
 *
 *   - No `outline-none` and no ring utilities. Keyboard focus is the global
 *     `:focus-visible` outline in index.css, the same one every control in
 *     the app wears; a ring that only shadcn components drew would be two
 *     focus styles on one page.
 *   - Coarse pointers get bigger hit areas (`pointer-coarse:`): 28px icon
 *     buttons are fine under a mouse and hostile under a thumb.
 *
 * nowrap: Korean has no spaces to break at, so a narrow button split
 * 추가 down the middle into two stacked syllables.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium ' +
    'transition-[background-color,color,border-color,box-shadow,transform] duration-150 ' +
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 ' +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-control',
        secondary: 'bg-muted text-foreground hover:bg-surface-3 border border-border',
        outline: 'border border-border bg-background hover:bg-accent hover:text-foreground',
        ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        // Tinted, as in the nova style: for the triggers that merely OPEN a
        // destructive question.
        destructive: 'bg-destructive/12 text-destructive hover:bg-destructive/20 border border-destructive/25',
        // Filled, for a confirmation's own confirm button — the one press in
        // the app that cannot be taken back should not look like the tinted
        // trigger that asked. --destructive-foreground is what reads on a
        // filled destructive panel in both themes.
        'destructive-solid':
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 border border-destructive',
      },
      size: {
        default: 'h-9 px-3.5 text-base gap-2 rounded-lg',
        sm: 'h-7 px-2.5 text-sm gap-1.5 rounded-md pointer-coarse:h-9 pointer-coarse:px-3',
        icon: 'size-9 rounded-lg pointer-coarse:size-11',
        'icon-sm': 'size-7 rounded-md pointer-coarse:size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<'button'>,
    VariantProps<typeof buttonVariants> {
  /**
   * Render the child element instead of a <button>, with the button's
   * classes and props merged onto it — how a link is given the button's
   * look without copying its class string:
   *
   *   <Button asChild variant="ghost"><a href=…>…</a></Button>
   *
   * A control that goes OUT of the app is an anchor and nothing else: a
   * button with an onClick that navigates loses the middle click, the
   * context menu and the address the browser shows on hover.
   */
  asChild?: boolean;
  /**
   * The lit state of a toggle-like button in a toolbar — the tool that is
   * selected, the panel that is open. A tint of the accent, set as
   * `data-active` for anything that wants to style against it.
   */
  active?: boolean;
}

// Does the button say anything in text? A visible label is already the
// accessible name — and must stay it, or "click Cancel" stops working for
// voice control. Only icon-only buttons need naming by other means.
function hasTextContent(children: React.ReactNode): boolean {
  if (typeof children === 'string') return children.trim().length > 0;
  if (Array.isArray(children)) return children.some(hasTextContent);
  return false;
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  active = false,
  type = 'button',
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // `type="button"` unless told otherwise: a bare <button> inside a
      // form submits it, and almost nothing here is a submit.
      {...(asChild ? {} : { type })}
      // An icon-only button's title doubles as its accessible name unless
      // one was given. These buttons were named by `title` alone, and the
      // styled-tooltip system REMOVES title while its tip is showing — so
      // the name used to vanish exactly when the control was pointed at.
      // aria-label stays put.
      aria-label={props['aria-label'] ?? (hasTextContent(props.children) ? undefined : props.title)}
      data-active={active || undefined}
      className={cn(
        buttonVariants({ variant, size }),
        active && 'bg-primary-soft text-primary border-primary/30',
        className,
      )}
      {...props}
    />
  );
}

export { Button, buttonVariants };
