import type { ReactNode } from 'react';
import { AlertDialog, AlertDialogContent } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/**
 * The one-question window — the prop spelling of components/ui/dialog's
 * `<Dialog open><DialogContent size="sm" title …>` (and AlertDialog for a
 * question that must be answered). The physics all live there now; this is
 * the shape the call sites still speak until they are repointed.
 */
export function Sheet({
  label,
  alert = false,
  children,
  onClose,
  className,
  fill = false,
  onBack,
}: {
  label: string;
  alert?: boolean;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  fill?: boolean;
  onBack?: () => void;
}) {
  const onOpenChange = (open: boolean): void => {
    if (!open) onClose();
  };
  if (alert) {
    return (
      <AlertDialog open onOpenChange={onOpenChange}>
        <AlertDialogContent title={label} onBack={onBack} fill={fill} className={className}>
          {children}
        </AlertDialogContent>
      </AlertDialog>
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm" title={label} onBack={onBack} fill={fill} className={className}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
