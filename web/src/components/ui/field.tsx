import {
  cloneElement,
  createContext,
  isValidElement,
  useId,
  useMemo,
  type ReactNode,
} from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
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

function FieldSet({ className, ...props }: React.ComponentProps<'fieldset'>) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        'flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3',
        className,
      )}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  variant = 'legend',
  ...props
}: React.ComponentProps<'legend'> & { variant?: 'legend' | 'label' }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        'mb-1.5 font-medium data-[variant=label]:text-sm data-[variant=legend]:text-base',
        className,
      )}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        'group/field-group @container/field-group flex w-full flex-col gap-5 data-[slot=checkbox-group]:gap-3 *:data-[slot=field-group]:gap-4',
        className,
      )}
      {...props}
    />
  );
}

const fieldVariants = cva('group/field flex w-full gap-2 data-[invalid=true]:text-destructive', {
  variants: {
    orientation: {
      vertical: 'flex-col *:w-full [&>.sr-only]:w-auto',
      horizontal:
        'flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
      responsive:
        'flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px',
    },
  },
  defaultVariants: { orientation: 'vertical' },
});

/**
 * shadcn's Field, owned, with the shorthand this app's forms are written
 * in: give it a `label` and it IS a named control — the label, the hint
 * beside it, the control under them, wired by id.
 *
 * Placeholders were doing the naming, which works for one field and stops
 * working the moment there are three: a placeholder disappears as soon as
 * the field is filled, so a half-completed import window was a column of
 * boxes with no way to tell which was which. The label stays.
 *
 * The label is a real <label>, wired by id: it used to be a bare span,
 * which meant every field looked named and was programmatically anonymous
 * — a screen reader read "edit text" 25 times per form. When the child is
 * a single element without an id of its own it gets a generated one and
 * the label points at it; anything more elaborate keeps its own wiring.
 *
 * Without `label` it is the registry's Field exactly: a group for
 * FieldLabel, FieldDescription and the rest to be composed in by hand.
 * The shorthand does NOT stretch its child the way the bare group does
 * (`*:w-full`): a Switch or a Select in a settings form keeps its own
 * width, and the callers that want a full-width control say so.
 */
function Field({
  className,
  orientation = 'vertical',
  label,
  hint,
  children,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof fieldVariants> & {
    /** Names the control; switches on the shorthand layout. */
    label?: string;
    /** A quiet second line, for what the label cannot say in two words. */
    hint?: ReactNode;
  }) {
  const generated = useId();
  if (label === undefined) {
    return (
      <div
        role="group"
        data-slot="field"
        data-orientation={orientation}
        className={cn(fieldVariants({ orientation }), className)}
        {...props}
      >
        {children}
      </div>
    );
  }
  let control = children;
  let target: string | undefined;
  if (isValidElement<{ id?: string }>(children)) {
    target = children.props.id ?? generated;
    if (!children.props.id) control = cloneElement(children, { id: generated });
  }
  return (
    <FieldContext.Provider value={true}>
      <div
        role="group"
        data-slot="field"
        data-orientation="vertical"
        className={cn('group/field flex min-w-0 flex-col gap-2', className)}
        {...props}
      >
        <div className="flex items-baseline justify-between gap-2">
          <FieldLabel htmlFor={target}>{t(label)}</FieldLabel>
          {hint}
        </div>
        {control}
      </div>
    </FieldContext.Provider>
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-content"
      className={cn('group/field-content flex flex-1 flex-col gap-0.5 leading-snug', className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[>[data-slot=field]]:rounded-lg has-[>[data-slot=field]]:border has-[>[data-slot=field]]:not-has-[:disabled,[data-disabled]]:hover:bg-muted/50 *:data-[slot=field]:p-2.5',
        'has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col',
        className,
      )}
      {...props}
    />
  );
}

function FieldTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        'flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        'text-left text-sm leading-normal font-normal text-muted-foreground group-has-data-horizontal/field:text-balance [[data-variant=legend]+&]:-mt-1.5',
        'last:mt-0 nth-last-2:-mt-1',
        '[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  );
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<'div'> & { children?: ReactNode }) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        'relative -my-2 h-5 text-sm group-data-[variant=outline]/field-group:-mb-2',
        className,
      )}
      {...props}
    >
      <Separator className="absolute inset-0 top-1/2" />
      {children && (
        <span
          className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  );
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<'div'> & { errors?: Array<{ message?: string } | undefined> }) {
  const content = useMemo(() => {
    if (children) return children;
    if (!errors?.length) return null;
    const unique = [...new Map(errors.map((error) => [error?.message, error])).values()];
    if (unique.length === 1) return unique[0]?.message;
    return (
      <ul className="ml-4 flex list-disc flex-col gap-1">
        {unique.map((error, index) => error?.message && <li key={index}>{error.message}</li>)}
      </ul>
    );
  }, [children, errors]);
  if (!content) return null;
  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn('text-sm font-normal text-destructive', className)}
      {...props}
    >
      {content}
    </div>
  );
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
};
