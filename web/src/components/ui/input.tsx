import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn's Input (nova), owned: the registry's face and focus ring, plus
 * two things of this app's — a size axis that follows the Button scale so
 * a toolbar row lines up (sm 28 / md 32 / lg 36 px), and the autofill
 * disguise below.
 *
 * `text-base md:text-sm` is the registry's answer to the same iOS fact
 * this app had found: a focused field under 16px zooms the whole page.
 */

/**
 * What every field shares — exported for Textarea, which has no height of
 * its own, and for InputGroup, which wears it on the group.
 */
export const INPUT_BASE =
  'rounded-lg border border-input bg-transparent text-base transition-colors outline-none ' +
  'placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ' +
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 ' +
  'aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 ' +
  'md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40';

const inputVariants = cva(cn(INPUT_BASE, 'min-w-0 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground'), {
  variants: {
    inputSize: {
      sm: 'h-7 px-2 py-1 pointer-coarse:h-9',
      md: 'h-8 px-2.5 py-1',
      lg: 'h-9 px-3 py-1',
    },
  },
  defaultVariants: { inputSize: 'md' },
});

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
  // Half a disguise is not one. See NEUTRAL_NAME.
  name: 'search',
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

/**
 * The other half of the search-box disguise.
 *
 * `type="search"` alone was not enough, and the case that proved it was
 * the book shelf's rename. Safari classifies a field from everything it
 * can see, and what it could see there was: no `name`, no `id`, no
 * label element — and a dialog whose only text is "이 책 이름 바꾸기".
 * `이름` is Korean for *name*, so the one worded signal in reach said
 * "person's name" and up came 자동 완성 연락처. A field that claims to be
 * a search box should also be NAMED like one. Applied only where the type
 * is already faked, so a real password field keeps its own identity; any
 * caller passing `name` outranks it.
 */
const NEUTRAL_NAME = 'search';

export interface InputProps
  extends React.ComponentProps<'input'>,
    VariantProps<typeof inputVariants> {}

/**
 * Autofill is off by default across the app.
 *
 * Nothing here is a name, an address or a card — a study is called what you
 * call it — but iOS offered "auto-complete contact" over the keyboard while
 * naming a PGN import, and `autocomplete="off"` is precisely the hint
 * Safari ignores. What Safari does not offer contacts for is a SEARCH
 * field, so a plain text box becomes one — in its `type` and its `name`.
 * A caller that wants a real suggestion passes autoComplete and a type.
 */
function Input({ className, inputSize, type = 'text', enterKeyHint, name, ...props }: InputProps) {
  const plainText = type === 'text';
  return (
    <input
      data-slot="input"
      type={plainText ? 'search' : type}
      name={name ?? (plainText ? NEUTRAL_NAME : undefined)}
      enterKeyHint={enterKeyHint ?? (plainText ? 'done' : undefined)}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      spellCheck={false}
      data-1p-ignore
      data-form-type="other"
      className={cn(inputVariants({ inputSize }), plainText && noAutofillClass, className)}
      {...props}
    />
  );
}

export { Input, inputVariants };
