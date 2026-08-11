import { t, getLang } from './i18n.ts';
/** The locale a date should be written in: the APP's language, never the
    OS's. A bare toLocaleString() on a Korean system used to print Korean
    dates through an English UI; pinning it to English fixed that and then
    became wrong the moment the app itself could be Korean. */
const locale = (): string => (getLang() === 'ko' ? 'ko-KR' : 'en-US');

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative rendering for recent activity: "5 min ago", "yesterday" —
    falling back to an absolute date once it stops being recent. */
export function formatAgo(iso: string): string {
  const then = new Date(iso);
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (mins < 1) return t('just now');
  if (mins < 60) return t('{n} min ago', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('{n} h ago', { n: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t('yesterday');
  if (days < 7) return t('{n} days ago', { n: days });
  const sameYear = then.getFullYear() === new Date().getFullYear();
  // The locale decides the shape of an absolute date, not a dictionary:
  // Korean writes 8월 11일, and no substitution gets there from "Aug 11".
  return then.toLocaleDateString(locale(), {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
