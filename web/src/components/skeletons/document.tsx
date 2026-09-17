import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { INERT, InertDocumentTools, InertEditButton, Loading } from './primitives';

/**
 * A written document: the note's sticky header, then paragraphs of ragged
 * lines where its prose goes.
 *
 * The column and the header carry the note page's own classes rather than
 * an approximation of them. It used to be p-6 and gap-6 with a single bar
 * for a title, against a page whose header is a 59px block over a rule
 * with the document under it — so the words landed roughly a header lower
 * than where they had been drawn.
 */
export function SkeletonDocument({ className }: { className?: string }) {
  /**
   * The note editor's own vertical rhythm, expressed in em against the
   * editor's font size rather than in the px it used to resolve to. The
   * numbers are .note-editor's own: blocks 0.6em apart, body on a 1.7
   * line, h1 at 1.5em and h2 at 1.25em each with a 1em margin of their
   * own. In px they had to be recomputed by hand every time the type
   * scale moved, and the move that just happened proved they would not be.
   *
   * The bars used to be evenly spaced from the very top of the box, so the
   * prose arrived about a line below where the placeholder had drawn it —
   * the first block's own margin is what the box does not have.
   */
  const para = (lines: string[], key: string) => (
    <div key={key} className="mt-[0.6em]">
      {lines.map((w, i) => (
        <div key={i} className="flex h-[1.7em] items-center">
          <Skeleton className={cn('h-3', w)} />
        </div>
      ))}
    </div>
  );
  return (
    <Loading
      className={cn(
        'mx-auto flex h-full max-w-3xl flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+var(--safe-b))] md:px-6 md:pb-6',
        className,
      )}
    >
      {/* The header the note keeps at the top of its column: a 28px row of
          back, name, edit and save, over the rule under it. */}
      {/* The bottom padding follows the palette below, as the real header
          does: pb-3 where the note opens read-only, pb-1.5 where it opens
          editable and the palette sits against the rule.

          A note does NOT open read-only, which is what this said and was
          measured against ("59px against the real 65"). It opens editable
          on any viewport from md with a fine pointer (NoteView,
          `opensEditable`), which is every desktop — so the settled header
          carried a 28px palette row and its gap that nothing here stood
          in for, and the prose landed about 35px low on every desktop
          note open. Photographed on the demo. Written as the same rule in
          classes rather than read through matchMedia: this is a
          placeholder, and a media query it has to subscribe to is a
          render it has to do twice. */}
      <div className="-mx-4 flex shrink-0 flex-col gap-3 border-b border-transparent px-4 pb-3 pt-4 md:-mx-6 md:px-6 md:pt-6 md:pointer-fine:pb-1.5">
        {/* pointer-coarse:h-9, like every control the row holds: the back
            chevron and the edit button are icon-sm and sm, which grow to
            36px under a thumb. Pinned at h-7 the row was a button short on
            every phone. */}
        {/* The header's controls are the real ones, inert (NoteView's
            header): the back chevron, DocumentTools' buttons and Edit are
            the same on every note, so their boxes are not a guess. Only
            the name and the save state wait. */}
        <div className="flex h-7 shrink-0 items-center gap-2 pointer-coarse:h-9" data-ground="">
          <Button variant="ghost" size="icon-sm" {...INERT}>
            <ChevronLeft className="glyph" />
          </Button>
          <Skeleton className="h-3.5 min-w-0 flex-1" />
          <InertDocumentTools />
          <InertEditButton />
          <Skeleton className="h-2.5 w-10 shrink-0" />
        </div>
        {/* EditorPalette's row, on the same rule: ten icon-sm buttons at
            gap-0.5, drawn only where the note will open editable. The
            real ones are the editor's commands and cannot be held inert
            usefully, so these are the boxes alone. */}
        <div
          aria-hidden
          className="hidden shrink-0 items-center gap-0.5 md:pointer-fine:flex"
        >
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="size-7 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
      {/* min-h-[60vh] is .note-editor's own floor (index.css): a short
          note is still 60vh of editable box, so the column's scroll
          extent starts there rather than wherever the bars run out. */}
      <div className="text-base min-h-[60vh] flex-1">
        <div className="mt-[1.5em] flex h-[2.55em] items-center">
          <Skeleton className="h-5 w-2/5" />
        </div>
        {para(['w-full', 'w-11/12', 'w-4/5'], 'a')}
        <div className="mt-[1.25em] flex h-[2.125em] items-center">
          <Skeleton className="h-4 w-1/3" />
        </div>
        {para(['w-full', 'w-full', 'w-3/5'], 'b')}
        {para(['w-10/12', 'w-full', 'w-2/3'], 'c')}
      </div>
    </Loading>
  );
}
