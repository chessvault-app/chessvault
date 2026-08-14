import { useEffect, useState } from 'react';

/** JS mirror of the CSS `wide` variant (index.css): side-by-side layouts. */
const WIDE_MQ = '(min-width: 64rem), (orientation: landscape) and (min-width: 44rem)';

export function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_MQ);
    const update = (): void => setWide(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}
