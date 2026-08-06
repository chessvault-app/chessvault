import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Removes internal padding, for panels that own their own scroll area. */
  flush?: boolean;
}

/** The standard raised surface: every pane in the app sits in one of these. */
export function Panel({ children, className, flush = false }: PanelProps) {
  return (
    <section
      className={cn(
        'bg-surface border-line rounded-xl border shadow-[var(--shadow-panel)]',
        'flex min-h-0 flex-col overflow-hidden',
        !flush && 'p-3',
        className,
      )}
    >
      {children}
    </section>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, actions, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'border-line flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3',
        className,
      )}
    >
      <h2 className="text-subtle min-w-0 shrink truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {title}
      </h2>
      {actions ? <div className="flex min-w-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
