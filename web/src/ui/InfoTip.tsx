import { HelpCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
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
        // 20px of ? beside a title, and on a touch screen that ? is the
        // only way to the sheet — the one pointer that cannot hover is
        // the one that had the smallest target. The mark stays 20px
        // (it sits inline against a label and would shove it), and the
        // invisible inset takes the thumb's target to 44px. Anchored on
        // the button, which is safe: the popover hangs off the wrapper.
        className={cn(
          'text-subtle hover:text-fg relative grid size-5 place-items-center rounded-full transition-colors duration-100',
          'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
        )}
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
            'shadow-pop'
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
