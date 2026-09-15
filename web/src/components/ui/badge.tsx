import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border border-transparent px-2 py-0.5 text-xs max-md:type-row-sub font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        /*
         * The OPAQUE tint, not the registry's `bg-destructive/10`. A badge
         * sits in rows that fill on hover, and index.css records the
         * measurement that put these tokens there: the translucent wash
         * fell to 3.58:1 in light and 3.02:1 in dark once --accent arrived
         * under it. `--destructive-tint` is mixed against the card and
         * cannot be shone through. `good` is its twin.
         */
        destructive:
          "bg-destructive-tint text-destructive focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        good: "bg-good-tint text-good",
        /*
         * The quiet chip: a tag, a count, a verdict with nothing to say.
         * --muted and not --accent, which is a rung above it and means
         * selected or pressed (index.css). The tablebase's neutral verdict
         * drew --accent at rest, which is that rung spent on nothing.
         */
        muted: "bg-muted text-muted-foreground",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /*
       * DESIGN.md names two of these, and the app had been drawing the
       * second one by hand seven times over: a badge is a true pill
       * (`rounded-4xl`), a CHIP is the small-cornered tag that carries a
       * code, a theme or a verdict. The chip keeps the corner knob
       * (`rounded-sm`) rather than DESIGN.md's fixed 4px, which nothing in
       * the app has ever actually used, and takes the tighter side padding
       * all four hand-rolled chips had agreed on.
       */
      shape: {
        pill: "rounded-4xl",
        chip: "rounded-sm px-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "pill",
    },
  }
)

function Badge({
  className,
  variant = "default",
  shape = "pill",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, shape }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      shape,
    },
  })
}

export { Badge, badgeVariants }
