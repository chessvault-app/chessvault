import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The one text input. Every ad-hoc `bg-surface-inset border-line …` string
 * in the views drifted (two focus colours, four heights) — this is the
 * single source of truth. Keyboard focus keeps the global :focus-visible
 * ring; pointer focus tints the border with the primary colour.
 */

type InputSize = 'sm' | 'md' | 'lg';

/**
 * Heights follow the Button scale so mixed rows line up — including on a
 * touch screen, where a small Button grows to h-9 for the finger. An input
 * that stayed h-7 there left the Games header with a search field visibly
 * shorter than the Import button beside it.
 */
const sizes: Record<InputSize, string> = {
  sm: 'h-7 px-2 text-xs pointer-coarse:h-9 pointer-coarse:px-3',
  md: 'h-8 px-2.5 text-xs',
  lg: 'h-9 px-3 text-sm',
};

const base =
  'bg-surface-inset border-line text-fg placeholder:text-subtle min-w-0 rounded-md border ' +
  'outline-none transition-colors duration-100 focus:border-primary/50 ' +
  'disabled:pointer-events-none disabled:opacity-45';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'md', ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, sizes[inputSize], className)} {...props} />;
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  return (
    <textarea ref={ref} className={cn(base, 'px-2.5 py-2 text-xs', className)} {...props} />
  );
});

/** An Input with the magnifier badge every search field carries. Width
    classes go on the wrapper; the input fills it. */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, inputSize = 'md', ...props },
  ref,
) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <Search className="text-subtle pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
      <Input ref={ref} inputSize={inputSize} className="w-full pl-7" {...props} />
    </span>
  );
});
