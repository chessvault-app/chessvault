import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/**
 * Destructive-action confirmation, the anchored-popover way: the trigger
 * is a stable icon that never changes size — the question appears in a
 * layer beside it (same fixed-position machinery as ui/Select, so it
 * escapes overflow-hidden panels) with an explicit red confirm and a
 * cancel. Replaces the old morphing two-step buttons, whose in-place
 * expansion rearranged everything around them.
 */
export function ConfirmPopover({
  icon: Icon,
  label,
  triggerTitle,
  triggerVariant = 'ghost',
  triggerClassName,
  question,
  confirmLabel,
  disabled = false,
  onConfirm,
}: {
  icon: LucideIcon;
  /** Optional trigger text next to the icon (icon-only when omitted). */
  label?: string;
  triggerTitle: string;
  triggerVariant?: 'ghost' | 'secondary';
  triggerClassName?: string;
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open) return;
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
        variant={triggerVariant}
        size={label ? 'sm' : 'icon-sm'}
        title={triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        // A hover-revealed trigger must not fade away while its popover is up.
        className={cn(triggerClassName, open && 'opacity-100')}
        onClick={(e) => {
          e.stopPropagation();
          setRect(trigger.current?.getBoundingClientRect() ?? null);
          setOpen((v) => !v);
        }}
      >
        <Icon className="size-3.5" />
        {label}
      </Button>

      {open && rect && (
        <div
          ref={pop}
          role="dialog"
          aria-label={question}
          style={{
            position: 'fixed',
            top: rect.bottom + 6,
            right: Math.max(8, window.innerWidth - rect.right),
          }}
          className={cn(
            'border-line bg-surface z-50 flex w-max max-w-72 flex-col gap-2 rounded-lg border p-3',
            'shadow-[var(--shadow-pop)]',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-fg text-xs font-medium">{question}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              <Icon className="size-3.5" />
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
