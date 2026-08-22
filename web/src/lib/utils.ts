import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names, with later Tailwind utilities winning.
 *
 * Where shadcn keeps it (`@/lib/utils`, see components.json): every
 * component the registry adds imports `cn` from here, so this is the one
 * path that must exist.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
