import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed p-6 text-center text-balance",
        className
      )}
      {...props}
    />
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  )
}

// iOS draws an unavailable state as a large muted symbol on the page
// itself (ContentUnavailableView), not as a filled tile with a small
// glyph in it: the tile is the registry's (and Material's) shape, and on
// an iPhone it read as a badge nobody could press. So on iOS the tile's
// fill and its rounding go, the box grows to 40px and the symbol fills
// it in the muted ink the description below is already in.
//
// The symbol is drawn at 1.4 rather than lucide's 2, because the stroke
// does not scale optically the way the symbol set this imitates does.
// Lucide is one 24-unit grid at stroke-width 2, so the box alone decides
// the ink: at 48px it measured 4px of stroke against 1px at the
// registry's 16, a mark that was large and HEAVY where iOS draws one
// that is large and light. 40 with a lighter stroke is that mark; the
// two numbers move together and neither is read on its own.
//
// The `!` is not emphasis: `ios:` is a zero-specificity `:where()`
// variant, so these tie with the classes they replace and would be
// settled by the order Tailwind happened to emit them in. The stroke
// needs none, having nothing to tie with: it beats the svg's own
// presentational attribute at any specificity. Nothing else about the
// state changes, on any platform: same copy, same title, same press.
const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-']):not([class*='glyph'])]:size-4 ios:size-10! ios:rounded-none! ios:bg-transparent! ios:text-muted-foreground! ios:[&_svg:not([class*='size-']):not([class*='glyph'])]:size-10! ios:[&_svg:not([class*='size-']):not([class*='glyph'])]:[stroke-width:1.4]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn(
        "font-heading text-base font-medium tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance",
        className
      )}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}
