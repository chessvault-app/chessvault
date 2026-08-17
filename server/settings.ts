import { execFile } from 'node:child_process';
import { writeAtomic } from './atomic.ts';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import {APP_VERSION, VAULT, VAULT_CONFIG} from './paths.ts';
import { normaliseHomeLayout } from '../shared/homeLayout.ts';
import { normaliseTraining } from '../shared/training.ts';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.ts';

/**
 * Settings live in vault/config.json — the one vault file that is
 * configuration rather than chess. This API edits it in place
 * (read-modify-write, atomic rename) and never echoes secrets back:
 * the password and Lichess token are write-only, reads only report
 * presence. Registered behind requireAuth like every data route.
 */

interface Profile {
  name?: string;
  chesscom?: string;
  lichess?: string;
}

interface Config {
  appPassword?: string;
  totpSecret?: string;
  lichessToken?: string;
  profile?: Profile;
  /** How this vault's home page is arranged — see shared/homeLayout.ts.
      Absent means nobody has ever said, which is not the same as having
      asked for nothing. */
  home?: unknown;
  /** Puzzle difficulty and the last drilled study — see shared/training.ts.
      Chess, not screen, so it belongs to the vault and follows you between
      devices. */
  training?: unknown;
  [key: string]: unknown;
}

export interface SettingsDeps {
  configPath?: string;
  vaultDir?: string;
}

