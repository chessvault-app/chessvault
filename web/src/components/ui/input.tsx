import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * shadcn's Input, owned. The one text input: every ad-hoc
 * `bg-surface-inset border …` string in the views drifted (two focus
 * colours, four heights) — this is the single source of truth.
 *
 * Focus is the global :focus-visible ring (index.css), the same one every
 * Button wears, plus a tint on the border. No `outline-none` here, and
 * none may be added: the utility lands in the `utilities` layer, which
 * outranks the `base` layer the ring is declared in, so it did not hide
 * the ring for pointer focus and keep it for the keyboard — it removed it
 * for both, and a Tab into any field in the app landed nowhere visible.
 * (InputGroup is the exception, and moves the ring to the group.)
 */

/**
 * What every field shares before its size — exported for Textarea, which
 * has no height of its own, and for InputGroup, which wears it on the group.
 */
export const INPUT_BASE =
  'bg-surface-inset border-input text-foreground placeholder:text-subtle min-w-0 rounded-md border ' +
  'transition-colors duration-100 focus:border-primary/50 ' +
  'disabled:pointer-events-none disabled:opacity-45';

/**
 * Heights follow the Button scale so mixed rows line up — including on a
 * touch screen, where a small Button grows to h-9 for the finger. An input
 * that stayed h-7 there left the Games header with a search field visibly
 * shorter than the Import button beside it.
 *
 * Height and FONT change on a coarse pointer; padding must not. A padding
 * under a variant lands in a media block, which outranks the plain padding
 * an addon-bearing field uses to clear its icon however the classes are
 * ordered — so the phone drew the placeholder underneath the icon.
 *
 * The font is 16px there because iOS zooms the whole page when a focused
 * field is smaller, and 16px is how you decline that. Desktop keeps 14px:
 * it has a mouse and wants the density.
 */
const inputVariants = cva(INPUT_BASE, {
  variants: {
    inputSize: {
      sm: 'h-7 px-2 text-sm pointer-coarse:h-9 pointer-coarse:text-base',
      md: 'h-8 px-2.5 text-sm pointer-coarse:text-base',
      lg: 'h-9 px-3 text-base',
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
 * "person's name" and up came 자동 완성 연락처. Every rename and "name
 * this" prompt in the app shares that field, and the English wording says
 * "Rename this…" just as plainly.
 *
 * A field that claims to be a search box should also be NAMED like one:
 * with this, the two strongest attributes agree, and the classifier has
 * something concrete to read instead of falling back to the prose around
 * it. Applied only where the type is already faked, so a real password
 * field keeps its own identity and password managers still recognise it;
 * any caller passing `name` outranks it.
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
 * Safari ignores: it decides from the field's own words, and a field whose
 * placeholder says "name" is a person's name as far as it is concerned.
 *
 * What Safari does not offer contacts for is a SEARCH field, so a plain
 * text box becomes one — in its `type` and, since the rename prompt proved
 * the type alone insufficient, in its `name` too (see NEUTRAL_NAME).
 * Nothing else changes: WebKit's clear button is hidden, its appearance is
 * reset, and the keyboard's return key is told this is not a search. A
 * caller that wants a real suggestion passes autoComplete and a type.
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
