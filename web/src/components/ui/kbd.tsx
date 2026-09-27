import { cn } from "@/lib/utils"

/*
 * The corner is the small text tag's, `--radius-chip` (tokens.css), which
 * Badge's chip and a note's inline code read too, where the registry draws
 * `rounded-sm`. The registry's corner and this one agree at Square, Small
 * and Default (0 / 2.88 / 6px); at Large the registry's 9.6px on this 20px
 * key is 0.4px short of a pill, and the shared value stops at 6.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-(--radius-chip) bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background dark:in-data-[slot=tooltip-content]:bg-background/10 [&_svg:not([class*='size-']):not([class*='glyph'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
