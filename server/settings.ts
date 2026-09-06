import { execFile } from 'node:child_process';
import { writeAtomic } from './atomic.ts';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import {APP_VERSION, LOOPBACK_ONLY, VAULT, VAULT_CONFIG} from './paths.ts';
import { revokeAllSessions } from './auth.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { normaliseHomeLayout } from '../shared/homeLayout.ts';
import { normaliseTraining } from '../shared/training.ts';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.ts';
import { DEFAULT_TABLEBASE, normaliseTablebaseUrl, readTablebaseConfig } from './tablebase.ts';
import { nativeTablebase } from './tablebaseNative.ts';

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
  /** A Syzygy server of this vault's own, replacing the public one.
      Absent means the default — see server/tablebase.ts. Not a secret,
      so unlike the token it is echoed back to the page. */
  tablebaseUrl?: string;
  /** A directory of Syzygy `.rtbw`/`.rtbz` files on this machine. Set,
      and with the native binary built, it answers instead of any server
      — see server/tablebaseNative.ts. */
  tablebaseDir?: string;
  /** Which of the three sources answers — see server/tablebase.ts. */
  tablebaseSource?: string;
  profile?: Profile;
  /** What this vault is called, shown where the app names it. In the
      vault, not on a device: the phone and the desktop opening the same
      folder should agree about what it is called. Absent means the folder
      name stands in. */
  name?: string;
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
  /** Whether the client is on the machine the server runs on (see
      LOOPBACK_ONLY in server/paths.ts). Tests say yes. */
  sameMachine?: boolean;
}

/** A vault name as stored: trimmed, and absent when blank or not a string,
    so a config edited by hand cannot hand the page a number to draw. */
const cleanName = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
};

