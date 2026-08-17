import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { Hono, type MiddlewareHandler } from 'hono';
import { writeAtomic } from './atomic.ts';
import { VAULT_CONFIG, VAULT_SESSIONS } from './paths.ts';
import { hashPassword, isHashedPassword, verifyPassword } from './password.ts';
import { verifyTotp } from './totp.ts';

/**
 * App-level password gate for public deployments.
 *
 * Enabled by adding `"appPassword": "…"` to vault/config.json (absent →
 * everything stays open, the local default). All of /api except /api/auth
 * then requires the session cookie. The static shell stays ungated — it is
 * generic UI code; every byte of vault data flows through /api.
 *
 * Each login mints a fresh random token; the cookie is that token, and the
 * vault keeps only its sha256 in vault/sessions.json. The old scheme — one
 * deterministic HMAC of the credentials — handed every device the SAME
 * year-long bearer token, and a copy exfiltrated once could not be revoked
 * short of changing the password. Random per-login tokens make
 * /auth/logout a real revocation, and sessions still survive server
 * restarts because the store is a vault file, not memory. Rotating a
 * credential (password, 2FA) still signs everyone out at once: the
 * settings routes clear the store (revokeAllSessions), where the old
 * scheme got the same effect from re-derivation. This gate is a second
 * layer: the deployment in front of it should already terminate TLS and
 * ideally add its own auth (Cloudflare Access / Caddy basic-auth).
 */

const COOKIE = 'vault_session';
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
/** Cookie Max-Age and the store's own expiry — one number, so a cookie the
    browser would still send is one the store still honours, and vice versa. */
const SESSION_MAX_AGE_S = 365 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;
/** More live sessions than one person's devices could need. The cap is what
    keeps a login loop (or just a year of logins) from growing the file for
    ever; past it, the oldest session is the one that dies. */
const SESSION_CAP = 20;

/**
 * A sentinel password that no user input can equal (verifyPassword's plain
 * branch compares raw bytes, and a real password is a plain string).
 * Returned when config.json exists but cannot be read or parsed: the gate
 * then DENIES rather than fails open. Only a genuinely absent file means
 * "no gate" (local default).
 */
const UNREADABLE = '\0unreadable\0';

/**
 * One parsed copy of config.json, refreshed when its mtime moves.
 *
 * requireAuth runs on every /api request and used to read AND parse the
 * file twice per hit (password, then totp) — blocking sync I/O on the
 * hottest path, where the explorer fires a request per arrow-key press.
 * A stat is far cheaper than two read+parse rounds, and the settings
 * routes replace config.json by rename, so any credential change moves
 * the mtime and is seen on the very next request.
 */
interface AuthConfig {
  password: string | null;
  totp: string | null;
}
let cachedConfig: { mtimeMs: number; value: AuthConfig } | null = null;

function readAuthConfig(): AuthConfig {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(VAULT_CONFIG).mtimeMs;
  } catch (err) {
    cachedConfig = null;
    // ENOENT: no config at all → local, ungated. Anything else (EACCES,
    // a directory, a transient FS error) must not open the vault.
    return (err as NodeJS.ErrnoException).code === 'ENOENT'
      ? { password: null, totp: null }
      : { password: UNREADABLE, totp: null };
  }
  if (cachedConfig && cachedConfig.mtimeMs === mtimeMs) return cachedConfig.value;

  let value: AuthConfig;
  try {
    const parsed = JSON.parse(readFileSync(VAULT_CONFIG, 'utf-8')) as {
      appPassword?: string;
      totpSecret?: string;
    };
    value = {
      password: parsed.appPassword?.trim() || null,
      totp: parsed.totpSecret?.trim() || null,
    };
  } catch {
    // Present but corrupt or vanished mid-read — deny, don't admit.
    value = { password: UNREADABLE, totp: null };
  }
  cachedConfig = { mtimeMs, value };
  return value;
}

function configPassword(): string | null {
  return readAuthConfig().password;
}

function configTotp(): string | null {
  return readAuthConfig().totp;
}

/**
 * The at-rest upgrade: a config still holding the password verbatim is
 * rewritten to hold only its scrypt form (see password.ts). Run at boot
 * and again after any successful login, so a config hand-edited back to
 * plaintext — the documented way to recover a forgotten password — is
 * re-hashed without waiting for a restart. Read-modify-write over the
 * whole file, atomic rename, owner-only, like the settings routes, so no
 * other key is disturbed. Best-effort: the plaintext form still verifies,
 * so failing to migrate loses nothing but the hardening until the next
 * chance.
 */
export function migratePlaintextPassword(configPath: string = VAULT_CONFIG): void {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const plain = typeof config.appPassword === 'string' ? config.appPassword.trim() : '';
    if (!plain || isHashedPassword(plain)) return;
    config.appPassword = hashPassword(plain);
    writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Missing or unparseable config: nothing to migrate here (login's own
    // UNREADABLE handling already refuses the corrupt case).
  }
}

/**
 * The session store: vault/sessions.json, one entry per login.
 *
 * Only the sha256 of each token is kept — the store must not itself be a
 * list of usable cookies — plus when it was minted, so entries expire on
 * the same clock as the cookie. It is read on every gated request, so it
 * gets the same mtime cache as config.json, and written the same way the
 * settings routes write config.json (atomic rename, owner-only). A file
 * that is missing or damaged is an EMPTY store, not an error: unlike
 * config.json, nothing in it is irreplaceable — every device just signs
 * in again.
 */
interface SessionEntry {
  hash: string;
  createdAt: number;
}

