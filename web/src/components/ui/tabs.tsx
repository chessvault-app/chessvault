import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn's Tabs, owned. Radix brings the tablist/tab roles, the roving
 * tab stop, Left/Right with wrap, Home/End and automatic activation —
 * what ui/roving hand-wired for the pane switcher and the segmented
 * track. The face is this app's track: a sunken strip with one raised
 * pill, concentric corners (the pill's radius is the track's less its
 * border and inset, or the pill pushes through the track's curve).
 */

function Tabs({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('bg-muted border-border flex shrink-0 gap-0.5 rounded-lg border p-px', className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'flex flex-1 items-center justify-center whitespace-nowrap rounded-[calc(var(--radius-lg)_-_2px)] font-medium transition-colors duration-100',
        'text-muted-foreground hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-control',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
