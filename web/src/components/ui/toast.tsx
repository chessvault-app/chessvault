/**
 * shadcn's Toast (Base UI), as the registry writes it for base-nova, with
 * this app's physics on top:
 *
 * - On a phone the viewport sits above the bottom bar, at the height the
 *   Fab floats (4.5rem plus the home indicator), so a toast never lands
 *   on the page's controls.
 * - The viewport's region is named in the app's language: Base UI's own
 *   default is "Notifications" in English on every page.
 * - The close button's name is the dictionary's Close.
 *
 * The action and the close are the app's own Button (outline sm, ghost
 * icon-sm), so they take the radius ladder and the coarse-pointer sizes
 * every other control does. This replaced sonner (0.9.0): its buttons
 * were hard-coded to 4px corners and 24px, its X hung off the card's
 * top-left corner, and it was the one overlay in the app not on Base UI.
 */
import * as React from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n"

import { Button } from "@/components/ui/button"
import { XIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const toast = ToastPrimitive.createToastManager()

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed inset-x-4 bottom-(--toast-clear) z-50 mx-auto w-auto max-w-sm outline-none sm:right-4 sm:left-auto sm:mx-0 sm:w-full",
        // --toast-clear is the gap under the viewport, and the distance a
        // toast slides (plus its own height) to enter and leave: the
        // registry's 150% assumed the card sits 1rem off the edge, and on
        // a phone, held above the bottom bar, that left a third of the
        // card parked over the bar until the transition ended (measured:
        // 35px of 74 still showing for the last 300ms of an undo).
        "[--toast-clear:1rem]",
        // Above the phone's bottom bar, where the Fab floats (components/fab).
        "max-md:[--toast-clear:calc(4.5rem+env(safe-area-inset-bottom))]",
        className
      )}
      {...props}
    />
  )
}

/**
 * The screen the toasts are drawn on, and the app's own: the registry
 * ships the viewport alone.
 *
 * A phone's page change is a View Transition (lib/router), which paints
 * the whole page as two snapshots while the live DOM is hidden. A fixed
 * toast is part of that page, so it was captured with it and dragged
 * across the screen by the slide: leaving a game for the games list, the
 * review offer travelled 390px to the right with the page it was raised
 * over and was gone by the time the live one came back (measured on the
 * demo, 390x844 Chromium, back out of a game: the toast rode the pop
 * from x 16 to off the right edge, while the live one had already slid
 * its 146px down unseen).
 *
 * Naming this layer lifts it out of the page's snapshot into one of its
 * own, which index.css then holds still and live (`::view-transition-*
 * (toasts)`), so a toast leaves the way a toast leaves: straight down,
 * where it stands. The name is only taken while a toast exists (the
 * `:has` there), so a page change with nothing to show costs no extra
 * snapshot. The layer is its own box and not the viewport's, which is a
 * zero-height strip: named, that one captured nothing and the toast
 * blinked out at the transition's first frame instead of leaving.
 */
function ToastLayer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toast-layer"
      className={cn("pointer-events-none fixed inset-0 z-50", className)}
      {...props}
    />
  )
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-2xl border border-window-ring bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(calc(100%_+_var(--toast-clear)))]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(calc(100%_+_var(--toast-clear)))]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)_+_calc(100%_+_var(--toast-clear))))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)_+_calc(100%_+_var(--toast-clear))))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className
      )}
      {...props}
    />
  )
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-3 overflow-hidden p-4 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ToastAction({
  className,
  // secondary, not the registry's outline: on a tonal page the secondary
  // action is a fill (iOS's gray button, Material's filled tonal), and
  // strokes belong to fields. The band under the move list draws the
  // same button (engine/ReviewStrip).
  render = <Button variant="secondary" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  )
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={t('Close')}
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <XIcon aria-hidden="true" />
      )}
    </ToastPrimitive.Close>
  )
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null

  if (type === "success") {
    icon = (
      <CircleCheckIcon aria-hidden="true" />
    )
  }

  if (type === "info") {
    icon = (
      <InfoIcon aria-hidden="true" />
    )
  }

  if (type === "warning") {
    icon = (
      <TriangleAlertIcon aria-hidden="true" />
    )
  }

  if (type === "error") {
    icon = (
      <OctagonXIcon className="text-destructive" aria-hidden="true" />
    )
  }

  if (type === "loading") {
    icon = (
      <Loader2Icon className="animate-spin" aria-hidden="true" />
    )
  }

  if (!icon) {
    return null
  }

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <ToastTitle />
          <ToastDescription />
        </div>
        <ToastAction />
        <ToastClose />
      </ToastContent>
    </Toast>
  ))
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastLayer>
          <ToastViewport aria-label={t('Notifications')}>
            <ToastList />
          </ToastViewport>
        </ToastLayer>
      </ToastPortal>
    </ToastProvider>
  )
}

const createToastManager = ToastPrimitive.createToastManager
const useToastManager = ToastPrimitive.useToastManager

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
}