export function settingsApi(deps: SettingsDeps = {}): Hono {
  const configPath = deps.configPath ?? VAULT_CONFIG;
  const vaultDir = deps.vaultDir ?? VAULT;
  const sameMachine = deps.sameMachine ?? LOOPBACK_ONLY;
  // The session store lives beside config.json (see auth.ts). The routes
  // that rotate a credential clear it, so "everyone is signed out now"
  // stays true under random per-login tokens.
  const sessionsPath = resolve(vaultDir, 'sessions.json');

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

  const api = new Hono();

  api.get('/settings', (c) => {
    const config = readConfig();
    const token = config.lichessToken?.trim() ?? '';
    return c.json({
      profile: config.profile ?? {},
      gate: !!config.appPassword?.trim(),
      totp: !!config.totpSecret?.trim(),
      lichess: { configured: token !== '', last4: token === '' ? null : token.slice(-4) },
      // Both halves: what this vault is pointed at (null while nobody has
      // said) and what that means when nobody has, so the page can show
      // the default as a placeholder without knowing the URL itself.
      tablebase: (() => {
        const chosen = readTablebaseConfig(configPath);
        return {
          // The named choice, and both fields, whichever is live — the
          // page shows the one its choice needs and keeps the other.
          source: chosen.source,
          url: normaliseTablebaseUrl(config.tablebaseUrl),
          fallback: DEFAULT_TABLEBASE,
          dir: chosen.dir,
          // Whether the chosen source can actually answer right now. A
          // folder that has gone, or a build with no native binary,
          // falls back to a server; a page that did not say so would be
          // lying by omission.
          local: chosen.source === 'files' && chosen.dir !== null && nativeTablebase(chosen.dir) !== null,
          // Whether asking for a filesystem path is a fair question at
          // all: on a server in another room the person reading this is
          // not the person who can see its disks (server/paths.ts).
          sameMachine,
        };
      })(),
      // Normalised on the way out as well as in: a config edited by hand
      // must not be able to hand the page something it cannot draw.
      home: normaliseHomeLayout(config.home),
      training: normaliseTraining(config.training),
      vaultPath: vaultDir,
      name: cleanName(config.name) ?? null,
      version: APP_VERSION,
    });
  });

  // --- vault name ----------------------------------------------------------
  // Blank forgets it, so the folder name stands in again; the cap is what a
  // sidebar foot can show without becoming a paragraph.
  api.put('/settings/name', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
    if (!body || typeof body !== 'object' || (body.name !== undefined && typeof body.name !== 'string')) {
      return c.json({ error: 'invalid name' }, 400);
    }
    if (typeof body.name === 'string' && body.name.trim().length > 60) {
      return c.json({ error: 'name is too long' }, 400);
    }
    const name = cleanName(body.name);
    writeConfig((config) => {
      if (name === undefined) delete config.name;
      else config.name = name;
    });
    return c.json({ ok: true });
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
    // Either form verifies: the scrypt hash every write below leaves, or
    // the plaintext of a config that predates hashing (see password.ts).
    const current = config.appPassword?.trim() || null;
    if (current && !verifyPassword(body.current ?? '', current)) {
      return c.json({ error: 'current password is wrong' }, 403);
    }
    const next = body.next?.trim() ?? '';
    if (next.length < 8) return c.json({ error: 'new password must be at least 8 characters' }, 400);
    writeConfig((cfg) => {
      cfg.appPassword = hashPassword(next);
    });
    // Sessions are random per-login tokens, so a changed password does not
    // strand them by itself — clear the store, so this means what it always
    // has: every session, including this one, is invalid now. The client
    // re-logs-in.
    revokeAllSessions(sessionsPath);
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

  /**
   * Point this vault at a Syzygy server of its own, or back at the
   * public one.
   *
   * One route rather than a PUT and a DELETE: the control is a text box,
   * and emptying a text box IS how you say "go back to the default", so
   * an empty string removes the key instead of erroring. What it will
   * not do is store something the prober would then ignore — the
   * validation is tablebase.ts's own, so what this accepts is exactly
   * what will be asked.
   */
  /**
   * The directory of table files, or none.
   *
   * Deliberately incurious about what is there. It does not check that
   * the path exists, which it used to and should not have: answering
   * 400 for "no such directory" and 200 otherwise turned this route
   * into a way to ask which paths exist on the server, and a vault with
   * no password has nothing in front of it. What is there is the
   * prober's business anyway — a folder holding three of the 145 files
   * is a legitimate setup — and whether it actually answers comes back
   * as `local`, which is the useful signal and not an existence oracle,
   * since a false also means "no native binary".
   */
  api.put('/settings/tablebase-dir', async (c) => {
    // Only from the machine itself, which is the only place the page
    // offers the box (`sameMachine` above). The route answered from
    // anywhere, and `local` below says whether the folder exists on the
    // server's disk, which from across a network is a way to ask about
    // paths that are none of the asker's business.
    if (!sameMachine) {
      return c.json({ error: 'the table folder can only be set on the machine the server runs on' }, 403);
    }
    const body = (await c.req.json().catch(() => ({}))) as { dir?: unknown };
    const dir = typeof body.dir === 'string' ? body.dir.trim() : '';
    if (dir.length > 4096) return c.json({ error: 'that path is too long' }, 400);
    writeConfig((config) => {
      if (dir === '') delete config.tablebaseDir;
      else config.tablebaseDir = dir;
    });
    return c.json({ ok: true, dir: dir || null, local: dir !== '' && nativeTablebase(dir) !== null });
  });

  /**
   * Which of the three answers this vault's endgames.
   *
   * Stored rather than inferred from which field holds something: that
   * inference WAS the panel's confusion — three controls implying a
   * precedence nobody could see, and no way back to the public server
   * except by emptying boxes.
   */
  api.put('/settings/tablebase-source', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { source?: unknown };
    const source = body.source;
    if (source !== 'lichess' && source !== 'server' && source !== 'files') {
      return c.json({ error: 'unknown tablebase source' }, 400);
    }
    writeConfig((config) => {
      config.tablebaseSource = source;
    });
    const chosen = readTablebaseConfig(configPath);
    return c.json({
      ok: true,
      source,
      local: source === 'files' && chosen.dir !== null && nativeTablebase(chosen.dir) !== null,
    });
  });

  api.put('/settings/tablebase', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { url?: unknown };
    const raw = typeof body.url === 'string' ? body.url.trim() : '';
    if (raw === '') {
      writeConfig((config) => {
        delete config.tablebaseUrl;
      });
      return c.json({ ok: true, url: null });
    }
    const url = normaliseTablebaseUrl(raw);
    if (!url) {
      return c.json({ error: 'that is not a tablebase address. Use http:// or https://, with no query' }, 400);
    }
    writeConfig((config) => {
      config.tablebaseUrl = url;
    });
    return c.json({ ok: true, url });
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
      return c.json({ error: 'set an app password first, 2FA guards the password gate' }, 400);
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
      return c.json({ error: 'that code does not match, scan the QR again and retype' }, 403);
    }
    writeConfig((config) => {
      config.totpSecret = secret;
    });
    // Enabling 2FA evicts every session — a device signed in before the
    // authenticator existed has never passed it.
    revokeAllSessions(sessionsPath);
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
    // Same eviction on the way off: 2FA changing in either direction is a
    // credential rotation.
    revokeAllSessions(sessionsPath);
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
    if (gate && !verifyPassword(body.password ?? '', gate)) {
      return c.json({ error: 'password required to wipe' }, 403);
    }
    // Everything in the vault goes — games, studies, notes, puzzles, books,
    // sources, the fine-grained history repo — except config.json, which
    // holds the password, 2FA and tokens that let the owner back in, and
    // sessions.json, so wiping the data does not also sign the wiper out.
    for (const entry of readdirSync(vaultDir)) {
      if (entry === 'config.json' || entry === 'sessions.json' || entry === '.gitkeep') continue;
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