export function settingsApi(deps: SettingsDeps = {}): Hono {
  const configPath = deps.configPath ?? VAULT_CONFIG;
  const vaultDir = deps.vaultDir ?? VAULT;

  const readConfig = (): Config => {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8')) as Config;
    } catch {
      return {};
    }
  };
  const writeConfig = (mutate: (config: Config) => void): void => {
    const config = readConfig();
    mutate(config);
    // 0600: config.json holds the password, TOTP secret and Lichess token —
    // keep it owner-only on multi-user hosts. writeAtomic also carries the
    // Windows EPERM retry: a settings save 500ed when Defender briefly
    // held the file the rename was replacing.
    writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  };

  /** Constant-time string compare — same reason auth.ts uses one. */
  const secretEqual = (a: string, b: string): boolean => {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  };

  const api = new Hono();

  api.get('/settings', (c) => {
    const config = readConfig();
    const token = config.lichessToken?.trim() ?? '';
    return c.json({
      profile: config.profile ?? {},
      gate: !!config.appPassword?.trim(),
      totp: !!config.totpSecret?.trim(),
      lichess: { configured: token !== '', last4: token === '' ? null : token.slice(-4) },
      // Normalised on the way out as well as in: a config edited by hand
      // must not be able to hand the page something it cannot draw.
      home: normaliseHomeLayout(config.home),
      training: normaliseTraining(config.training),
      vaultPath: vaultDir,
      version: APP_VERSION,
    });
  });

  api.put('/settings/profile', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Profile | null;
    if (!body) return c.json({ error: 'invalid profile' }, 400);
    const clean = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t === '' || t.length > 120 ? undefined : t;
    };
    writeConfig((config) => {
      config.profile = {
        ...(clean(body.name) && { name: clean(body.name) }),
        ...(clean(body.chesscom) && { chesscom: clean(body.chesscom) }),
        ...(clean(body.lichess) && { lichess: clean(body.lichess) }),
      };
    });
    return c.json({ ok: true });
  });

  // --- home page -----------------------------------------------------------
  // Which destinations home leads with, in which order, and whether its two
  // cards are drawn. In the vault rather than in a browser because it
  // describes this vault's chess, not this screen: a phone and a desktop
  // opening the same vault should agree about where things are.

  api.put('/settings/home', async (c) => {
    const layout = normaliseHomeLayout(await c.req.json().catch(() => null));
    if (!layout) return c.json({ error: 'invalid home layout' }, 400);
    writeConfig((config) => {
      config.home = layout;
    });
    return c.json({ ok: true });
  });

  // Reset. Deleting rather than writing today's defaults back is what keeps
  // "never customised" reachable — and a vault in that state inherits a
  // later version's defaults instead of being frozen at the arrangement
  // that happened to be current the day the button was pressed.
  api.delete('/settings/home', (c) => {
    writeConfig((config) => {
      delete config.home;
    });
    return c.json({ ok: true });
  });

  // --- training ------------------------------------------------------------
  // The puzzle trainer's difficulty and the last drilled study. In the vault
  // for the same reason the home layout is: it describes this vault's chess
  // rather than one screen, so picking Hard on the desktop is still Hard on
  // the phone.

  /**
   * A PATCH, not a replacement.
   *
   * Difficulty and the drill memo are written by different pages at
   * different moments, so a whole-object write would have the trainer
   * silently forget which study was being drilled (and the driller forget
   * the difficulty) every time either one was touched. Merging also means
   * an older client that has never heard of a field cannot amputate it.
   */
  api.put('/settings/training', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'invalid training' }, 400);
    const patch = normaliseTraining(body);
    writeConfig((config) => {
      config.training = { ...normaliseTraining(config.training), ...patch };
    });
    return c.json({ ok: true });
  });

  api.post('/settings/password', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { current?: string; next?: string };
    const config = readConfig();
    const current = config.appPassword?.trim() || null;
    if (current && !secretEqual(body.current ?? '', current)) {
      return c.json({ error: 'current password is wrong' }, 403);
    }
    const next = body.next?.trim() ?? '';
    if (next.length < 8) return c.json({ error: 'new password must be at least 8 characters' }, 400);
    writeConfig((cfg) => {
      cfg.appPassword = next;
    });
    // The session token derives from the password, so every session —
    // including this one — is invalid now. The client re-logs-in.
    return c.json({ ok: true, reauth: true });
  });

  api.put('/settings/lichess', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: string };
    const token = body.token?.trim() ?? '';
    if (token === '' || /\s/.test(token) || token.length > 200) {
      return c.json({ error: 'that does not look like a Lichess token' }, 400);
    }
    writeConfig((config) => {
      config.lichessToken = token;
    });
    return c.json({ ok: true });
  });

  api.delete('/settings/lichess', (c) => {
    writeConfig((config) => {
      delete config.lichessToken;
    });
    return c.json({ ok: true });
  });

  // --- 2FA -----------------------------------------------------------------
  // Two-step enrolment: /start mints a secret the client renders as a QR;
  // nothing is stored until /enable proves the authenticator actually has
  // it by verifying a live code. No lockout half-states possible.

  api.post('/settings/2fa/start', (c) => {
    const config = readConfig();
    if (!config.appPassword?.trim()) {
      return c.json({ error: 'set an app password first — 2FA guards the password gate' }, 400);
    }
    const secret = generateTotpSecret();
    return c.json({ secret, otpauth: otpauthUrl(secret) });
  });

  api.post('/settings/2fa/enable', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      secret?: string;
      code?: string;
      currentCode?: string;
    };
    // Re-enrolment must not be a way around disable's code check: if 2FA is
    // already on, prove possession of the current authenticator first.
    const existing = readConfig().totpSecret?.trim();
    if (existing && !verifyTotp(existing, body.currentCode ?? '')) {
      return c.json({ error: 'enter a code from your current authenticator first' }, 403);
    }
    const secret = body.secret?.trim() ?? '';
    if (!/^[A-Z2-7]{16,}$/.test(secret)) return c.json({ error: 'invalid secret' }, 400);
    if (!verifyTotp(secret, body.code ?? '')) {
      return c.json({ error: 'that code does not match — scan the QR again and retype' }, 403);
    }
    writeConfig((config) => {
      config.totpSecret = secret;
    });
    return c.json({ ok: true, reauth: true });
  });

  api.post('/settings/2fa/disable', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const config = readConfig();
    const secret = config.totpSecret?.trim();
    if (!secret) return c.json({ ok: true });
    if (!verifyTotp(secret, body.code ?? '')) {
      return c.json({ error: 'wrong authenticator code' }, 403);
    }
    writeConfig((cfg) => {
      delete cfg.totpSecret;
    });
    return c.json({ ok: true, reauth: true });
  });

  // --- The red button ------------------------------------------------------

  api.post('/settings/wipe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { confirm?: string; password?: string };
    if (body.confirm !== 'wipe everything') {
      return c.json({ error: 'confirmation phrase mismatch' }, 400);
    }
    // On a gated vault, re-enter the password: this both blocks a stolen
    // session or CSRF drive-by from destroying data, and is a deliberate
    // friction on an irreversible action. Ungated (local) vaults skip it.
    const gate = readConfig().appPassword?.trim();
    if (gate && !secretEqual(body.password ?? '', gate)) {
      return c.json({ error: 'password required to wipe' }, 403);
    }
    // Everything in the vault goes — games, studies, notes, puzzles, books,
    // sources, the fine-grained history repo — except config.json, which
    // holds the password, 2FA and tokens that let the owner back in.
    for (const entry of readdirSync(vaultDir)) {
      if (entry === 'config.json' || entry === '.gitkeep') continue;
      rmSync(resolve(vaultDir, entry), { recursive: true, force: true });
    }
    for (const d of ['studies', 'notes', 'games', 'sources']) {
      mkdirSync(resolve(vaultDir, d), { recursive: true });
    }
    // Fresh history repo so the autosave layer keeps working (and carries
    // no pre-wipe data). Best-effort: a vault without git still works.
    const gitDir = resolve(vaultDir, '.history.git');
    if (!existsSync(gitDir)) {
      await new Promise<void>((done) => {
        execFile('git', ['init', '--quiet', '--bare', gitDir], () => done());
      });
    }
    return c.json({ ok: true });
  });

  return api;
}
