import { cn } from '@/lib/cn';

/**
 * The toggle switch (engine on/off, explorer on/off). Extracted from two
 * identical hand-rolled copies — one source of truth for the size, track
 * colours and knob travel.
 */
export function Switch({
  checked,
  onToggle,
  label,
  title,
  className,
}: {
  checked: boolean;
  onToggle: () => void;
  /** Accessible name — the switch renders no text of its own. */
  label: string;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      title={title}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        // The pill stays its size; the FINGER gets a bigger one. An
        // invisible inset extends the hit box to ~44px on coarse pointers
        // without growing the visual.
        'pointer-coarse:before:absolute pointer-coarse:before:-inset-3 pointer-coarse:before:content-[""]',
        checked ? 'bg-primary' : 'bg-surface-3',
        className,
      )}
    >
      {/* left-0 is load-bearing: without it the absolute knob's static
          position is not the pill's left edge and the translate overshoots. */}
      <span
        className={cn(
          'bg-knob absolute left-0 top-0.5 size-4 rounded-full shadow transition-transform duration-200',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
