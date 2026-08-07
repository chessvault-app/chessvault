/**
 * All user-visible dates render in English regardless of the OS locale —
 * on a Korean system the bare toLocaleString() calls were coming out in
 * Korean while the rest of the app is English.
 */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
