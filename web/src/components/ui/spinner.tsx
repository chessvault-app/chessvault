import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"
import { t } from "@/lib/i18n"
import { currentPlatform } from "@/lib/platform"

/**
 * iOS draws an activity indicator, not a rotating arc: eight rounded
 * spokes around a circle whose opacity steps once per spoke, about one
 * turn a second ("Platform-specific design", docs/design-principles.md).
 * This is the app's own drawing of that shape — eight rects in
 * `currentColor`, opacity falling from 1 to 0.25 around the ring — and
 * nothing here is copied from Apple or from a third-party asset.
 *
 * The motion is a `steps(8)` rotation of the whole group, so the ring
 * never lands between spokes: the picture is the same eight spokes with
 * the bright one moved on. viewBox 0 0 24 24, the size Lucide's icon
 * uses, so every caller's `size-*`, `glyph` or `glyph-sm` class sizes it
 * exactly as before.
 *
 * `prefers-reduced-motion` is handled where the rest of the app handles
 * it: base.css holds `[data-slot='spinner']` at a 2s duration rather
 * than the global 0.01ms clamp, which would make an infinite animation
 * flicker. That rule reaches this drawing because the root carries the
 * same `data-slot`.
 */
function IosSpinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="currentColor"
      role="status"
      aria-label={t('Loading')}
      className={cn("size-4 animate-[spin_1s_steps(8)_infinite]", className)}
      {...props}
    >
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect
          key={i}
          x="10.8"
          y="2"
          width="2.4"
          height="6.4"
          rx="1.2"
          opacity={1 - i * 0.107}
          transform={`rotate(${i * 45} 12 12)`}
        />
      ))}
    </svg>
  )
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  // Chosen here rather than drawn twice and hidden by `ios:`. Both
  // drawings in the DOM would double thirty call sites' markup for a
  // control that is eight elements on iOS, and would put two
  // `role="status"` nodes in the tree, one of which an assistive
  // technology can still reach while it is only visually hidden. The
  // platform is decided once before the first render and never changes
  // (lib/platform.ts), so this read is constant for the session and the
  // React Compiler has nothing to invalidate on.
  if (currentPlatform() === 'ios') return <IosSpinner className={className} {...props} />
  return (
    // The registry hard-codes aria-label="Loading"; this app is translated,
    // so the default name goes through t(). A caller's own aria-label wins.
    <Loader2Icon data-slot="spinner" role="status" aria-label={t('Loading')} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
