import { HelpCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Sheet } from './Sheet';
import { t } from '@/lib/i18n';

/**
 * A small ? beside a title, holding the sentence that used to sit in the
 * page's own body — explanation on demand instead of a paragraph every
 * visit re-reads. A pointer that can hover gets a popover on hover (and
 * on keyboard focus); a touch screen gets the app's bottom sheet on tap,
 * because touch has no hover and a popover it cannot dismiss is a trap.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  const [popover, setPopover] = useState(false);
  const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={t(label)}
        className="text-subtle hover:text-fg grid size-5 place-items-center rounded-full transition-colors duration-100"
        onMouseEnter={() => {
          if (!coarse()) setPopover(true);
        }}
        onMouseLeave={() => setPopover(false)}
        onFocus={() => {
          if (!coarse()) setPopover(true);
        }}
        onBlur={() => setPopover(false)}
        onClick={() => {
          if (coarse()) setSheet(true);
        }}
      >
        <HelpCircle className="size-3.5" />
      </button>

      {popover && (
        <span
          role="tooltip"
          className={
            'bg-surface border-line text-muted absolute left-0 top-full z-40 mt-1.5 w-64 ' +
            'rounded-lg border p-3 text-sm font-normal normal-case leading-relaxed tracking-normal ' +
            'shadow-[var(--shadow-pop)]'
          }
        >
          {children}
        </span>
      )}

      {sheet && (
        <Sheet label={t(label)} onClose={() => setSheet(false)}>
          <p className="text-muted text-sm leading-relaxed">{children}</p>
        </Sheet>
      )}
    </span>
  );
}
