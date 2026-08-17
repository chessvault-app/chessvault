/**
 * Keys this app used to write and no longer reads.
 *
 * Browser storage has no garbage collector: a key outlives the code that
 * wrote it, silently, for as long as the browser profile lasts. Nothing
 * here is load-bearing — that is the point — but a reader looking at
 * localStorage to work out what the app keeps should see what the app
 * actually keeps, and a value that lingers after its feature is gone is a
 * false lead the next person has to chase.
 *
 * Run once before the first render, so anything that reads storage at
 * module scope sees the swept state.
 */

/** Written by a feature that no longer exists; nothing reads it. */
const RETIRED = ['vault:repertoire-log'];

/**
 * The archive browser's original single-handle key.
 *
 * It became per-provider — one shared key meant looking up a Lichess
 * handle and reloading prefilled it into the chess.com box — and the old
 * key was left readable as a seed so nobody lost their prefill. That seed
 * is folded forward here instead, once, and then the key goes: the
 * fallback branch it existed for has been removed from the browser, and a
 * device with neither now falls back to the profile username in Settings,
 * which is the answer that follows you between devices anyway.
 */
const LEGACY_CHESSCOM = 'chess-vault:chesscom-user';
const CHESSCOM_USER = 'chess-vault:archive-user:chesscom';

export function sweepStorage(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_CHESSCOM);
    if (legacy !== null) {
      if (localStorage.getItem(CHESSCOM_USER) === null && legacy.trim() !== '') {
        localStorage.setItem(CHESSCOM_USER, legacy);
      }
      localStorage.removeItem(LEGACY_CHESSCOM);
    }
    for (const key of RETIRED) localStorage.removeItem(key);
  } catch {
    /* blocked or full storage: sweeping is upkeep, never a reason to fail a boot */
  }
}
