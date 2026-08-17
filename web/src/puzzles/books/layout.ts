import { useMediaQuery } from '@/lib/media';

/** JS mirror of the CSS `wide` variant (index.css): side-by-side layouts. */
const WIDE_MQ = '(min-width: 64rem), (orientation: landscape) and (min-width: 44rem)';

export function useWideLayout(): boolean {
  return useMediaQuery(WIDE_MQ);
}
