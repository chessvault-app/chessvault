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
  triggerTone = 'quiet',
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
  /**
   * How loud the trigger is.
   *
   * `quiet` for the destructive actions that sit among ordinary row
   * controls, where a red button in every row is a page that looks
   * alarmed. `danger` for the ones that are the only destructive thing
   * on their surface — the puzzle history's reset, a book's — where the
   * colour is the warning and there is nothing for it to shout over.
   */
  triggerTone?: 'quiet' | 'danger';
  question: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={triggerTone === 'danger' ? 'danger' : 'ghost'}
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
          {/*
            Stacked, not a row, and the destructive one on top.
            A row of two puts them a thumb's width apart on a phone, which
            is the wrong geometry for a pair where one is irreversible and
            the other is the way out. Full width each, with a real gap
            between them, so the press that cannot be undone cannot be the
            one you meant to make somewhere else.
            The confirm is FILLED rather than tinted — the tinted danger
            style belongs to triggers that merely open this question — and
            it names its action ("Reset all progress"), because "Confirm"
            answers a question you have already stopped reading.
          */}
          <div className="mt-1 flex flex-col gap-2">
            <Button
              variant="danger-solid"
              size="md"
              className="w-full justify-center"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              <Icon className="size-3.5" />
              {t(confirmLabel)}
            </Button>
            <Button
              variant="secondary"
              size="md"
              className="w-full justify-center"
              onClick={() => setOpen(false)}
            >
              {t('Cancel')}
            </Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
