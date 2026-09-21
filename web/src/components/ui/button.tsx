import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Button as ButtonPrimitive } from '@base-ui/react/button';

import { cn } from '@/lib/utils';
import { registerOpenPopup } from '@/lib/popups';
import { routeChanging } from '@/lib/router';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Button (nova), owned. The faces, sizes and focus ring are the
 * registry's; what this app adds:
 *
 *   - `destructive-solid`, the filled red for a confirmation's own confirm
 *     button (the registry's `destructive` is the tint, for the triggers
 *     that merely open the question);
 *   - `active`, the lit state of a toggle-like toolbar button — the
 *     registry's expanded look, set as `data-active` too;
 *   - bigger hit areas on coarse pointers (`pointer-coarse:`): 28px icon
 *     buttons are fine under a mouse and hostile under a thumb. Where
 *     that widens a size's padding it widens the icon side too, or the
 *     icon-side trim below would grow with it;
 *   - `sm` trims its icon side by 2px, not the registry's 4. Every other
 *     size trims exactly 2 (`xs` px-2→pl-1.5, `default`/`lg` px-2.5→pl-2);
 *     the registry's `sm` alone pairs px-2.5 with pl-1.5, and the extra
 *     2px read as an off-centre label on the filled hunt Search button
 *     (measured: icon 7px off the left edge, text 11px off the right).
 *     The coarse widths keep the same 2px trim (px-3 → pl-2.5);
 *   - `title` as a Tooltip, and as the accessible name of an icon-only
 *     button; `type="button"` unless told otherwise;
 *   - `not-[.w-full]` on the registry's icon-side padding trim. That trim
 *     is optical balance for a button that shrinks to its contents: the
 *     button gets narrower, nothing inside it moves. A button told to
 *     fill its box instead centres its contents in what the padding
 *     leaves, so the same trim pushes them off-centre by half of it —
 *     measured 2px on the repertoire Start button, and 1px on the nine
 *     `default`-size ones in the dialogs and the review rows.
 *   - `ios:active:opacity-*`, the press ("Platform-specific design",
 *     docs/design-principles.md). iOS answers a touch by dimming the
 *     whole control: 80% for a face that is already filled, 60% for the
 *     ghost, outline and link faces, which have little to dim but their
 *     ink. It is a second signal beside the coarse-pointer fill above,
 *     not a replacement for it, and it composes with the chrome circles
 *     and pills in styles/shell.css, whose own `active:opacity-70` is
 *     the more specific rule and wins on those rows. `transition-none`
 *     while pressed so the dim is instant; the release falls back to the
 *     base `transition-all`, which is the registry's own 150ms.
 *   - `android:active:before:*`, the state layer, which is how Material
 *     answers a touch: 10% of the CONTENT colour laid over whatever fill
 *     the face already has. One declaration for every variant, because
 *     `bg-current` reads each one's own ink, where the coarse-pointer
 *     fills above are seven hand-picked tints. It sits under the label
 *     (`isolate` plus `-z-10`, which paints a positioned child above the
 *     element's background and below its text) and takes the button's
 *     own radius, so it follows the shapes styles/shell.css gives the
 *     chrome. Those coarse fills are therefore gated `not-android:`: the
 *     two together were the press answered twice, a tint AND a wash. A
 *     ripple would be a third, and a second animation clock besides; the
 *     other half of Material's answer is a shape, and it is a transition
 *     on border-radius in styles/shell.css.
 *
 * There is nothing to do about a hover fill lingering after a tap:
 * Tailwind v4 already emits every `hover:` utility inside
 * `@media (hover: hover)`, so none of the fills above are reachable on a
 * touch-only iPhone (checked against the compiler, 4.3.3).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm max-md:type-row font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring active:not-aria-[haspopup]:translate-y-px ios:active:transition-none android:active:relative android:active:isolate android:active:before:absolute android:active:before:inset-0 android:active:before:-z-10 android:active:before:rounded-[inherit] android:active:before:bg-current android:active:before:opacity-10 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-']):not([class*='glyph'])]:size-4",
  {
    variants: {
      variant: {
        // hover: the opaque --primary-hover token, not the registry's 80%
        // alpha. On the near-black Neutral primary 80% alpha is still dark;
        // on a coloured accent at mid lightness it lifts the fill over the
        // white text's floor (3.88:1 measured on the Blue board's accent).
        // The token is a darker rung of the same hue in light and a
        // lighter one in dark, and the contrast knob reaches it.
        // Each hover tint again under `not-android:pointer-coarse:active:`: a finger
        // never hovers, so on a phone a pressed button showed only the
        // 1px nudge below, which reads as unresponsive. The press takes
        // the colour the mouse would have had, and nothing new.
        default:
          'bg-primary text-primary-foreground hover:bg-(--primary-hover) not-android:pointer-coarse:active:bg-(--primary-hover) ios:active:opacity-80',
        outline:
          'border-border bg-background hover:bg-muted hover:text-foreground not-android:pointer-coarse:active:bg-muted not-android:pointer-coarse:active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 not-android:dark:pointer-coarse:active:bg-input/50 ios:active:opacity-60',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] not-android:pointer-coarse:active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground ios:active:opacity-80',
        // On the page ground (an ancestor with `data-ground`, the way the
        // base classes read `data-slot=button-group`) the hover fill is a
        // rung up, --accent: in light --muted IS the ground's 97% rung, so
        // a ghost button on the page and not on a card hovered oklch(0.97)
        // on oklch(0.97) and showed nothing (measured on the book reader's
        // toolbars). The sidebar's rows hover the same ground the same way.
        // index.css now lifts --muted itself under that mark, so in light
        // this rung and the plain hover agree; the class still picks the
        // dark hover, --accent over the /50 wash.
        ghost:
          'hover:bg-muted hover:text-foreground not-android:pointer-coarse:active:bg-muted not-android:pointer-coarse:active:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50 not-android:dark:pointer-coarse:active:bg-muted/50 in-data-[ground]:hover:bg-accent not-android:in-data-[ground]:pointer-coarse:active:bg-accent in-data-[ground]:aria-expanded:bg-accent dark:in-data-[ground]:hover:bg-accent dark:not-android:in-data-[ground]:pointer-coarse:active:bg-accent ios:active:opacity-60',
        // The ink follows the fill on hover, the way the ghost and outline
        // variants above take hover:text-foreground with their hover:bg.
        // Here it is not a look but the readability floor: this variant is
        // a wash of --destructive read by --destructive, so deepening the
        // wash alone walks the label towards its own background. Measured
        // on the puzzle dashboard's Reset at 12.8px, light: 4.09:1 at rest
        // ink over the /20 hover fill, 4.91:1 with the mix. Dark's hover
        // was /30 and came to 3.97:1 — /25 keeps a step from its /20 rest
        // and reads 4.80:1. Mixed toward --foreground rather than black so
        // the same declaration darkens the light theme and lightens the
        // dark one.
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-[color-mix(in_oklch,var(--destructive),var(--foreground)_10%)] not-android:pointer-coarse:active:bg-destructive/20 not-android:pointer-coarse:active:text-[color-mix(in_oklch,var(--destructive),var(--foreground)_10%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/25 not-android:dark:pointer-coarse:active:bg-destructive/25 dark:focus-visible:ring-destructive/40 ios:active:opacity-80',
        'destructive-solid':
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 not-android:pointer-coarse:active:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 ios:active:opacity-80',
        link: 'text-primary underline-offset-4 hover:underline not-android:pointer-coarse:active:underline ios:active:opacity-60',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:not-[.w-full]:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pl-2 pointer-coarse:h-9',
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs max-md:type-row-sub in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:not-[.w-full]:pr-1.5 has-data-[icon=inline-start]:not-[.w-full]:pl-1.5 [&_svg:not([class*='size-']):not([class*='glyph'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] max-md:type-row-sub in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:not-[.w-full]:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pl-2 [&_svg:not([class*='size-']):not([class*='glyph'])]:size-3.5 pointer-coarse:h-9 pointer-coarse:px-3 has-data-[icon=inline-end]:not-[.w-full]:pointer-coarse:pr-2.5 has-data-[icon=inline-start]:not-[.w-full]:pointer-coarse:pl-2.5",
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:not-[.w-full]:pr-2 has-data-[icon=inline-start]:not-[.w-full]:pl-2',
        // Under md the glyph is a toolbar's, 20px, whatever size class it
        // carries: [&_svg] outranks the icon's own class (index.css, glyph).
        icon: 'size-8 pointer-coarse:size-11 max-md:[&_svg]:size-5',
        'icon-xs':
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-']):not([class*='glyph'])]:size-3",
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg pointer-coarse:size-9 max-md:[&_svg]:size-5',
        'icon-lg': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface ButtonProps extends ButtonPrimitive.Props, VariantProps<typeof buttonVariants> {
  /**
   * The lit state of a toggle-like button in a toolbar — the tool that is
   * selected, the panel that is open.
   *
   * (A link wearing the button's look renders the anchor itself, Base UI's
   * way: `<Button render={<a href=…/>} nativeButton={false}>…</Button>`. A
   * control that goes OUT of the app is an anchor and nothing else.)
   */
  active?: boolean;
  title?: string;
}

// Does the button say anything in text? A visible label is already the
// accessible name — and must stay it, or "click Cancel" stops working for
// voice control. Only icon-only buttons need naming by other means.
//
// Deliberately shallow: a label wrapped in a `<span>` does not count, and
// the title is stamped over it as the name. Recursing would not fix that
// site, because the usual reason for the span is a `hidden` breakpoint
// class, and a display:none label names the phone's icon button nothing.
// An icon-plus-span button with a title therefore passes `aria-label`
// itself, equal to the visible word (the editor's toolbar, the study's
// Edit/Done, the puzzle book's Import PDF), and keeps the title as the
// tooltip. Measured 2026-09-12: 'Edit' was named 'Show NAGs, comments and
// move tools', which no voice command matches.
export function hasTextContent(children: React.ReactNode): boolean {
  if (typeof children === 'string') return children.trim().length > 0;
  if (Array.isArray(children)) return children.some(hasTextContent);
  return false;
}

function Button({
  className,
  variant = 'default',
  size = 'default',
  active = false,
  title,
  ...props
}: ButtonProps) {
  // The app's behaviour on the registry's tooltip: controlled, and
  // registered while open (lib/popups), so the router can close it before
  // a page turn. Base UI's own close runs through flushSync, and a
  // flushSync while React holds a view transition pending makes React
  // skip the transition; a hovered back chevron turned a pop into a cut.
  // A close the router asks for unmounts the tip at once, without its
  // exit animation, whose end Base UI flushes synchronously.
  const [tipOpen, setTipOpen] = React.useState(false);
  const [tipInstant, setTipInstant] = React.useState(false);
  React.useEffect(() => {
    if (!tipOpen) return;
    return registerOpenPopup(() => {
      setTipInstant(true);
      setTipOpen(false);
    });
  }, [tipOpen]);
  const button = (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      // An icon-only button's title doubles as its accessible name unless
      // one was given: the tooltip below is what a pointer sees, and the
      // name is what a screen reader and voice control get. (Base UI's
      // Button already defaults `type="button"`, so a bare one inside a
      // form does not submit it.)
      aria-label={props['aria-label'] ?? (hasTextContent(props.children) ? undefined : title)}
      data-active={active || undefined}
      className={cn(
        buttonVariants({ variant, size }),
        // On the page ground --secondary is lifted to the --accent rung
        // (index.css, `[data-ground]`), so a lit secondary button there
        // steps once more, the way its hover does from its rest.
        active && 'bg-accent text-accent-foreground in-data-[ground]:bg-[color-mix(in_oklch,var(--accent),var(--foreground)_5%)]',
        className,
      )}
      {...props}
    />
  );
  // `title` is a tooltip, the shadcn way: the Tooltip on hover and on
  // keyboard focus, never on touch — instead of the browser's bubble. The
  // attribute itself is not set: two tips for one control would be the
  // worst of both.
  if (title === undefined) return button;
  return (
    <Tooltip
      open={tipOpen}
      onOpenChange={(next, details) => {
        // No hover-driven change while a page turns (see TitleTip).
        if (routeChanging()) {
          details.cancel();
          return;
        }
        if (next) setTipInstant(false);
        setTipOpen(next);
      }}
    >
      <TooltipTrigger render={button} />
      {!tipInstant && <TooltipContent>{title}</TooltipContent>}
    </Tooltip>
  );
}

export { Button, buttonVariants };
