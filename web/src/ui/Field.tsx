import { cloneElement, createContext, isValidElement, useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * True inside a Field — "this control is part of a form".
 *
 * Read by controls that have a toolbar look and a form look, so the form
 * look arrives with the label rather than with a prop each call site has
 * to remember. Select is the case: it defaults to the raised menu face
 * that suits a filter bar, and every Select on the settings page and in
 * the new-game form sat beside sunken Inputs wearing it. A context rather
 * than a prop set by cloneElement, because the control is often a level
 * down — inside a flex row with a preview beside it.
 */
export const FieldContext = createContext(false);

/**
 * A named control in a form.
 *
 * Placeholders were doing the naming, which works for one field and stops
 * working the moment there are three: a placeholder disappears as soon as
 * the field is filled, so a half-completed import window was a column of
 * boxes with no way to tell which was which. The label stays.
 *
 * Small windows that ask for exactly one thing still use their own title —
 * a label under a title that says the same words is noise.
 *
 * The label is a real <label>, wired by id: it used to be a bare span,
 * which meant every field looked named and was programmatically anonymous
 * — a screen reader read "edit text" 25 times per form. When the child is
 * a single element without an id of its own it gets a generated one and
 * the label points at it; anything more elaborate keeps its own wiring.
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  /** A quiet second line, for what the label cannot say in two words. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  let control = children;
  let target: string | undefined;
  if (isValidElement<{ id?: string }>(children)) {
    target = children.props.id ?? generated;
    if (!children.props.id) control = cloneElement(children, { id: generated });
  }
  return (
    <FieldContext.Provider value={true}>
      <div className={cn('flex min-w-0 flex-col gap-1', className)}>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={target} className="text-subtle text-xs font-medium">
            {t(label)}
          </label>
          {hint}
        </div>
        {control}
      </div>
    </FieldContext.Provider>
  );
}
