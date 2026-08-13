import { useState } from 'react';
import type { DragEvent } from 'react';

/**
 * Drop a file on it, wherever "it" is.
 *
 * Every place in the app that takes a file — a PGN, a book's PDF, a photo
 * of a board — is a `<label>` wrapping a hidden `<input type=file>`, which
 * gives click-to-choose and nothing else. On a desktop the obvious gesture
 * is to drag the file onto the window, and until now two of those six
 * places implemented it, separately, and the other four silently did
 * nothing: the browser's default is to NAVIGATE to the dropped file, so
 * dropping a PGN on the import window threw the app away and displayed
 * the file instead. That is the worst possible answer.
 *
 * So the behaviour lives here once, including the parts each ad-hoc copy
 * got right or wrong:
 *
 * - `dragleave` fires on every hop between child elements, so the
 *   highlight has to check that the pointer really left the zone rather
 *   than moved onto something inside it.
 * - `dragover` must be cancelled on every event, not just the first, or
 *   the drop is refused.
 * - A drop with nothing acceptable in it is answered, not ignored — a
 *   zone that swallows the wrong file looks broken.
 */
export function useFileDrop({
  accept,
  onFiles,
  onReject,
  disabled = false,
}: {
  /** True for a file this zone can take. */
  accept: (file: File) => boolean;
  onFiles: (files: File[]) => void;
  /** Told when a drop contained nothing acceptable. */
  onReject?: () => void;
  disabled?: boolean;
}): {
  /** A file is over the zone right now — for the highlight. */
  dragging: boolean;
  handlers: {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
} {
  const [dragging, setDragging] = useState(false);

  return {
    dragging,
    handlers: {
      onDragOver: (e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return;
        // Every time: cancelling only the first dragover leaves the drop
        // itself unhandled, and the browser navigates to the file.
        e.preventDefault();
        setDragging(true);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files].filter(accept);
        if (files.length > 0) onFiles(files);
        else onReject?.();
      },
    },
  };
}

/** Matches by extension as well as MIME: a .pgn is usually text/plain, and
    often has no type at all when it comes from an archive manager. */
export const byExtension =
  (...extensions: string[]) =>
  (file: File): boolean =>
    extensions.some((ext) => file.name.toLowerCase().endsWith(ext));

/** Anything the browser calls an image. */
export const isImage = (file: File): boolean => file.type.startsWith('image/');
