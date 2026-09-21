import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // The registry's face, plus the indeterminate state it left out:
        // Base UI says `data-indeterminate` (the `indeterminate` prop,
        // beside `checked`), which data-checked does not match, so the
        // partial box fills like a checked one and swaps the check for a
        // dash below.
        "group/checkbox peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input transition-colors outline-none group-has-disabled/field:opacity-50 group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input after:absolute after:-inset-x-3 after:-inset-y-2 pointer-coarse:after:inset-y-[calc((100%-2.25rem)/2)] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground group-has-[:focus-visible]/field-label:data-checked:border-primary dark:data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        // iOS has no checkbox ("Platform-specific design",
        // docs/design-principles.md). A multi-select mark is a circle: a
        // hairline ring while empty, the tint with a white check inside it
        // when chosen, at 22px rather than the registry's 16. Only the box
        // changes; the role, the indicator and the indeterminate dash are
        // the same control, so the dash lands in the filled circle.
        // The hit box goes to the platform's 44px floor (the registry's
        // -inset-x-3 already puts the width at 46), which costs no layout:
        // `after` is an absolute overlay.
        "ios:size-[22px] ios:rounded-full ios:pointer-coarse:after:inset-y-[calc((100%-2.75rem)/2)]",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5 ios:[&>svg]:size-4"
      >
        <CheckIcon className="group-data-indeterminate/checkbox:hidden" />
        <MinusIcon className="hidden group-data-indeterminate/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
