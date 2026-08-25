import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

/**
 * shadcn's Progress (nova), owned: the registry's thin muted track and
 * Base UI's progressbar role. `value` fills it with the primary (the
 * primitive sizes its own Indicator from the value); ProgressIndicator
 * is exported for a bar that is more than one fill (the solved/failed
 * bar in components/progress-bar), where each fill states its width and
 * that explicit style wins over the primitive's own.
 */
function Progress({ className, value, children, ...props }: ProgressPrimitive.Root.Props) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full', className)}
      {...props}
    >
      {children ?? <ProgressIndicator className="bg-primary size-full flex-1" style={{ width: `${value || 0}%` }} />}
    </ProgressPrimitive.Root>
  );
}

function ProgressIndicator({ className, ...props }: ProgressPrimitive.Indicator.Props) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn('h-full transition-all', className)}
      {...props}
    />
  );
}

export { Progress, ProgressIndicator };
