import type { MiddlewareHandler } from 'hono';

/**
 * Cross-site request defense for the API.
 *
 * An ungated vault (no appPassword — the default local config, and the
 * desktop's LOCAL mode) has no session to steal, so the classic CSRF
 * defenses never engage: any web page open in the user's own browser can
 * fire a "simple" cross-site POST (a text/plain form needs no CORS
 * preflight) at http://127.0.0.1 and the write lands even though the
 * response is unreadable. Binding to loopback stops the café network,
 * not the user's browser — and /api/settings/wipe is reachable that way.
 *
 * Three independent checks, each closing a route the others miss:
 *
 * 1. `Sec-Fetch-Site: cross-site` is refused. Every current browser
 *    stamps this on every request it makes, it survives the Vite dev
 *    proxy untouched, and non-browser clients (curl, the updater) simply
 *    do not send it — so nothing legitimate is turned away.
 *
 * 2. A state-changing request declaring a non-JSON content type is
 *    refused. HTML forms can only declare urlencoded, multipart or
 *    text/plain; fetch() cannot claim application/json cross-origin
 *    without triggering a preflight this server never approves. This is
 *    the backstop for browsers old enough to lack Sec-Fetch-Site. The
 *    one deliberately non-JSON route, the streaming PGN source upload,
 *    is exempted by path (it is still covered by check 1).
 *
 * 3. When the server knows it is loopback-bound (the desktop's LOCAL
 *    mode), the Host header must itself be a loopback name. A page the
 *    browser believes is same-origin after a DNS rebind still sends the
 *    attacker's hostname as Host, so this closes the rebinding read
 *    path that checks 1 and 2 cannot see.
 *
 * 4. The same rebinding, on a server bound to a LAN or a tailnet with
 *    NO password. Check 3 did not apply there, and nothing else could:
 *    after the rebind the page IS same-origin, sends JSON, and needs no
 *    cookie, so any website the owner visited had the whole API,
 *    /api/settings/wipe included. Ungated, the Host has to be one this
 *    server can vouch for: a loopback name, an IP literal (a rebind
 *    can only arrive under a NAME, since the attacker's page has to be
 *    served from that name first), a `.local` or `.ts.net` name (mDNS
 *    and Tailscale's MagicDNS, neither of which an outside domain can
 *    wear), or a name listed in CHESS_ALLOWED_HOSTS. With a password
 *    the check is off: the rebound origin holds no cookie, so it gets
 *    a 401 like any stranger.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const IPV4_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/i;
/** Suffixes an attacker's DNS cannot answer for, so a rebind cannot
    arrive under them. */
const VOUCHED_SUFFIXES = ['.local', '.ts.net'];

/** The Host header without its port. `[::1]:8788` keeps its brackets. */
function hostName(host: string): string {
  return host.replace(/:\d+$/, '').toLowerCase();
}

export function hostVouchedFor(name: string, allowed: readonly string[]): boolean {
  if (LOOPBACK_HOSTS.has(name)) return true;
  if (IPV4_LITERAL.test(name) || IPV6_LITERAL.test(name)) return true;
  if (VOUCHED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return true;
  return allowed.includes(name);
}

/**
 * Non-JSON by design: the routes that stream a file's raw bytes to disk —
 * the PGN source upload and the book library's PDF upload and replace.
 *
 * One predicate, exported, because two middlewares have to agree on this
 * list: this guard's content-type check, and the API-wide body cap in
 * index.ts, which would buffer a streamed upload whole to measure it. Two
 * copies of the list would drift the first time a route was added to one.
 */
const LIBRARY_PDF = /^\/api\/books\/b[0-9a-f]{16}\/pdf$/;
export function isRawBodyPath(method: string, path: string): boolean {
  if (method === 'POST') return path === '/api/sources' || path === '/api/books';
  if (method === 'PUT') return LIBRARY_PDF.test(path);
  return false;
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface CrossSiteOptions {
  loopbackOnly?: boolean;
  /** Whether /api is behind a password right now. Asked per request, since
      Settings can turn the gate on without a restart. Absent means gated,
      so a caller that says nothing gets no Host check (check 4 is off). */
  gated?: () => boolean;
  /** Extra names an ungated server answers to (CHESS_ALLOWED_HOSTS). */
  allowedHosts?: readonly string[];
}

export function crossSiteGuard(opts: CrossSiteOptions = {}): MiddlewareHandler {
  const allowed = opts.allowedHosts ?? [];
  return async (c, next) => {
    if (c.req.header('sec-fetch-site') === 'cross-site') {
      return c.json({ error: 'cross-site request refused' }, 403);
    }
    const host = c.req.header('host');
    const name = host === undefined ? undefined : hostName(host);
    if (opts.loopbackOnly) {
      if (name !== undefined && !LOOPBACK_HOSTS.has(name)) {
        return c.json({ error: 'unrecognized host' }, 403);
      }
    } else if (opts.gated && !opts.gated() && name !== undefined && !hostVouchedFor(name, allowed)) {
      return c.json(
        { error: 'unrecognized host: add it to CHESS_ALLOWED_HOSTS, or set an app password' },
        403,
      );
    }
    if (STATE_CHANGING.has(c.req.method) && !isRawBodyPath(c.req.method, c.req.path)) {
      const type = c.req.header('content-type');
      if (type !== undefined && !type.toLowerCase().includes('application/json')) {
        return c.json({ error: 'expected application/json' }, 415);
      }
    }
    return next();
  };
}
