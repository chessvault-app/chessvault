import {
  forwardRef,
  useRef,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { CalendarDays, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

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

/** The clear button matches the field's own height, coarse sizes included. */
const clearSizes: Record<InputSize, string> = {
  sm: 'h-7 pointer-coarse:h-9',
  md: 'h-8',
  lg: 'h-9',
};

/**
 * An Input with the magnifier badge every search field carries, and a way
 * out of it.
 *
 * The X arrives on focus, BESIDE the field rather than inside it: an icon
 * floating over the right end of a text box is a target you have to aim
 * past the text to hit, and it covers the tail of what you typed — which
 * on a phone is most of what is visible. The field gives up the width
 * instead, so the row is exactly as wide as it was and the button is a
 * button, on its own ground.
 *
 * It clears without closing: focus stays, so the next thing you type is
 * the new search rather than a tap away from being one.
 *
 * Width classes go on the wrapper; the field takes what is left.
 */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, inputSize = 'md', onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const self = useRef<HTMLInputElement | null>(null);

  const clear = (): void => {
    const el = self.current;
    if (!el) return;
    // Through the native setter and an input event, so a CONTROLLED field
    // hears it as a change. Assigning el.value alone is invisible to
    // React, and every caller of this is controlled.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
  };

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <span className="relative inline-flex min-w-0 flex-1 items-center">
        <Search className="text-subtle pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          ref={(node) => {
            self.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          inputSize={inputSize}
          className="w-full pl-7"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
      </span>
      {/* Never unmounted, only narrowed to nothing: a button that
          disappears on blur is a button whose own press dismisses it
          before the click lands. preventDefault on the press keeps the
          field focused for the same reason — and means clearing does not
          cost you the keyboard. */}
      <button
        type="button"
        tabIndex={focused ? 0 : -1}
        aria-hidden={!focused}
        title={t('Clear search')}
        aria-label={t('Clear search')}
        onPointerDown={(e) => e.preventDefault()}
        onClick={clear}
        className={cn(
          'text-muted hover:text-fg grid shrink-0 place-items-center overflow-hidden rounded-full',
          // Glass, like the sheets' close: a translucent disc that takes
          // its colour from whatever it sits on, with a hairline of light
          // along the edge. backdrop-blur is what makes it read as glass
          // rather than as a grey circle.
          'bg-fg/8 hover:bg-fg/14 ring-fg/10 ring-1 ring-inset backdrop-blur-md',
          'transition-[width,margin,opacity] duration-150',
          clearSizes[inputSize],
          focused ? 'ml-1.5 w-7 opacity-100 pointer-coarse:w-9' : 'ml-0 w-0 opacity-0',
        )}
      >
        <X className="size-3.5 shrink-0" />
      </button>
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
