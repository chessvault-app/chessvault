import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { CalendarDays, Search } from 'lucide-react';
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
 *
 * Only the HEIGHT changes on a coarse pointer. A padding under a variant
 * lands in a media block, which outranks the plain `pl-7` SearchInput uses
 * to clear its magnifier however the classes are ordered — so the phone
 * drew the placeholder underneath the icon.
 */
const sizes: Record<InputSize, string> = {
  sm: 'h-7 px-2 text-xs pointer-coarse:h-9',
  md: 'h-8 px-2.5 text-xs',
  lg: 'h-9 px-3 text-sm',
};

const base =
  'bg-surface-inset border-line text-fg placeholder:text-subtle min-w-0 rounded-md border ' +
  'outline-none transition-colors duration-100 focus:border-primary/50 ' +
  'disabled:pointer-events-none disabled:opacity-45';

/**
 * What it takes to keep a browser's autofill out of a field.
 *
 * Exported because a few inputs are styled bare rather than as an Input —
 * the player names over the board — and "no autofill" must not be a thing
 * each of them remembers separately. `type="search"` is the load-bearing
 * part: Safari ignores autocomplete="off" and decides from the field's own
 * words, but it never offers contacts for a search box.
 */
export const noAutofill = {
  type: 'search',
  autoComplete: 'off',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  // Not autofill, but the other thing that appears over an iOS keyboard:
  // the predictive-text strip. A study is not a word anyone can spell for
  // you, so nothing here wants either.
  spellCheck: false,
  enterKeyHint: 'done',
  'data-1p-ignore': true,
  'data-form-type': 'other',
} as const;

/** Undoes what type="search" looks like: the clear button and the pill. */
export const noAutofillClass = 'appearance-none [&::-webkit-search-cancel-button]:hidden';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
}

/**
 * Autofill is off by default across the app.
 *
 * Nothing here is a name, an address or a card — a study is called what you
 * call it — but iOS offered "auto-complete contact" over the keyboard while
 * naming a PGN import, and `autocomplete="off"` is precisely the hint
 * Safari ignores: it decides from the field's own words, and a field whose
 * placeholder says "name" is a person's name as far as it is concerned.
 *
 * What Safari does not offer contacts for is a SEARCH field, so a plain
 * text box becomes one — the type is the only lever the browser honours.
 * Nothing else changes: WebKit's clear button is hidden, its appearance is
 * reset, and the keyboard's return key is told this is not a search. A
 * caller that wants a real suggestion passes autoComplete and a type.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, inputSize = 'md', type = 'text', enterKeyHint, ...props },
  ref,
) {
  const plainText = type === 'text';
  return (
    <input
      ref={ref}
      type={plainText ? 'search' : type}
      enterKeyHint={enterKeyHint ?? (plainText ? 'done' : undefined)}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      data-1p-ignore
      data-form-type="other"
      className={cn(
        base,
        sizes[inputSize],
        plainText && 'appearance-none [&::-webkit-search-cancel-button]:hidden',
        className,
      )}
      {...props}
    />
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      className={cn(base, 'px-2.5 py-2 text-xs', className)}
      {...props}
    />
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

/**
 * A date field that says so.
 *
 * `type="date"` draws its own picker button on desktop Chrome and nothing
 * at all on iOS, where an empty one reads as a blank box — so the leading
 * badge is the only thing that names it on the device most likely to see it.
 */
export const DateInput = forwardRef<HTMLInputElement, InputProps>(function DateInput(
  { className, inputSize = 'md', ...props },
  ref,
) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <CalendarDays className="text-subtle pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
      <Input ref={ref} type="date" inputSize={inputSize} className="w-full pl-7" {...props} />
    </span>
  );
});
