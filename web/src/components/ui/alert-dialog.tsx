import * as React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogContentProps,
} from '@/components/ui/dialog';

/**
 * shadcn's AlertDialog — a question that must be answered before anything
 * else happens — owned, and built on this app's Dialog rather than on
 * Radix's AlertDialog primitive. One deliberate difference, and it is the
 * reason: Radix's alert dialog refuses to close on a press outside, and
 * every window in this app closes on the scrim (and drags away on a
 * phone) — a confirmation included. The scrim is never the advertised way
 * out, but it is always a way out, and a confirmation that behaved
 * differently from every other small window would be the one window that
 * had to be read before it could be dismissed. What a confirmation owes a
 * screen reader it keeps: `role="alertdialog"`, so the question is read at
 * once rather than waited for.
 */
function AlertDialog(props: React.ComponentProps<typeof Dialog>) {
  return <Dialog data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger(props: React.ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger data-slot="alert-dialog-trigger" {...props} />;
}

/** A small window by default: a question is a sentence and two buttons. */
function AlertDialogContent({ size = 'sm', ...props }: DialogContentProps) {
  return <DialogContent data-slot="alert-dialog-content" alert size={size} {...props} />;
}

function AlertDialogHeader(props: React.ComponentProps<typeof DialogHeader>) {
  return <DialogHeader data-slot="alert-dialog-header" {...props} />;
}

/**
 * Stacked, not a row, and the action first: a row of two puts them a
 * thumb's width apart on a phone, which is the wrong geometry for a pair
 * where one is irreversible and the other is the way out. Full width each,
 * with a real gap, so the press that cannot be undone cannot be the one
 * you meant to make somewhere else.
 */
function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="alert-dialog-footer" className={cn('mt-1 flex flex-col gap-2', className)} {...props} />
  );
}

function AlertDialogTitle(props: React.ComponentProps<typeof DialogTitle>) {
  return <DialogTitle data-slot="alert-dialog-title" {...props} />;
}

function AlertDialogDescription(props: React.ComponentProps<typeof DialogDescription>) {
  return <DialogDescription data-slot="alert-dialog-description" {...props} />;
}

/**
 * The press that answers the question. FILLED rather than tinted — the
 * tinted destructive style belongs to the triggers that merely OPEN a
 * question — and it should name its action ("Reset all progress"), because
 * "Confirm" answers a question you have already stopped reading.
 */
function AlertDialogAction({
  className,
  variant = 'destructive-solid',
  size = 'default',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose asChild>
      <Button
        data-slot="alert-dialog-action"
        variant={variant}
        size={size}
        className={cn('w-full justify-center', className)}
        {...props}
      />
    </DialogClose>
  );
}

/**
 * Cancel takes the focus, not the destructive verb above it: a
 * confirmation opens under the keyboard on the answer that loses nothing.
 * Enter on a window that just appeared must not be the press that cannot
 * be taken back.
 */
function AlertDialogCancel({
  className,
  variant = 'secondary',
  size = 'default',
  autoFocus = true,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <DialogClose asChild>
      <Button
        data-slot="alert-dialog-cancel"
        variant={variant}
        size={size}
        autoFocus={autoFocus}
        className={cn('w-full justify-center', className)}
        {...props}
      />
    </DialogClose>
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
};
