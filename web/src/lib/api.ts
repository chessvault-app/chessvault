import { t } from '@/lib/i18n';

/**
 * The one place the app's HTTP handling lives.
 *
 * Every view used to hand-roll fetch with its own subset of the same four
 * concerns, and the subsets disagreed: some checked res.ok, some parsed
 * the error envelope, almost none caught a network failure (a server blip
 * stranded skeletons and wedged busy buttons), and nothing anywhere
 * noticed a 401 — an expired session made every pane report "server
 * unreachable" while the server sat there asking for a password.
 *
 * api() does all four. It throws ApiError for anything short of success,
 * carrying the server's own words when it sent any, so a call site's whole
 * obligation is try/catch (and releasing its busy flag in finally).
 */

/** A failed request: status 0 means the network, anything else the server. */
export class ApiError extends Error {
  /**
   * The failure is an outage rather than a fault — nothing is broken and
   * nothing the user did is wrong; a machine in the middle could not be
   * reached. True for every network-level failure, and for a server that
   * says so in its own body (`{ offline: true }` — the Lichess proxy
   * sends it when it can reach neither Lichess nor its cache).
   *
   * It exists so a caller can colour the two apart: the app's grammar
   * gives red to a failure and amber to an offline notice, and until this
   * flag there was nothing at a call site to tell them apart.
   */
  readonly offline: boolean;

  constructor(
    readonly status: number,
    message: string,
    offline = false,
  ) {
    super(message);
    this.name = 'ApiError';
    this.offline = offline;
  }
}

let onUnauthorized: (() => void) | null = null;

/**
 * PasswordGate registers itself here at mount; a 401 from any api() call
 * then relocks the app, so the remedy for an expired session is the lock
 * screen instead of a wall of misleading errors.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * Artificial latency, in milliseconds, for looking at the loading states.
 *
 * Skeletons are the one part of the UI that is invisible when everything
 * works: useSlowLoad draws nothing for the first 180 ms, and most calls
 * through here finish inside that. So a build made with CHESS_LAG=1 carries
 * this switch, and `localStorage.lag = 1500` in the console turns it on for
 * one browser — a phone against the deployed server included.
 *
 * Build-time rather than import.meta.env.DEV, because the app worth looking
 * at is the deployed one and DEV is false there. __LAG__ is stated false in
 * every normal build, so this folds away exactly as __DEMO__ does; the
 * typeof guard is for the demo config, which defines its own set.
 */
function lagMs(): number {
  if (typeof __LAG__ === 'undefined' || !__LAG__) return 0;
  const ms = Number(localStorage.getItem('lag'));
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export async function api<T = unknown>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {};
  const lag = lagMs();
  if (lag > 0) await new Promise((resolve) => setTimeout(resolve, lag));
  let res: Response;
  try {
    res = await fetch(
      url,
      json === undefined
        ? rest
        : {
            ...rest,
            headers: { 'content-type': 'application/json', ...(rest.headers ?? {}) },
            body: JSON.stringify(json),
          },
    );
  } catch {
    throw new ApiError(
      0,
      navigator.onLine ? t('vault server unreachable') : t('no internet connection'),
      true,
    );
  }
  if (res.status === 401) onUnauthorized?.();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
      offline?: boolean;
    } | null;
    throw new ApiError(
      res.status,
      body?.error ?? t('Request failed ({status})', { status: res.status }),
      body?.offline === true,
    );
  }
  // Routes that answer with no body (or plain ok) parse to undefined.
  return (await res.json().catch(() => undefined)) as T;
}

/**
 * Send a file's raw bytes, reporting progress as they go.
 *
 * XMLHttpRequest rather than fetch for one reason: fetch has no upload
 * progress, and a 300 MB scan going up from a phone with nothing moving
 * on screen is a dialog that looks dead. Everything else matches api() —
 * the same error envelope, the same 401 relock, the same offline line.
 */
export function apiUpload<T = unknown>(
  url: string,
  file: Blob,
  options: {
    method?: 'POST' | 'PUT';
    contentType?: string;
    onProgress?: (sent: number, total: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? 'POST', url);
    xhr.setRequestHeader('content-type', options.contentType ?? 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) options.onProgress?.(e.loaded, e.total);
    };
    const fail = (status: number, message: string, offline = false): void =>
      reject(new ApiError(status, message, offline));
    xhr.onerror = () =>
      fail(0, navigator.onLine ? t('vault server unreachable') : t('no internet connection'), true);
    xhr.onabort = () => fail(0, t('Upload cancelled'));
    xhr.onload = () => {
      if (xhr.status === 401) onUnauthorized?.();
      let body: unknown = undefined;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const envelope = body as { error?: string; offline?: boolean } | undefined;
        fail(
          xhr.status,
          envelope?.error ?? t('Request failed ({status})', { status: xhr.status }),
          envelope?.offline === true,
        );
        return;
      }
      resolve(body as T);
    };
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/**
 * The error's message when it is an ApiError, a generic line otherwise.
 *
 * Translated HERE rather than at the call site. The server's own error
 * strings are English sentences, and ko.ts carries a block of them for
 * exactly this reason — but only about half the call sites remembered to
 * write `t(apiErrorMessage(e))`, so a Korean user met "a book with that
 * name exists" in English. One `t()` at the boundary every message passes
 * through cannot be forgotten. Double translation is a no-op: a Korean
 * sentence is not a key, so it falls back to itself.
 */
export function apiErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? t(error.message)
    : t('Request failed ({status})', { status: '?' });
}
