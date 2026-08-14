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

/** Cancel matches the field's own height, coarse sizes included. */
const cancelSizes: Record<InputSize, string> = {
  sm: 'h-7 pointer-coarse:h-9',
  md: 'h-8',
  lg: 'h-9',
};

/**
 * An Input with the magnifier badge every search field carries, plus the
 * two things a search needs that a text box does not.
 *
 * INSIDE, at the right end: an X that empties the field and leaves you in
 * it. It is only there while there is something to clear, and the field
 * pads itself out of its way so the tail of what you typed is never
 * underneath it.
 *
 * OUTSIDE, on focus: Cancel, which empties the field AND puts it away —
 * cancelling a search means the list you were looking at comes back, and
 * leaving the words behind would leave it filtered by a search nobody is
 * doing any more. The X is the same act without the leaving. The field
 * gives up the width for it, so the row stays exactly as wide as it was.
 *
 * On a phone the field also takes the whole line while it is focused,
 * because a search you are typing into is the only thing on the screen
 * that matters and 140px of it is not enough to read a result back.
 *
 * Width classes go on the wrapper; the field takes what is left.
 */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, inputSize = 'md', onFocus, onBlur, onChange, value, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // For an uncontrolled caller, which the X still has to know about.
  const [typed, setTyped] = useState('');
  const self = useRef<HTMLInputElement | null>(null);
  const text = value === undefined ? typed : String(value);

  /** Empty it, and either stay in it or leave — see the two buttons. */
  const empty = (then: 'stay' | 'leave'): void => {
    const el = self.current;
    if (!el) return;
    // Through the native setter and an input event, so a CONTROLLED field
    // hears it as a change. Assigning el.value alone is invisible to React.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (then === 'stay') el.focus();
    else el.blur();
  };

  return (
    <span
      className={cn(
        'relative inline-flex items-center',
        className,
        // The whole line, phones only, and only while it is being used.
        // The toolbars wrap, so this takes a row of its own rather than
        // squeezing the buttons beside it.
        focused && 'max-sm:w-full',
      )}
    >
      <span className="relative inline-flex min-w-0 flex-1 items-center">
        <Search className="text-subtle pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          ref={(node) => {
            self.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          inputSize={inputSize}
          value={value}
          // Not `type` — every plain Input is type="search" here, for the
          // autofill reasons above — so a REAL search box has to say so
          // itself. ui/dialogFocus reads this: a window whose only field
          // is a search box was opened to browse what is under the box,
          // not to type in it, and must not open with the keyboard up.
          data-search-field=""
          className={cn('w-full pl-7', text && 'pr-7')}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          onChange={(e) => {
            setTyped(e.target.value);
            onChange?.(e);
          }}
          {...props}
        />
        {/* Inside the field, because it is about the field's contents. It
            appears with the text and leaves with it — an X over an empty
            box is a button that does nothing. preventDefault on the press
            keeps the focus, so clearing costs neither the caret nor, on a
            phone, the keyboard. */}
        {text && (
          <button
            type="button"
            title={t('Clear search')}
            aria-label={t('Clear search')}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => empty('stay')}
            className={cn(
              'text-subtle hover:text-fg hover:bg-fg/10 absolute right-1.5 top-1/2 grid -translate-y-1/2',
              'size-5 place-items-center rounded-full transition-colors duration-100',
            )}
          >
            <X className="size-3.5 shrink-0" />
          </button>
        )}
      </span>
      {/* Touch only. Cancel exists to put a keyboard away and give the
          screen back; a mouse has neither problem, and has Escape and
          anywhere-else besides. Never unmounted where it does apply, only
          narrowed to nothing: a button that disappears on blur is a
          button whose own press dismisses it before the click lands.
          preventDefault on the press is the same protection — the field
          stays focused until the click has run, and then this blurs it. */}
      <button
        type="button"
        tabIndex={focused ? 0 : -1}
        aria-hidden={!focused}
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => empty('leave')}
        className={cn(
          'pointer-fine:hidden text-muted hover:text-fg grid shrink-0 place-items-center overflow-hidden',
          'whitespace-nowrap rounded-full text-xs font-medium',
          // The same glass the sheets close with: a translucent disc that
          // takes its colour from whatever it sits on, with a hairline of
          // light along the edge. backdrop-blur is what makes it read as
          // glass rather than as a grey pill.
          'bg-fg/8 hover:bg-fg/14 ring-fg/10 ring-1 ring-inset backdrop-blur-md',
          'transition-[max-width,margin,padding,opacity] duration-150',
          cancelSizes[inputSize],
          focused ? 'ml-1.5 max-w-24 px-2.5 opacity-100' : 'ml-0 max-w-0 px-0 opacity-0',
        )}
      >
        {t('Cancel')}
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
