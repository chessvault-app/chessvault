import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { VAULT_CONFIG } from './paths.ts';
import { verifyTotp } from './totp.ts';

/**
 * App-level password gate for public deployments.
 *
 * Enabled by adding `"appPassword": "…"` to vault/config.json (absent →
 * everything stays open, the local default). All of /api except /api/auth
 * then requires the session cookie. The static shell stays ungated — it is
 * generic UI code; every byte of vault data flows through /api.
 *
 * The session token is deterministic — HMAC(sha256(password), fixed label)
 * — so sessions survive server restarts with no session store, and
 * changing the password invalidates every session at once. This gate is a
 * second layer: the deployment in front of it should already terminate
 * TLS and ideally add its own auth (Cloudflare Access / Caddy basic-auth).
 */

const COOKIE = 'vault_session';
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/**
 * A sentinel password that no user input can equal (safeEqual compares raw
 * bytes, and a real password is a plain string). Returned when config.json
 * exists but cannot be read or parsed: the gate then DENIES rather than
 * fails open. Only a genuinely absent file means "no gate" (local default).
 */
const UNREADABLE = '\0unreadable\0';

function configPassword(): string | null {
  let raw: string;
  try {
    raw = readFileSync(VAULT_CONFIG, 'utf-8');
  } catch (err) {
    // ENOENT: no config at all → local, ungated. Anything else (EACCES,
    // a directory, a transient FS error) must not open the vault.
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? null : UNREADABLE;
  }
  try {
    return (JSON.parse(raw) as { appPassword?: string }).appPassword?.trim() || null;
  } catch {
    // Present but corrupt — deny, don't admit.
    return UNREADABLE;
  }
}

function configTotp(): string | null {
  try {
    const config = JSON.parse(readFileSync(VAULT_CONFIG, 'utf-8')) as { totpSecret?: string };
    return config.totpSecret?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The rate-limit key. X-Forwarded-For is a comma list the client can prepend
 * to; behind exactly one trusted proxy (Caddy) the real client IP is the
 * LAST entry, which the proxy appends and the client cannot forge. No header
 * (direct/dev) falls back to a constant — acceptable for a single-user vault.
 */
function clientIp(xff: string | undefined): string {
  if (!xff) return 'local';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? 'local';
}

/** The token binds password AND totp secret: rotating either one (or
    enabling/disabling 2FA) invalidates every session at once. */
function sessionToken(password: string, totpSecret: string | null): string {
  const key = createHash('sha256')
    .update(password)
    .update('\n')
    .update(totpSecret ?? '')
    .digest();
  return createHmac('sha256', key).update('chess-vault-session-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function cookieToken(header: string | undefined): string | null {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

function authed(cookieHeader: string | undefined, password: string, totpSecret: string | null): boolean {
  const token = cookieToken(cookieHeader);
  return token !== null && safeEqual(token, sessionToken(password, totpSecret));
}

/** Everything registered after this middleware requires the session. */
export function requireAuth(
  passwordOverride?: () => string | null,
  totpOverride?: () => string | null,
): MiddlewareHandler {
  const password = passwordOverride ?? configPassword;
  const totp = totpOverride ?? configTotp;
  return async (c, next) => {
    const configured = password();
    if (!configured || authed(c.req.header('cookie'), configured, totp())) return next();
    return c.json({ error: 'authentication required' }, 401);
  };
}

export function authApi(
  passwordOverride?: () => string | null,
  totpOverride?: () => string | null,
): Hono {
  const password = passwordOverride ?? configPassword;
  const totp = totpOverride ?? configTotp;
  const api = new Hono();

  // Per-IP login throttle. In-memory is fine: a restart resetting the
  // window is acceptable for a single-user vault. Counts only failed
  // attempts (the caller records on failure), and sweeps expired buckets
  // so a spoofed-key flood cannot grow the map without bound.
  const attempts = new Map<string, { n: number; resetAt: number }>();
  const isThrottled = (ip: string): boolean => {
    const entry = attempts.get(ip);
    return entry !== undefined && Date.now() <= entry.resetAt && entry.n >= ATTEMPT_LIMIT;
  };
  const recordFailure = (ip: string): void => {
    const now = Date.now();
    for (const [key, e] of attempts) if (now > e.resetAt) attempts.delete(key);
    const entry = attempts.get(ip);
    if (!entry || now > entry.resetAt) attempts.set(ip, { n: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    else entry.n++;
  };

  api.get('/auth/status', (c) => {
    const configured = password();
    return c.json({
      required: configured !== null,
      authed: configured === null || authed(c.req.header('cookie'), configured, totp()),
      totp: configured !== null && totp() !== null,
    });
  });

  api.post('/auth/login', async (c) => {
    const configured = password();
    if (!configured) return c.json({ ok: true }); // nothing to log into
    // Config present but unreadable: never authenticate (and never let the
    // sentinel itself be a submittable password).
    if (configured === UNREADABLE) return c.json({ error: 'vault configuration error' }, 503);

    const ip = clientIp(c.req.header('x-forwarded-for'));
    if (isThrottled(ip)) return c.json({ error: 'too many attempts — try again later' }, 429);

    const body = (await c.req.json().catch(() => ({}))) as { password?: string; code?: string };
    if (typeof body.password !== 'string' || !safeEqual(body.password, configured)) {
      recordFailure(ip);
      return c.json({ error: 'wrong password' }, 401);
    }
    const totpSecret = totp();
    if (totpSecret) {
      // Two-stage sign-in: a correct password with NO code supplied is the
      // first stage, not a failure — answer "now the code" without burning
      // a throttle attempt (the password was right). A code that is present
      // but wrong is still a failed attempt.
      if (body.code === undefined || body.code === '') {
        return c.json({ needTotp: true });
      }
      if (!verifyTotp(totpSecret, body.code)) {
        recordFailure(ip);
        return c.json({ error: 'wrong authenticator code' }, 401);
      }
    }

    const secure = c.req.header('x-forwarded-proto') === 'https' ? '; Secure' : '';
    c.header(
      'Set-Cookie',
      `${COOKIE}=${sessionToken(configured, totpSecret)}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${secure}`,
    );
    return c.json({ ok: true });
  });

  api.post('/auth/logout', (c) => {
    c.header('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    return c.json({ ok: true });
  });

  return api;
}
