import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * The X that empties the field it sits in.
 *
 * Extracted from three copies — ClearableInput's, SearchInput's and the
 * analysis board's name plate — which were the same button down to the
 * detail that matters most about it: `preventDefault` on the press, so
 * clearing costs neither the caret nor, on a phone, the keyboard. A
 * fourth copy would have had to remember that too, and the way it gets
 * forgotten is by being retyped.
 *
 * Positioned by the caller, because only the caller knows what it is
 * sitting on: a bordered input holds it a notch off the edge, the name
 * plate has no chrome to clear and sits flush. That is the one thing the
 * three copies genuinely disagreed about.
 *
 * Absolute, so the field must be `relative` and must reserve room for it
 * in its own padding — the callers do both, and a field that forgets the
 * padding gets an X over its last character rather than beside it.
 */
export function ClearButton({
  onClear,
  label = 'Clear',
  className,
}: {
  onClear: () => void;
  /** Accessible name and tooltip, translated here. 'Clear search' where
      the field is one. */
  label?: string;
  /** Where it sits — `right-1.5` inside an input, `right-0` flush. */
  className?: string;
}) {
  return (
    <button
      type="button"
      title={t(label)}
      aria-label={t(label)}
      // The press must not take the focus off the field being cleared.
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClear}
      className={cn(
        'text-subtle hover:text-fg hover:bg-fg/10 absolute top-1/2 grid -translate-y-1/2',
        'size-5 place-items-center rounded-full transition-colors duration-100',
        className,
      )}
    >
      <X className="size-3.5 shrink-0" />
    </button>
  );
}
