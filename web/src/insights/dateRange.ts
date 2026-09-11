/**
 * The quick date ranges the insights rail offers beside the pickers.
 *
 * Kept relative rather than as two dates: a filter set to "last month"
 * and visited next week should still mean the last month, which two
 * stored dates would silently stop meaning. The bound is computed when
 * the query is built, in local time, as an inclusive `YYYY-MM-DD` from
 * date the same way the pickers write theirs.
 */
export const DATE_RANGES = ['any', '7d', '30d', '3m', '6m', '12m', 'custom'] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/** English, as the key t() looks up. */
export const DATE_RANGE_LABEL: Record<DateRange, string> = {
  any: 'Any time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  custom: 'Custom dates',
};

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * The `from` bound a range stands for on a given day, or null when the
 * range sets none ('any' and 'custom', whose dates the pickers hold).
 * "Last 7 days" includes today, so it starts six days back; a month
 * range steps the calendar month, clamped by Date's own overflow rule
 * (three months before 31 May is 31 February, which Date reads as 3 March).
 */
export function rangeFrom(range: DateRange, today = new Date()): string | null {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  switch (range) {
    case '7d':
      d.setDate(d.getDate() - 6);
      return iso(d);
    case '30d':
      d.setDate(d.getDate() - 29);
      return iso(d);
    case '3m':
    case '6m':
    case '12m':
      d.setMonth(d.getMonth() - Number.parseInt(range, 10));
      return iso(d);
    default:
      return null;
  }
}
