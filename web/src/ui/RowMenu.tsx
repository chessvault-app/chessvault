import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface RowMenuItem {
  label: string;
  icon: LucideIcon;
  /** External link items open in the browser instead of calling back. */
  href?: string;
  /** Destructive items get the danger tint and an in-menu confirmation. */
  confirm?: string;
  onSelect?: () => void;
}

/**
 * The row overflow menu (…): folds a row's secondary actions into one
 * anchored popover — same fixed-position machinery and dismissal rules
 * as Select/ConfirmPopover (outside click, Escape, scroll, pointer
 * leave). Destructive items confirm inside the menu, popover-style.
 */
export function RowMenu({
  items,
  ariaLabel,
  triggerClassName,
}: {
  items: RowMenuItem[];
  ariaLabel: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<RowMenuItem | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleClose = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setOpen(false), 350);
  };
  const cancelClose = (): void => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  useEffect(() => cancelClose, []);
  useEffect(() => {
    if (!open) {
      setConfirming(null);
      return;
    }
    const close = (): void => setOpen(false);
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon-sm"
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(triggerClassName, open && 'opacity-100')}
        onMouseEnter={cancelClose}
        onMouseLeave={() => open && scheduleClose()}
        onClick={(e) => {
          e.stopPropagation();
          setRect(trigger.current?.getBoundingClientRect() ?? null);
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>

      {open && rect && (
        <div
          ref={pop}
          role="menu"
          aria-label={ariaLabel}
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            right: Math.max(8, window.innerWidth - rect.right),
          }}
          className={cn(
            'border-line bg-surface z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1',
            'shadow-[var(--shadow-pop)]',
          )}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={(e) => e.stopPropagation()}
        >
          {confirming ? (
            <div className="flex flex-col gap-2 p-2">
              <p className="text-fg text-xs font-medium">{confirming.confirm}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setOpen(false);
                    confirming.onSelect?.();
                  }}
                >
                  {confirming.label}
                </Button>
              </div>
            </div>
          ) : (
            items.map((item) =>
              item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className="hover:bg-surface-2 text-fg flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100"
                >
                  <item.icon className="text-subtle size-3.5" />
                  {item.label}
                </a>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (item.confirm) setConfirming(item);
                    else {
                      setOpen(false);
                      item.onSelect?.();
                    }
                  }}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-100',
                    item.confirm ? 'text-bad hover:bg-bad/10' : 'text-fg hover:bg-surface-2',
                  )}
                >
                  <item.icon className={cn('size-3.5', item.confirm ? '' : 'text-subtle')} />
                  {item.label}
                </button>
              ),
            )
          )}
        </div>
      )}
    </>
  );
}
