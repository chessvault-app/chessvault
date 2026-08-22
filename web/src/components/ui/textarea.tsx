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
      className={cn(INPUT_BASE, 'flex field-sizing-content min-h-16 w-full px-2.5 py-2', className)}
      {...props}
    />
  );
}

export { Textarea };
