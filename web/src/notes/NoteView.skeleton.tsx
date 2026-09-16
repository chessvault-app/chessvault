import { SkeletonDocument } from '@/components/skeletons';

/**
 * A note while it is arriving, whichever of its two waits is running.
 *
 * NoteView is a lazy route of its own, nested inside the Notes chunk,
 * because the editor is TipTap and ProseMirror — by a distance the
 * heaviest thing in the app, and the list needs none of it. It carried
 * no outline at all, so opening a note cold drew this picture from the
 * shelf's chunk, then NOTHING for as long as the editor took, then this
 * picture again once NoteView could draw its own data wait. The prose
 * appeared, disappeared and reappeared.
 *
 * One module, drawn by lib/lazyRoute for the editor's chunk and by
 * NoteView for the document's fetch, so the column stands still from the
 * first frame to the last.
 *
 * SkeletonDocument is the note's own column, scrolling and all, so it
 * needs no wrapper of its own — one used to add a second scroller around
 * a box that already had one. The `h-full` box around it is the one
 * NoteView puts there.
 */
export default function NoteOutline() {
  return (
    <div className="h-full">
      <SkeletonDocument />
    </div>
  );
}
