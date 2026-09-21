import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

/**
 * iOS has no radio button ("Platform-specific design",
 * docs/design-principles.md). One of many is a grouped list: rows
 * separated by a hairline inside one inset card, the chosen row marked by
 * a trailing checkmark in the tint and nothing leading it.
 *
 * Both halves are drawn here rather than at the two call sites, because
 * both of them already lay a row out the same way — a flex row whose text
 * grows and whose RadioGroupItem is the first child. The group turns
 * itself into the card and gives each direct child the row's padding and
 * its hairline; the item moves to the end of that row and swaps its dot
 * for the checkmark. Nothing changes on Android or on a desktop.
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn(
        "grid w-full gap-2",
        "ios:gap-0 ios:overflow-hidden ios:rounded-xl ios:bg-card ios:ring-1 ios:ring-card-ring",
        // border-border and not the card ring, for the reason the More
        // page's grouped list gives: the ring is transparent on the light
        // page at rest, and a list with no line between its rows reads as
        // one tall card. 44px is the platform's row floor.
        "ios:[&>*]:min-h-11 ios:[&>*]:px-4 ios:[&>*]:py-2.5 ios:[&>*]:border-border ios:[&>*:not(:first-child)]:border-t",
        className
      )}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input outline-none group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:inset-y-[calc((100%-2.25rem)/2)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary",
        // iOS: no leading dot at all. The control keeps its role, its
        // focus ring and its hit box and becomes the row's trailing
        // checkmark: last in the flex row, pushed to the end, drawn in the
        // tint with no ring and no fill of its own.
        "ios:order-last ios:ml-auto ios:size-[22px] ios:self-center ios:border-transparent ios:bg-transparent ios:text-primary ios:data-checked:border-transparent ios:data-checked:bg-transparent ios:data-checked:text-primary dark:ios:bg-transparent dark:ios:data-checked:bg-transparent",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="flex size-4 items-center justify-center ios:size-[22px]"
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground ios:hidden" />
        <CheckIcon className="hidden size-[22px] ios:block" strokeWidth={2.5} />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
