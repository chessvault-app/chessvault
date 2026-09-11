import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { useRef } from 'react';

/**
 * Choosing a file, in the one place that knows how.
 *
 * Six windows take a file, and five of them had written out the same
 * markup by hand: a `<label>` wrapping a hidden `<input type=file>`, its
 * own change handler, its own answer to whether the input is cleared
 * afterwards. Five copies of one idiom is how a rule ends up true of three
 * of them, and two rules had already gone that way: the clearing, and the
 * keyboard.
 *
 * The keyboard is the one that mattered. `display:none` takes an input out
 * of the tab order and a `<label>` cannot hold focus, so those five boxes
 * answered a pointer and a dropped file and nothing else: Tab walked
 * straight past them, and the PGN upload window, which is nothing BUT its
 * box, had no focusable control at all on a phone. So the box here is a
 * real button that opens the input, which is what the studies importer's
 * "Choose file" always was and the reason its Enter worked.
 *
 * A button rather than the other fix, an `sr-only` input with the ring
 * drawn on the box through `has-[:focus-visible]`: both open the chooser
 * from Space and Enter (measured, Chromium and WebKit), but a button is
 * the one shape whose activation every browser and assistive technology
 * already agrees about, it keeps the input `display:none` (so the
 * sole-text-field rule in hooks/dialog-focus still counts the fields a
 * window really has), and it is what one of the six was already doing.
 *
 * Each window keeps what is its own: the box's classes, its drop handlers
 * (`useFileDrop` in lib/fileDrop) and what it does with the files.
 * Everything else spread onto this goes on the button, and `render` wears
 * another control's clothes where the box IS a control (the studies
 * importer's Button).
 *
 * The button's own words are its accessible name, so a screen reader hears
 * what the box asks for rather than "choose file".
 */
export function FilePicker({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  render,
  ...props
}: useRender.ComponentProps<'button'> & {
  /** The `accept` attribute, which is a filter and not a guarantee. */
  accept: string;
  multiple?: boolean;
  /** Nothing to choose right now: the window is busy with the last pick. */
  disabled?: boolean;
  /** Called with what was chosen; never with an empty list. */
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRender({
    defaultTagName: 'button',
    render,
    state: { slot: 'file-picker' },
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled,
        // The input is the chooser; the button is the way to it, from a
        // pointer or from a keypress, which is a user gesture either way.
        onClick: () => input.current?.click(),
      },
      props,
    ),
  });
  return (
    <>
      {trigger}
      <input
        ref={input}
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
    </>
  );
}
