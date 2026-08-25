import { cva, type VariantProps } from 'class-variance-authority';
import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn } from '@/lib/utils';
import { hasTextContent } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * shadcn's Tabs (nova), owned. Base UI brings the tablist/tab roles, the
 * roving tab stop, Left/Right with wrap, Home/End and automatic
 * activation; the face is the registry's — the muted track with the
 * raised pill (`default`), or the underlined `line` variant.
 */

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function TabsList({
  className,
  variant = 'default',
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

/**
 * `title` is a tooltip, the shadcn way (see Button): Radix's Tooltip on
 * hover and keyboard focus, never the browser's bubble, and an icon-only
 * control's title doubles as its accessible name.
 */
// The chosen tab is read from aria-selected, not from the registry's
// `data-active:` — it survived one library's data-attribute collisions
// already (a Radix Tooltip trigger used to overwrite data-state), and
// aria-selected is the one signal the tab role guarantees.
function TabsTrigger({ className, title, ...props }: TabsPrimitive.Tab.Props & { title?: string }) {
  const trigger = (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      aria-label={props['aria-label'] ?? (hasTextContent(props.children) ? undefined : title)}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:aria-selected:shadow-sm group-data-[variant=line]/tabs-list:aria-selected:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:aria-selected:bg-transparent dark:group-data-[variant=line]/tabs-list:aria-selected:border-transparent dark:group-data-[variant=line]/tabs-list:aria-selected:bg-transparent',
        'aria-selected:bg-background aria-selected:text-foreground dark:aria-selected:border-input dark:aria-selected:bg-input/30 dark:aria-selected:text-foreground',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:aria-selected:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
  if (title === undefined) return trigger;
  return (
    <Tooltip>
      <TooltipTrigger render={trigger} />
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-content" className={cn('flex-1 text-sm outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
