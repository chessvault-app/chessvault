import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, INPUT_BASE, type InputProps } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * shadcn's InputGroup, owned: a field with things in it — a magnifier
 * before the text, a clear button after it — where the GROUP is the box
 * and the input inside it is bare.
 *
 * It wears Input's own look (INPUT_BASE, the same heights), so a search
 * field and a plain field in one toolbar are the same object to the eye.
 * The two things that move from the input to the group: the focus tint on
 * the border, and the keyboard ring. The global :focus-visible outline
 * would draw a square ring on the borderless input INSIDE the rounded box,
 * so the control turns it off (the one place in the app that may — see
 * ui/input for why nowhere else does) and the group draws the same ring
 * around the whole field with a `has-[]` variant.
 */
const inputGroupVariants = cva(
  cn(
    INPUT_BASE,
    'group/input-group relative flex w-full items-center',
    // Focus, on the group: the border tint whenever the field is focused,
    // and the ring when the focus is keyboard-visible. Both read the inner
    // control by its slot.
    'has-[[data-slot=input-group-control]:focus]:border-primary/50',
    'has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-primary has-[[data-slot=input-group-control]:focus-visible]:outline-offset-2',
    'has-disabled:pointer-events-none has-disabled:opacity-45',
  ),
  {
    variants: {
      inputSize: {
        sm: 'h-7 pointer-coarse:h-9',
        md: 'h-8',
        lg: 'h-9',
      },
    },
    defaultVariants: { inputSize: 'md' },
  },
);

function InputGroup({
  className,
  inputSize,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupVariants>) {
  return (
    <div
      data-slot="input-group"
      data-size={inputSize ?? 'md'}
      role="group"
      className={cn(inputGroupVariants({ inputSize }), className)}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        'inline-start': 'order-first pl-2 has-[>button]:ml-[-0.3rem]',
        'inline-end': 'order-last pr-2 has-[>button]:mr-[-0.3rem]',
        'block-start': 'order-first w-full justify-start px-2.5 pt-2',
        'block-end': 'order-last w-full justify-start px-2.5 pb-2',
      },
    },
    defaultVariants: { align: 'inline-start' },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      // A press on the badge is a press on the field.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.parentElement?.querySelector('input')?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva('flex items-center gap-2 text-sm shadow-none', {
  variants: {
    size: {
      xs: "h-6 gap-1 rounded-[calc(var(--radius)-3px)] px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
      sm: '',
      'icon-xs': 'size-6 rounded-[calc(var(--radius)-3px)] p-0 has-[>svg]:p-0',
      'icon-sm': 'size-7 p-0 has-[>svg]:p-0',
    },
  },
  defaultVariants: { size: 'xs' },
});

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The bare input inside the group: no box of its own, the group's height,
 * and — the one exception in the app — no outline, since the group draws
 * the ring (see above).
 */
function InputGroupInput({ className, ...props }: InputProps) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'h-full flex-1 rounded-none border-0 bg-transparent outline-none focus:border-0',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        'flex-1 resize-none rounded-none border-0 bg-transparent py-2 outline-none focus:border-0',
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
};
