import type { ComponentProps } from 'react';

/**
 * Choosing a file, in the one place that knows how.
 *
 * Five windows take a file, and each had written the same thing out by
 * hand: a `<label>` wrapping a hidden `<input type=file>`, its own change
 * handler, its own answer to whether the input is cleared afterwards. The
 * same shape five times is how a rule ends up true of three of them — which
 * is exactly what had happened to the clearing.
 *
 * So the input lives here once, and each window keeps what is its own: the
 * box's look, its drop handlers (`useFileDrop` in lib/fileDrop), and what to
 * do with the files. Everything spread onto this goes on the box.
 */
export function FilePicker({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  children,
  ...props
}: Omit<ComponentProps<'label'>, 'onChange'> & {
  /** The `accept` attribute, which is a filter and not a guarantee. */
  accept: string;
  multiple?: boolean;
  /** Nothing to choose right now: the window is busy with the last pick. */
  disabled?: boolean;
  /** Called with what was chosen; never with an empty list. */
  onFiles: (files: File[]) => void;
}) {
  return (
    <label {...props}>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          // Cleared, so the same file can be chosen again: the browser
          // fires no change event when a pick repeats what the input
          // already holds, and every one of these boxes can outlive a
          // pick it refused.
          e.target.value = '';
          if (files.length > 0) onFiles(files);
        }}
      />
      {children}
    </label>
  );
}
