import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { t } from '@/lib/i18n';

/**
 * A panel with nothing in it yet, saying so properly — shadcn's Empty,
 * with the one shape all thirteen call sites share so no shelf words its
 * emptiness differently: say what is missing, say how it gets filled, and
 * offer the press that fills it.
 *
 * The picture is the registry's icon tile, not a drawing: the knight
 * plates that used to sit here were leftovers of the old logo work.
 * Nothing here is centred in the VIEWPORT; it centres in the panel it was
 * given, which is where the reader is already looking.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** The press that resolves it. Always give one if one exists. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn('py-12', className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{t(title)}</EmptyTitle>
        <EmptyDescription>{t(body)}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
