import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  // The focusable element with the slider role is the THUMB, so the name
  // has to land there — on the root it reads as an anonymous slider.
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full data-vertical:h-full data-vertical:w-1"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {/*
          The one control that paints the ring colour AT REST and ON HOVER:
          `border-ring` is the thumb's own 1px edge, and `ring-ring` fills
          the hover and active halos, not only the focus one. So the token
          placed by measuring the focus ring moves this too, and it is a
          visible change, not a neutral one. On #/settings the resting edge
          goes rgb(161) to rgb(125) in light (2.58:1 to 4.12:1 against the
          page) and rgb(115) to rgb(146) in dark (3.78:1 to 5.76:1), and the
          hover halo stops being a wash: 1.54:1 to 4.12:1 light, 1.87:1 to
          5.76:1 dark. Both read as clearer, and both were argued for on the
          focus ring's evidence rather than their own. The pixel grid cannot
          settle it either way: the only thumbs on a grid route sit at
          y ~2335 on #/settings, far below the 900px viewport.
        */}
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            aria-label={ariaLabel}
            className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3 disabled:pointer-events-none disabled:opacity-50"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
