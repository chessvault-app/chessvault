import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * A line you press to reveal what is under it.
 *
 * Extracted from the game form's "Advanced details", which was the only
 * one of these in the app until the settings page needed a second. The
 * markup is that one's, unchanged — a quiet label, a chevron that turns a
 * quarter, and `aria-expanded` on the button that owns the state.
 *
 * NOT a Base UI primitive, and deliberately: the registry rule this file
 * sits under is about overlays — a hand-rolled popover, menu, dialog or
 * tooltip beside a Base UI one is two focus stacks on one page. A
 * disclosure opens nothing over anything. It reveals siblings in the
 * flow, keeps focus exactly where it was, and has no stack to be second
 * in.
 *
 * The button and the revealed content are SIBLINGS, not a wrapper around
 * a box: both call sites live in a flex column and take their spacing
 * from it, so a div here would add a gap neither of them wants.
 *
 * Controlled, because both callers have a reason to open it themselves —
 * the game form opens when a pasted PGN fills something in, so that what
 * was read off the text is seen rather than taken on trust.
 */
export function Disclosure({
  label,
  open,
  onToggle,
  children,
  className,
}: {
  /** English, as the key t() looks up — translated here, like PanelHeader's. */
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          'text-muted-foreground hover:text-foreground flex items-center gap-1.5 self-start text-sm transition-colors duration-100',
          className,
        )}
      >
        <ChevronRight
          className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')}
        />
        {t(label)}
      </button>
      {open && children}
    </>
  );
}
