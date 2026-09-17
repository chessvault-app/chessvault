import { useState } from 'react';
import { History, Link, MoreHorizontal, Pencil, Tags } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The box a placeholder and the content it stands for share: once a
 * skeleton has been shown, what replaces it fades in (150ms, phones
 * only) instead of popping. Both platforms' guidance says the same:
 * placeholders first, then a quick fade on top of them, never a cut. A
 * load that finished inside `useSlowLoad`'s delay never showed a
 * skeleton and mounts its content the way it always did.
 *
 * `pending` is whether the placeholder is on screen RIGHT NOW: the
 * slow-load flag AND the content not yet here. The class is off while
 * it is true and on once it is false, so a second wait (a refresh)
 * fades its arrival again. Nothing is keyed, so the content keeps its
 * state.
 *
 * Not the slow-load flag alone. That flag stays up for its minimum
 * stay (useSlowLoad's 400ms) after the content has landed, while the
 * three shelves that use this draw their content the moment it lands;
 * the class then arrived on a list that had been on screen for a
 * third of a second, and the list blinked to transparent and faded
 * back in. Measured on the demo's studies shelf in phone-emulated
 * Chromium, tapping the Studies tab from home: the list drew at 147ms,
 * went to opacity 0 at 504ms and was back at 648ms. Gated on the
 * placeholder itself, the fade rides the commit that mounts the
 * content, which is the only frame it belongs on.
 */
export function Arrival({
  pending,
  children,
  className,
}: {
  pending: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  // Whether a placeholder has ever been on screen here: state adjusted
  // during render (React's own pattern for a value that follows a prop)
  // rather than a ref written in render, which the React Compiler refuses.
  const [shown, setShown] = useState(false);
  if (pending && !shown) setShown(true);
  return (
    <div className={cn(!pending && shown && 'max-sm:animate-in max-sm:fade-in-0 max-sm:duration-150', className)}>
      {children}
    </div>
  );
}

/** Wrapper that announces itself to screen readers exactly once. */
export function Loading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-label={t('Loading')} aria-live="polite">
      {children}
    </div>
  );
}

/**
 * What a real control wears to stand still inside a placeholder: no
 * focus stop, and disabled where the primitive knows the word. A control
 * whose shape is known before the data is (a header's Start button, the
 * filter row's selects, the back chevron) is drawn as ITSELF rather than
 * as a grey box of its size: the box was a second statement of the
 * control's geometry, and every one of them had to be re-measured when
 * the control moved (the comments below record several such
 * re-measurements). The real thing cannot disagree with itself.
 *
 * `aria-hidden` too: the Loading wrapper is what a screen reader hears,
 * and a row of disabled, unnamed buttons under it adds nothing but noise.
 */
export const INERT = { disabled: true, tabIndex: -1, 'aria-hidden': true } as const;

/**
 * `inert` for a control that cannot take `disabled` all the way down: the
 * Select's phone face is a plain button that opens a sheet and does not
 * read the root's `disabled`. The subtree is neither focusable nor
 * clickable nor read, which is what a placeholder's control should be.
 * `contents`, so the wrapper adds no box to the row.
 */
export function Inert({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span inert className={cn('contents', className)}>
      {children}
    </span>
  );
}

/**
 * The header's Edit button, as StudyView and NoteView draw it: secondary
 * `sm`, the pencil, and the word from md up. One place, because two
 * skeletons carry the same row.
 */
export function InertEditButton() {
  return (
    <Button variant="secondary" size="sm" className="shrink-0" {...INERT}>
      <Pencil className="glyph md:mr-1" />
      <span className="max-md:hidden">{t('Edit')}</span>
    </Button>
  );
}

/**
 * DocumentTools' three ghost icon buttons from md (other names, what
 * links here, earlier versions) and its one ⋯ below it, on the same fold
 * the component itself uses (`max-md`, 47.9375rem). Drawn by class
 * rather than by the media query the real one reads, so this needs no
 * subscription; the widths agree at every breakpoint.
 */
export function InertDocumentTools() {
  return (
    <>
      <Button variant="ghost" size="icon-sm" className="shrink-0 md:hidden" {...INERT}>
        <MoreHorizontal className="glyph" />
      </Button>
      {[Tags, Link, History].map((Icon, i) => (
        <Button key={i} variant="ghost" size="icon-sm" className="shrink-0 max-md:hidden" {...INERT}>
          <Icon className="glyph" />
        </Button>
      ))}
    </>
  );
}

/**
 * The count line under a page title ("12 studies"), while the count is
 * not known. PageHeader draws that line only when given one, and every
 * shelf gave it nothing until its list had arrived: the search field and
 * every card under it then dropped 24px, the line's text-sm box, on five
 * pages at every width. One text-sm line box: 8px bar, 6px each side.
 */
export function SkeletonSubtitle() {
  return <Skeleton className="my-1.5 block h-2 w-16" />;
}

/** Ragged widths, so a list of placeholders does not read as a barcode. */
export const NAME_WIDTHS = ['w-2/5', 'w-3/5', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];
