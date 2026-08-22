import { HelpCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';

/**
 * A small ? beside a title, holding the sentence that used to sit in the
 * page's own body — explanation on demand instead of a paragraph every
 * visit re-reads. A pointer that can hover gets a tooltip on hover (and
 * on keyboard focus) — shadcn's Tooltip, which opens on neither on a
 * touch screen; a touch screen gets the app's bottom sheet on tap,
 * because touch has no hover and a popover it cannot dismiss is a trap.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [sheet, setSheet] = useState(false);
  const coarse = (): boolean => window.matchMedia('(pointer: coarse)').matches;

  return (
    <span className="inline-flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t(label)}
            // 20px of ? beside a title, and on a touch screen that ? is the
            // only way to the sheet — the one pointer that cannot hover is
            // the one that had the smallest target. The mark stays 20px
            // (it sits inline against a label and would shove it), and the
            // invisible inset takes the thumb's target to 44px.
            className={cn(
              'text-subtle hover:text-foreground relative grid size-5 place-items-center rounded-full transition-colors duration-100',
              'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
            )}
            onClick={() => {
              if (coarse()) setSheet(true);
            }}
          >
            <HelpCircle className="size-3.5" />
          </button>
        </TooltipTrigger>
        {/* A sentence, not a label: wider and set as prose. */}
        <TooltipContent
          align="start"
          className="w-64 max-w-64 rounded-lg p-3 text-sm font-normal normal-case leading-relaxed tracking-normal"
        >
          {children}
        </TooltipContent>
      </Tooltip>

      {sheet && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSheet(false);
          }}
        >
          <DialogContent size="sm" title={label}>
            <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
          </DialogContent>
        </Dialog>
      )}
    </span>
  );
}
