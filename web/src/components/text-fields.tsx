import { useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import type { InputProps } from '@/components/ui/input';
import { ClearButton } from '@/components/clear-button';
import { t } from '@/lib/i18n';

/**
 * The two fields the app reaches for that are more than an Input — each
 * an InputGroup (shadcn's field-with-things-in-it) with its own things:
 *
 *   ClearableInput — an X that empties it, while there is something to empty.
 *   SearchInput    — the magnifier, the X, and on touch a Cancel beside it.
 */

function emptyField(el: HTMLInputElement, then: 'stay' | 'leave'): void {
  // The native setter, so React sees the change as typing and fires
  // onChange for a controlled caller.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  if (then === 'stay') el.focus();
  else el.blur();
}

/** Two sizes Cancel can be, matched to the field's. */
const cancelSizes = {
  sm: 'h-7 pointer-coarse:h-9',
  md: 'h-8',
  lg: 'h-9',
} as const;

export interface ClearableInputProps extends InputProps {
  inputClassName?: string;
}

/**
 * An Input with the X that empties it.
 *
 * The X is only there while the field is focused AND holds something —
 * a button over an empty box does nothing, and one on an unfocused field
 * is a target you have not asked for. The press keeps the focus (see
 * ClearButton), so clearing costs neither the caret nor, on a phone, the
 * keyboard.
 */
export function ClearableInput({
  className,
  inputClassName,
  inputSize = 'md',
  onFocus,
  onBlur,
  onChange,
  value,
  defaultValue,
  ref,
  ...props
}: ClearableInputProps) {
  const [focused, setFocused] = useState(false);
  // For an uncontrolled caller, which the X still has to know about.
  const [typed, setTyped] = useState(() => String(defaultValue ?? ''));
  const self = useRef<HTMLInputElement | null>(null);
  const text = value === undefined ? typed : String(value);
  const showClear = focused && text !== '';

  return (
    <InputGroup inputSize={inputSize} className={cn('inline-flex w-auto', className)}>
      <InputGroupInput
        ref={(node) => {
          self.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        inputSize={inputSize}
        value={value}
        defaultValue={defaultValue}
        className={cn('w-full', showClear && 'pr-7', inputClassName)}
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
      {showClear && (
        <ClearButton
          className="right-1.5"
          onClear={() => self.current && emptyField(self.current, 'stay')}
        />
      )}
    </InputGroup>
  );
}

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
export function SearchInput({
  className,
  inputSize = 'md',
  onFocus,
  onBlur,
  onChange,
  value,
  ref,
  renderHighlight,
  ...props
}: InputProps & {
  /**
   * In-field syntax colouring: the input's own glyphs go transparent
   * (caret kept) and this renders the SAME text, styled, in an overlay
   * exactly over them — so the metrics must match to the pixel, which
   * is why the overlay copies the input's font and padding classes and
   * mirrors its horizontal scroll. The one cost: selected text shows
   * only the selection wash, since the selected glyphs are the
   * transparent ones.
   */
  renderHighlight?: (text: string) => ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  // For an uncontrolled caller, which the X still has to know about.
  const [typed, setTyped] = useState('');
  const self = useRef<HTMLInputElement | null>(null);
  const overlay = useRef<HTMLSpanElement | null>(null);
  const syncScroll = (): void => {
    if (overlay.current && self.current) overlay.current.scrollLeft = self.current.scrollLeft;
  };
  const text = value === undefined ? typed : String(value);

  /** See the two buttons: the X stays in the field, Cancel leaves it. */
  const empty = (then: 'stay' | 'leave'): void => {
    if (self.current) emptyField(self.current, then);
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
      <InputGroup inputSize={inputSize} className="min-w-0 flex-1">
        <InputGroupAddon>
          <Search className="text-muted-foreground pointer-events-none size-3.5" />
        </InputGroupAddon>
        {renderHighlight && (
          <span
            aria-hidden
            ref={overlay}
            className={cn(
              // The input's own text box, mirrored: same font scale,
              // same paddings (pl from the addon rule, pr-7 while the
              // clear button stands), centred the way an input centres
              // its line. overflow-hidden still honours a programmatic
              // scrollLeft, which is how it follows the caret.
              'text-foreground pointer-events-none absolute inset-y-0 left-[1.375rem] right-0 z-0 flex items-center',
              'overflow-hidden whitespace-pre text-base md:text-sm',
              'pl-1.5 pr-2',
              text && 'pr-7',
            )}
          >
            {renderHighlight(text)}
          </span>
        )}
        <InputGroupInput
          ref={(node) => {
            self.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          inputSize={inputSize}
          value={value}
          onScroll={renderHighlight ? syncScroll : undefined}
          // Not `type` — every plain Input is type="search" here, for the
          // autofill reasons in components/ui/input — so a REAL search box has to say
          // so itself. The dialog focus rule reads this: a window whose
          // only field is a search box was opened to browse what is under
          // the box, not to type in it, and must not open with the
          // keyboard up.
          data-search-field=""
          // The badge is 8px in and 14px wide; 6px more puts the text at
          // the 28px every search field has always started at.
          className={cn(
            'pl-1.5',
            text && 'pr-7',
            // Highlighting: the overlay draws the glyphs, the input
            // keeps only its caret (and its focus, and its events).
            renderHighlight && 'relative z-[1] text-transparent [caret-color:var(--color-foreground)]',
          )}
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
            // The caret may have auto-scrolled the input; the overlay
            // follows on the next frame, once layout has settled.
            if (renderHighlight) requestAnimationFrame(syncScroll);
          }}
          {...props}
        />
        {/* Inside the field, because it is about the field's contents. It
            appears with the text and leaves with it — an X over an empty
            box is a button that does nothing. */}
        {text && (
          <ClearButton className="right-1.5" label="Clear search" onClear={() => empty('stay')} />
        )}
      </InputGroup>
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
          'pointer-fine:hidden text-muted-foreground hover:text-foreground grid shrink-0 place-items-center overflow-hidden',
          'whitespace-nowrap rounded-full text-sm font-medium',
          // The same glass the sheets close with: a translucent disc that
          // takes its colour from whatever it sits on, with a hairline of
          // light along the edge. backdrop-blur is what makes it read as
          // glass rather than as a grey pill.
          'bg-foreground/8 hover:bg-foreground/14 ring-foreground/10 ring-1 ring-inset backdrop-blur-md',
          'transition-[max-width,margin,padding,opacity] duration-150',
          cancelSizes[inputSize ?? 'md'],
          focused ? 'ml-1.5 max-w-24 px-2.5 opacity-100' : 'ml-0 max-w-0 px-0 opacity-0',
        )}
      >
        {t('Cancel')}
      </button>
    </span>
  );
}
