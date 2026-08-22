import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
type Size = 'sm' | 'md' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-control',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border border-line',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
  danger: 'bg-bad/12 text-bad hover:bg-bad/20 border border-bad/25',
  // Filled, for a confirmation's own confirm button — the one press in the
  // app that cannot be taken back should not look like the tinted danger
  // used for triggers that merely OPEN a question. --bad-fg is the token
  // for what reads on a filled --bad panel in both themes.
  'danger-solid': 'bg-bad text-bad-fg hover:bg-bad/90 border border-bad',
};

// Coarse pointers get bigger hit areas: 28px icon buttons are fine under a
// mouse and hostile under a thumb.
const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-sm gap-1.5 rounded-md pointer-coarse:h-9 pointer-coarse:px-3',
  md: 'h-9 px-3.5 text-base gap-2 rounded-lg',
  icon: 'size-9 rounded-lg pointer-coarse:size-11',
  'icon-sm': 'size-7 rounded-md pointer-coarse:size-9',
};

/**
 * Everything a button looks like before its variant and its size — shared
 * with ButtonLink below, which must be indistinguishable from a Button
 * standing next to it in a row.
 *
 * nowrap: Korean has no spaces to break at, so a narrow button split
 * 추가 down the middle into two stacked syllables. Latin labels were
 * never wide enough to notice.
 */
const BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium ' +
  'transition-[background-color,color,border-color,box-shadow,transform] duration-150 ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

/**
 * The same button, as a link.
 *
 * A control that goes OUT of the app is an anchor and nothing else: a
 * button with an onClick that navigates loses the middle click, the
 * context menu and the address the browser shows on hover — and a screen
 * reader announces the wrong kind of thing. But standing one in a row of
 * buttons, it has to be the same object to the eye — and copying Button's
 * class string beside it is how the two come to disagree about a padding.
 */
export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant;
  size?: Size;
};

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { className, variant = 'secondary', size = 'md', ...props },
  ref,
) {
  return <a ref={ref} className={cn(BASE, variants[variant], sizes[size], className)} {...props} />;
});

// Does the button say anything in text? A visible label is already the
// accessible name — and must stay it, or "click Cancel" stops working for
// voice control. Only icon-only buttons need naming by other means.
function hasTextContent(children: React.ReactNode): boolean {
  if (typeof children === 'string') return children.trim().length > 0;
  if (Array.isArray(children)) return children.some(hasTextContent);
  return false;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', active = false, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // An icon-only button's title doubles as its accessible name unless
      // one was given. These buttons were named by `title` alone, and the
      // styled-tooltip system (ui/tooltip) REMOVES title while its tip is
      // showing — so the name used to vanish exactly when the control was
      // pointed at. aria-label stays put.
      aria-label={
        props['aria-label'] ?? (hasTextContent(props.children) ? undefined : props.title)
      }
      data-active={active || undefined}
      className={cn(
        BASE,
        variants[variant],
        sizes[size],
        active && 'bg-primary-soft text-primary border-primary/30',
        className,
      )}
      {...props}
    />
  );
});
