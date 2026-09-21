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

/**
 * Android draws Material 3 Expressive's loading indicator, not a rotating
 * arc: one filled shape in the primary colour that turns while it morphs
 * through a short sequence of soft polygons ("Platform-specific design",
 * docs/design-principles.md). This is the app's own drawing of that idea
 * — five shapes generated from one radial function, in `currentColor`,
 * nothing copied from Google or from a third-party asset. The shapes and
 * the reason they can interpolate at all are in styles/spinner.css; the
 * `d` here is the first of them, which is what a browser that cannot
 * animate a path keeps.
 *
 * The turn and the morph are two animations on two elements on purpose.
 * The rotation stays on the <svg>, exactly the 1s the other two drawings
 * spin at, so base.css's `[data-slot='spinner']` reduced-motion rule
 * reaches it unchanged; the morph is on the <path>, where the same block
 * can stop it without stopping the turn.
 *
 * viewBox 0 0 24 24, so every caller's `size-*`, `glyph` or `glyph-sm`
 * sizes it exactly as it sized the arc.
 */
function AndroidSpinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="currentColor"
      role="status"
      aria-label={t('Loading')}
      className={cn("size-4 animate-spin", className)}
      {...props}
    >
      <path data-slot="spinner-shape" d="M23 12C23 12.88 22.38 13.89 21.84 14.64C21.31 15.39 20.33 15.85 19.76 16.48C19.2 17.12 18.89 17.7 18.46 18.46C18.04 19.22 17.83 20.37 17.23 21.05C16.62 21.74 15.71 22.45 14.84 22.59C13.97 22.73 12.85 22.25 12 21.91C11.15 21.57 10.49 20.86 9.71 20.56C8.93 20.26 8.19 20.28 7.32 20.11C6.44 19.94 5.23 20 4.45 19.55C3.66 19.11 2.89 18.27 2.6 17.43C2.31 16.58 2.6 15.4 2.7 14.49C2.8 13.59 3.18 12.83 3.18 12C3.18 11.17 2.8 10.41 2.7 9.51C2.6 8.6 2.31 7.42 2.6 6.57C2.89 5.73 3.66 4.89 4.45 4.45C5.23 4 6.44 4.06 7.32 3.89C8.19 3.72 8.93 3.74 9.71 3.44C10.49 3.14 11.15 2.43 12 2.09C12.85 1.75 13.97 1.27 14.84 1.41C15.71 1.55 16.62 2.26 17.23 2.95C17.83 3.63 18.04 4.78 18.46 5.54C18.89 6.3 19.2 6.88 19.76 7.52C20.33 8.15 21.31 8.61 21.84 9.36C22.38 10.11 23 11.12 23 12Z" />
    </svg>
  )
}

/**
 * Which Android call sites get that drawing: the ones big enough to read
 * as a shape. At the default size-4 the indicator is 16px, and five
 * polygons taking turns inside 16px is not a shape changing, it is an
 * edge wobbling — the arc says the same thing more quietly, and about
 * two thirds of the app's thirty-odd spinners are that size, sat inside
 * a button or at the end of a row beside text. So the morph is kept for
 * size-5 and up: the three standing ones (a PDF page rendering, a book
 * upload, a reference database building) and anything later asked for at
 * that size.
 *
 * The rung is read off the caller's own class rather than passed as a
 * prop because the size already is a class at every one of those call
 * sites, and a second way to say it would be a second thing to keep in
 * step. Anything this cannot read — no class, a `glyph` rung, an
 * arbitrary `size-[2rem]` — takes the arc, which is what every one of
 * them draws today.
 */
function morphs(className: string | undefined): boolean {
  const rung = /(?:^|\s)size-(\d+)(?:\s|$)/.exec(className ?? '')
  return rung !== null && Number(rung[1]) >= 5
}

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  // Chosen here rather than drawn three times and hidden by `ios:` and
  // `android:`. Every drawing in the DOM would triple thirty call sites'
  // markup for a control that is eight elements on iOS, and would put
  // three `role="status"` nodes in the tree, two of which an assistive
  // technology can still reach while they are only visually hidden. The
  // platform is decided once before the first render and never changes
  // (lib/platform.ts), so this read is constant for the session and the
  // React Compiler has nothing to invalidate on.
  if (currentPlatform() === 'ios') return <IosSpinner className={className} {...props} />
  if (currentPlatform() === 'android' && morphs(className))
    return <AndroidSpinner className={className} {...props} />
  return (
    // The registry hard-codes aria-label="Loading"; this app is translated,
    // so the default name goes through t(). A caller's own aria-label wins.
    <Loader2Icon data-slot="spinner" role="status" aria-label={t('Loading')} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
