import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';

/**
 * Fetch-into-state, once, correctly.
 *
 * The `let live = true` guard effect was hand-rolled in twenty files, and
 * two of the copies were wrong in the two ways the pattern allows: one
 * read state its dependency list did not name (so it never re-ran), one
 * skipped the guard (so a stale answer could win the race). This hook is
 * that idiom with both mistakes made impossible — the values the fetch
 * depends on ARE the dependency list, and cancellation is not optional.
 *
 * For simple "load this when that changes" effects only. A fetch that
 * feeds a store, chains user interaction, or wants a retry button keeps
 * its own effect — forcing those through here would hide their logic, not
 * simplify it.
 */
export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  opts?: { enabled?: boolean },
): { data: T | null; error: ApiError | null; loading: boolean } {
  const enabled = opts?.enabled ?? true;
  const [state, setState] = useState<{
    data: T | null;
    error: ApiError | null;
    loading: boolean;
  }>({ data: null, error: null, loading: enabled });

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    fetcher(ctrl.signal).then(
      (data) => {
        if (!ctrl.signal.aborted) setState({ data, error: null, loading: false });
      },
      (error: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({
          data: null,
          error: error instanceof ApiError ? error : new ApiError(0, String(error)),
          loading: false,
        });
      },
    );
    return () => ctrl.abort();
    // The caller's deps ARE the effect's deps; `fetcher` is deliberately
    // not one, or every render's new closure would refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  return state;
}
