import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * Destructive-action confirmation: a stable icon trigger, and the
 * question in the app's own window.
 *
 * It used to be an anchored popover — position-fixed off the trigger's
 * measured rect, portalled to the body, dismissed by an outside
 * mousedown, a touchstart, Escape, a scroll, a resize, or the pointer
 * leaving it for 350ms. All of that to reproduce, badly, what Sheet
 * already is: a centred card on a desktop, a bottom sheet on a phone,
 * with the drag, the scrim and the Escape every other window here has.
 * It also meant the one question in the app that should be hardest to
 * dismiss by accident was the easiest — a stray scroll took it away.
 *
 * Same props, so every call site is unchanged; only what appears when
 * you press it is different.
 *
 * Every string it is given is translated HERE. Each of these props is
 * user-facing by definition — there is no such thing as an internal
 * confirmation question — and asking the call sites to remember t() on
 * four props each is asking for the English dialog this shipped with.
 * Callers interpolating a name still call t() themselves; translating an
 * already-translated string is a no-op.
 */
export function ConfirmSheet({
  icon: Icon,
  label,
  triggerTitle,
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
  triggerClassName?: string;
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size={label ? 'sm' : 'icon-sm'}
        title={t(triggerTitle)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        // A hover-revealed trigger must not fade away while its question is up.
        className={cn(triggerClassName, open && 'opacity-100')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon className="size-3.5" />
        {label && t(label)}
      </Button>

      {/* The verb titles the window and the question is its body: Sheet
          draws its label in the quiet style every other window's title
          uses, which is not where a question you must answer belongs. */}
      {open && (
        <Sheet label={t(confirmLabel)} onClose={() => setOpen(false)} className="gap-3">
          <p className="text-fg text-sm">{t(question)}</p>
          {/* Cancel first, then the destructive one — the way out is the
              thing nearest to hand, and the button that cannot be undone
              is the one you have to reach for. */}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('Cancel')}
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
              {t(confirmLabel)}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
