import * as React from 'react';

import { cn } from '@/lib/utils';

// A plain <label>, the base registry's way — Base UI has no standalone
// Label primitive (its Field brings its own). Radix's only addition was
// swallowing the double-click text selection, which select-none covers.
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    <label
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
