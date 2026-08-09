import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface PaneTab<T extends string> {
  id: T;
  label: string;
  /** When set, the tab shows this icon instead of its text — a thin row of
      icons costs far less vertical space on a phone than a row of labels. */
  icon?: LucideIcon;
}

/**
 * Small-screen pane switcher: on phones there is no room to stack every
 * panel under the board (see the lichess app), so exactly one shows at a
 * time. Desktop layouts never render this.
 */
export function PaneTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: PaneTab<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'bg-surface-2 border-line flex shrink-0 gap-0.5 rounded-lg border p-0.5',
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === value}
            aria-label={tab.label}
            title={tab.label}
            onClick={() => onChange(tab.id)}
            className={cn(
              // Icon tabs stay a thin row (the full-width flex button is a
              // wide tap target even when short); text tabs keep more height.
              'flex flex-1 items-center justify-center rounded-md font-medium transition-colors duration-100',
              Icon ? 'h-7' : 'h-7 text-xs pointer-coarse:h-9',
              tab.id === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            {Icon ? <Icon className="size-4" /> : tab.label}
          </button>
        );
      })}
    </div>
  );
}
