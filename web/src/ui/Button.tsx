import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid';
type Size = 'sm' | 'md' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
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
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md pointer-coarse:h-9 pointer-coarse:px-3',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  icon: 'size-9 rounded-lg pointer-coarse:size-11',
  'icon-sm': 'size-7 rounded-md pointer-coarse:size-9',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', active = false, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active || undefined}
      className={cn(
        // nowrap: Korean has no spaces to break at, so a narrow button split
        // 추가 down the middle into two stacked syllables. Latin labels were
        // never wide enough to notice.
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,border-color,box-shadow,transform] duration-150',
        'active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-45',
        variants[variant],
        sizes[size],
        active && 'bg-primary-soft text-primary border-primary/30',
        className,
      )}
      {...props}
    />
  );
});
