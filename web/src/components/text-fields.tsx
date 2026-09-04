import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/**
 * For the flex row a SearchInput leads: on a phone, while the field has
 * focus, every sibling in the row is hidden so the field can take the
 * whole line. The row does not wrap in card mode, so w-full on the field
 * alone only shrank against the buttons beside it (the toolbar showed a
 * 140px box between Cancel, the bookmark switch and the filters). The
 * field, its Cancel and its hints panel are all inside the first child,
 * so nothing a typing user needs goes with them. The search must be the
 * row's first child.
 */
export const searchRowClass = 'max-sm:has-[[data-search-field]:focus]:*:not-first:hidden';

/** Two sizes Cancel can be, matched to the field's. */
const cancelSizes = {
  sm: 'h-7 pointer-coarse:h-9',
  md: 'h-8',
  lg: 'h-9',
} as const;

export interface ClearableInputProps extends InputProps {
  inputClassName?: string;
  /**
   * A leading addon inside the field's border — an InputGroupButton or a
   * badge, the shadcn buttons-inside-inputs shape. At the START, never the
   * end: the X below owns the right edge, and the two would sit on each
   * other. (Grown for the hunt bar's board button, which stood beside the
   * FEN field as a lone unlabelled icon; inside the border it reads as
   * "the other way to fill this field".)
   */
  start?: ReactNode;
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
  start,
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
      {start && (
        // The slot is the field's leading SEGMENT — full height, flush
        // with the group's own corner, its button drawing the hairline
        // to the text — not a chip floating inside: a bordered box
        // within the bordered box read as clutter (lanph3re, on the
        // hunt bar's board button, this slot's only tenant).
        <InputGroupAddon className="self-stretch overflow-hidden rounded-l-[inherit] p-0 has-[>button]:ml-0">
          {start}
        </InputGroupAddon>
      )}
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
  highlight,
  ...props
}: InputProps & {
  /**
   * A coloured mirror of `value`, drawn BEHIND the input while the
   * input's own text goes transparent — the GitHub-search look, where
   * a qualifier's value colours itself in place and the whole query
   * stays one run of editable text (lanph3re's call, retiring the
   * chips). An earlier overlay attempt was rejected for a mirrored
   * caret that was never quite honest; this one keeps the NATIVE
   * caret — the input stays on top, only its glyph colour is
   * transparent, and caret-color paints the real caret — so the only
   * contract is that the mirror wears the input's exact font and
   * text offset, and follows its horizontal scroll.
   */
  highlight?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  // For an uncontrolled caller, which the X still has to know about.
  const [typed, setTyped] = useState('');
  const self = useRef<HTMLInputElement | null>(null);
  const mirror = useRef<HTMLSpanElement | null>(null);
  const text = value === undefined ? typed : String(value);

  // The mirror follows the input's own horizontal scroll — on scroll
  // events, and after every render, because typing at the far end
  // scrolls the field as a side effect of the caret moving. A LAYOUT
  // effect, not a plain one: the input scrolls itself synchronously as
  // the value commits, and syncing after paint let an overflowed field
  // show one frame of the old offset per keystroke — a visible jiggle
  // exactly while typing (lanph3re's report).
  const syncMirror = (): void => {
    if (mirror.current && self.current)
      mirror.current.style.transform = `translateX(${-self.current.scrollLeft}px)`;
  };
  useLayoutEffect(() => {
    if (highlight != null) syncMirror();
  });

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
        // The row it stands in hides everything beside it meanwhile (see
        // searchRowClass); this fills the room that opens up.
        focused && 'max-sm:w-full',
      )}
    >
      <InputGroup inputSize={inputSize} className="min-w-0 flex-1">
        <InputGroupAddon>
          <Search className="text-muted-foreground pointer-events-none size-3.5" />
        </InputGroupAddon>
        {highlight != null && text !== '' && (
          // pl-7 is the 28px the input note below derives; pr-7 is the
          // input's own clearance for the X. whitespace-pre, because the
          // mirror must measure spaces exactly as the input does.
          //
          // No z-indexes anywhere in this stack: mirror, input and the
          // X are all positioned, so DOM order IS paint order — mirror
          // under input under button. The input briefly wore z-[1] to
          // clear the mirror and thereby covered the X too: its centre
          // hit-tested to the input and the clear did nothing
          // (lanph3re's report).
          <div aria-hidden className="pointer-events-none absolute inset-0 flex pl-7 pr-7">
            {/* The clip lives on this INNER box, not on the padded one
                above: overflow-hidden clips at the padding box, so with
                the padding and the clip on one element the scrolled
                span painted straight through the pr-7 into the X — and
                through the pl-7 under the magnifier (lanph3re's
                screenshot). An inner border box IS the 28px-inset
                region, so the ink stops where the chrome starts. */}
            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
              <span ref={mirror} className="text-foreground whitespace-pre text-base md:text-sm">
                {highlight}
              </span>
            </div>
          </div>
        )}
        <InputGroupInput
          ref={(node) => {
            self.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          inputSize={inputSize}
          value={value}
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
            // The mirror holds the ink; the input keeps the caret and
            // the selection. Placeholder colour is its own rule, so an
            // empty field still says what it is for.
            highlight != null && 'relative text-transparent caret-foreground',
          )}
          onScroll={highlight != null ? syncMirror : undefined}
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
            box is a button that does nothing. */}
        {text && (
          <ClearButton
            className="right-1.5"
            label="Clear search"
            onClear={() => empty('stay')}
          />
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
          'bg-foreground/8 hover:bg-foreground/14 ring-border ring-1 ring-inset backdrop-blur-md',
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
