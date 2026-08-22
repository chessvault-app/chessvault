import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

export { CoverParent } from '@/ui/coverParent';

/**
 * A window over the app — the prop spelling of components/ui/dialog's
 * `<Dialog open><DialogContent title …>`. The physics all live there now;
 * this is the shape the call sites still speak until they are repointed.
 */
export function Modal({
  title,
  icon,
  actions,
  onClose,
  onBack,
  children,
  className,
  hidden = false,
  full = false,
  fill = false,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
  hidden?: boolean;
  className?: string;
  full?: boolean;
  fill?: boolean;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={title}
        icon={icon}
        actions={actions}
        onBack={onBack}
        hidden={hidden}
        size={full ? 'full' : 'default'}
        fill={fill}
        className={className}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
