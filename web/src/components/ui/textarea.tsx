import * as React from 'react';

import { cn } from '@/lib/utils';
import { INPUT_BASE } from '@/components/ui/input';

/** shadcn's Textarea, on the same base as Input (see there for the why). */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      className={cn(INPUT_BASE, 'px-2.5 py-2 text-sm pointer-coarse:text-base', className)}
      {...props}
    />
  );
}

export { Textarea };