let cachedSessions: { path: string; mtimeMs: number; value: SessionEntry[] } | null = null;

function readSessions(path: string): SessionEntry[] {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    cachedSessions = null;
    return [];
  }
  if (cachedSessions && cachedSessions.path === path && cachedSessions.mtimeMs === mtimeMs) {
    return cachedSessions.value;
  }
  let value: SessionEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'));
    if (Array.isArray(parsed)) {
      // Entry by entry, not all-or-nothing: one hand-mangled line must not
      // sign out the sessions beside it.
      value = parsed.filter(
        (e): e is SessionEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as SessionEntry).hash === 'string' &&
          /^[0-9a-f]{64}$/.test((e as SessionEntry).hash) &&
          typeof (e as SessionEntry).createdAt === 'number',
      );
    }
  } catch {
    value = [];
  }
  cachedSessions = { path, mtimeMs, value };
  return value;
}

function writeSessions(path: string, entries: SessionEntry[]): void {
  // 0600 like config.json: hashes are not tokens, but there is no reason
  // to show every user of the host who is signed in and since when.
  writeAtomic(path, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
  cachedSessions = null; // the mtime moved; re-read on the next request
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

const isExpired = (e: SessionEntry, now: number): boolean => now - e.createdAt > SESSION_MAX_AGE_MS;

/** Drop what the cookie clock has already dropped, then the oldest beyond
    the cap — sorted oldest-first, so the slice keeps the newest logins. */
function pruned(entries: SessionEntry[], now: number): SessionEntry[] {
  const live = entries.filter((e) => !isExpired(e, now)).sort((a, b) => a.createdAt - b.createdAt);
  return live.slice(Math.max(0, live.length - SESSION_CAP));
}

function sameHash(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Is the presented cookie a live session? Hash it and look it up. Every
    entry is compared timing-safely and none short-circuits, so the answer
    costs the same whether (and where) it hits. */
function sessionValid(sessionsPath: string, cookieHeader: string | undefined): boolean {
  const token = cookieToken(cookieHeader);
  if (token === null) return false;
  const presented = tokenHash(token);
  const now = Date.now();
  let found = false;
  for (const entry of readSessions(sessionsPath)) {
    if (!isExpired(entry, now) && sameHash(entry.hash, presented)) found = true;
  }
  return found;
}

/**
 * Forget every session — the server side of "change the password and
 * everyone is signed out". The settings routes call this whenever a
 * credential (password, 2FA) changes; the old derived-token scheme got
 * that for free, and this one must do it explicitly.
 */
export function revokeAllSessions(sessionsPath: string = VAULT_SESSIONS): void {
  writeSessions(sessionsPath, []);
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

function cookieToken(header: string | undefined): string | null {
  const match = header?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

/** Everything registered after this middleware requires the session. */
export function requireAuth(
  passwordOverride?: () => string | null,
  sessionsPathOverride?: string,
): MiddlewareHandler {
  const password = passwordOverride ?? configPassword;
  const sessionsPath = sessionsPathOverride ?? VAULT_SESSIONS;
  return async (c, next) => {
    const configured = password();
    if (!configured) return next();
    // Config present but unreadable: deny even a live session — this is
    // readAuthConfig's fail-closed promise, and a stored session must not
    // soften it.
    if (configured !== UNREADABLE && sessionValid(sessionsPath, c.req.header('cookie'))) {
      return next();
    }
    return c.json({ error: 'authentication required' }, 401);
  };
}

export function authApi(
  passwordOverride?: () => string | null,
  totpOverride?: () => string | null,
  sessionsPathOverride?: string,
): Hono {
  const password = passwordOverride ?? configPassword;
  const totp = totpOverride ?? configTotp;
  const sessionsPath = sessionsPathOverride ?? VAULT_SESSIONS;
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
      authed:
        configured === null ||
        (configured !== UNREADABLE && sessionValid(sessionsPath, c.req.header('cookie'))),
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
    if (typeof body.password !== 'string' || !verifyPassword(body.password, configured)) {
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

    // A fresh random token for this login alone: the cookie is the only
    // copy, the store keeps its hash. Login is also the moment the store
    // is pruned — expired entries out, oldest-beyond-the-cap out.
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    writeSessions(
      sessionsPath,
      pruned([...readSessions(sessionsPath), { hash: tokenHash(token), createdAt: now }], now),
    );

    // The stored password just proved out in its plaintext form — take the
    // chance to leave only the hash on disk. Overrides are tests speaking
    // for a config that does not exist; never rewrite the real one for them.
    if (passwordOverride === undefined && !isHashedPassword(configured)) migratePlaintextPassword();

    const secure = c.req.header('x-forwarded-proto') === 'https' ? '; Secure' : '';
    c.header(
      'Set-Cookie',
      `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_S}; SameSite=Lax${secure}`,
    );
    return c.json({ ok: true });
  });

  api.post('/auth/logout', (c) => {
    // Revoke, don't just clear: deleting the store's entry is what makes a
    // logged-out cookie worthless everywhere, stolen copies included.
    const token = cookieToken(c.req.header('cookie'));
    if (token !== null) {
      const all = readSessions(sessionsPath);
      const presented = tokenHash(token);
      const remaining = pruned(all.filter((e) => !sameHash(e.hash, presented)), Date.now());
      // Written only when something went: an ungated vault's logout must
      // not conjure a sessions file into being.
      if (remaining.length !== all.length) writeSessions(sessionsPath, remaining);
    }
    c.header('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    return c.json({ ok: true });
  });

  return api;
}
