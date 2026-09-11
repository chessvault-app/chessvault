import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * A shelf's bookmarks, kept in the vault beside what they mark.
 *
 * Three shelves (studies, the library, the puzzle books) carried this
 * pair by hand: fetch the list once, flip a mark on screen at once and
 * tell the vault afterwards. Optimistic, and quietly so: the mark has
 * already flipped, a toggle that failed to stick is rediscovered on the
 * next load, and neither request's failure is worth a line on the shelf.
 *
 * `field` names the key both routes speak: `id` for documents, `slug`
 * for puzzle books. The list answers under its plural.
 */
export function useBookmarks(
  base: string,
  field: 'id' | 'slug' = 'id',
): { marked: Set<string>; toggle: (key: string) => Promise<void> } {
  const [marked, setMarked] = useState<Set<string>>(new Set());
  useEffect(() => {
    void api<Record<string, string[]> | undefined>(`${base}/bookmarks`)
      .then((body) => setMarked(new Set(body?.[`${field}s`] ?? [])))
      .catch(() => {});
  }, [base, field]);
  const toggle = async (key: string): Promise<void> => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    await api(`${base}/bookmarks/toggle`, { method: 'POST', json: { [field]: key } }).catch(() => {});
  };
  return { marked, toggle };
}
