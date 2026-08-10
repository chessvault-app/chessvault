import { useEffect, useState } from 'react';
import { SkeletonForm, useSlowLoad } from '@/ui/Skeleton';
import QRCode from 'qrcode';
import { ChevronLeft, Eye, EyeOff, KeyRound, MonitorSmartphone, Palette, ShieldCheck, Trash2, User } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { cn } from '@/lib/cn';
import { BOARD_THEMES, PIECE_SETS, SCHEME_PRESETS, usePrefs, type BoardTheme, type PieceSet } from '@/store/prefs';

interface Settings {
  profile: { name?: string; chesscom?: string; lichess?: string };
  gate: boolean;
  totp: boolean;
  lichess: { configured: boolean; last4: string | null };
  vaultPath: string;
  version: string;
}

const json = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

/** A change that rotated the session secret: every cookie is dead, so the
    cleanest continuation is the lock screen with fresh state. */
const reauth = (): void => {
  setTimeout(() => window.location.reload(), 1200);
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const pending = useSlowLoad(settings === null);

  const refresh = async (): Promise<void> => {
    const res = await fetch('/api/settings');
    if (res.ok) setSettings((await res.json()) as Settings);
  };
  useEffect(() => {
    void refresh();
  }, []);

  // Settings arrive fast on a local server, so nothing is shown at all
  // unless the wait is long enough to notice.
  if (!settings) {
    return (
      <div className="h-full overflow-y-auto">{pending && <SkeletonForm groups={3} />}</div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-10 md:p-6">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              title="Back"
              onClick={() => window.history.back()}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          </div>
          <span className="text-subtle text-xs">Chess Vault {settings.version}</span>
        </header>

        <ProfileCard settings={settings} onSaved={refresh} />
        <DesktopCard />
        <AppearanceCard />
        <SecurityCard settings={settings} onChanged={refresh} />
        <LichessCard settings={settings} onChanged={refresh} />
        <DangerCard gate={settings.gate} />

        <p className="text-subtle text-xs leading-relaxed">
          Vault: <span className="font-mono">{settings.vaultPath}</span> — every game, study and
          puzzle lives there as plain files. Display settings live on this device.
        </p>
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border-line rounded-xl border p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon className="text-muted size-4" />
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function Feedback({ note }: { note: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!note) return null;
  return (
    <p className={note.kind === 'ok' ? 'text-good text-xs' : 'text-bad text-xs'} role="status">
      {note.text}
    </p>
  );
}

type Note = { kind: 'ok' | 'error'; text: string } | null;

// --- Profile -----------------------------------------------------------------

function ProfileCard({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(settings.profile.name ?? '');
  const [chesscom, setChesscom] = useState(settings.profile.chesscom ?? '');
  const [lichess, setLichess] = useState(settings.profile.lichess ?? '');
  const [note, setNote] = useState<Note>(null);

  const save = async (): Promise<void> => {
    const res = await json('PUT', '/api/settings/profile', { name, chesscom, lichess });
    setNote(res.ok ? { kind: 'ok', text: 'Saved.' } : { kind: 'error', text: 'Could not save.' });
    if (res.ok) await onSaved();
  };

  return (
    <Card icon={User} title="Profile">
      <Field label="Display name">
        <Input inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="How the app greets you" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="chess.com username">
          <Input inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder="your chess.com handle" autoCapitalize="none" />
        </Field>
        <Field label="Lichess username">
          <Input inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder="your Lichess handle" autoCapitalize="none" />
        </Field>
      </div>
      <p className="text-subtle text-xs">Usernames pre-fill the archive browser on the Games page.</p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()}>Save profile</Button>
        <Feedback note={note} />
      </div>
    </Card>
  );
}

// --- Desktop shell -----------------------------------------------------------

/**
 * The shell's own settings, and only when there is a shell.
 *
 * The app talks HTTP and nothing else — that rule is why the desktop build
 * can lag or disappear without leaving debt. This does not break it: the
 * control is feature-detected, so in a browser the card is simply not
 * there, and what it calls is the shell's configuration bridge rather than
 * anything the app depends on.
 *
 * It is here because the alternative was a menu bar hidden behind Alt,
 * which is not a way anybody finds a setting.
 */
interface VaultShell {
  switchVault?: () => Promise<void>;
}

function DesktopCard() {
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;
  // switchVault is newer than the bridge itself, so an older shell shows
  // no card rather than a button that does nothing.
  if (!shell?.switchVault) return null;
  return (
    <Card icon={MonitorSmartphone} title="Desktop app">
      <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">Vault</div>
          <div className="text-subtle text-xs">
            Point this window at a server, or host a folder on this machine.
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void shell.switchVault!()}>
          Switch…
        </Button>
      </div>
    </Card>
  );
}

// --- Appearance --------------------------------------------------------------

/** Shown in the empty custom-CSS box: the shape of an answer, not a lecture. */
const CUSTOM_CSS_EXAMPLE = [
  ':root {',
  '  --primary: oklch(70% 0.15 300);',
  '  --app-bg: oklch(97% 0.01 300);',
  '}',
].join(String.fromCharCode(10));

function AppearanceCard() {
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, sound, schemeId, customCss, setBoardTheme, setPieces, setSound, setSchemeId, setCustomCss } =
    usePrefs();

  return (
    <Card icon={Palette} title="Appearance">
      <Field label="App theme">
        <Select
          value={theme}
          onChange={(v) => setTheme(v as ThemePreference)}
          ariaLabel="App theme"
          groups={[{ options: [
            { value: 'system', label: 'Follow system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ] }]}
        />
      </Field>

      <Field label="Colours">
        <div className="flex flex-col gap-2">
          {/* Swatches rather than a dropdown: a colour scheme is the one
              setting whose name tells you least about it. */}
          <div className="flex flex-wrap gap-1.5">
            {SCHEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={schemeId === preset.id}
                onClick={() => setSchemeId(preset.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-100',
                  schemeId === preset.id
                    ? 'border-primary/60 bg-primary-soft text-primary'
                    : 'border-line text-muted hover:border-line-strong hover:text-fg',
                )}
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{
                    background: `oklch(58% 0.135 ${preset.scheme.accent})`,
                    outline: `2px solid oklch(90% ${0.006 * preset.scheme.tint} ${preset.scheme.hue})`,
                  }}
                />
                {preset.label}
              </button>
            ))}
          </div>

          {/* Raw CSS rather than a few sliders: three knobs can only make
              the themes those three knobs describe, and someone who wants
              a particular look usually knows exactly which colour they
              want where. This overrides everything the app ships. */}
          <details className="text-xs" open={customCss.trim().length > 0}>
            <summary className="text-subtle cursor-pointer select-none py-1">Custom CSS</summary>
            <div className="flex flex-col gap-2 pt-1">
              <textarea
                value={customCss}
                onChange={(e) => setCustomCss(e.target.value)}
                spellCheck={false}
                rows={6}
                placeholder={CUSTOM_CSS_EXAMPLE}
                className="border-line bg-surface-inset text-fg min-h-0 w-full resize-y rounded-md border p-2 font-mono text-[0.6875rem] leading-relaxed outline-none focus:border-line-strong"
              />
              <p className="text-subtle leading-relaxed">
                Applied last, so it beats the preset. Colours are OKLCH tokens on{' '}
                <code className="font-mono">:root</code> — the useful ones are{' '}
                <code className="font-mono">--app-bg</code>, <code className="font-mono">--surface</code>,{' '}
                <code className="font-mono">--border</code>, <code className="font-mono">--text</code>{' '}
                and <code className="font-mono">--primary</code>. Add{' '}
                <code className="font-mono">.dark</code> before the selector to change dark mode only.
                Emptying this box removes it.
              </p>
            </div>
          </details>
        </div>
      </Field>

      <Field label="Board">
        <div className="flex items-center gap-3">
          <BoardPreview theme={boardTheme} />
          <Select
            value={boardTheme}
            onChange={(v) => setBoardTheme(v as BoardTheme)}
            ariaLabel="Board theme"
            className="flex-1"
            groups={[{ options: BOARD_THEMES.map(({ id, label }) => ({ value: id, label })) }]}
          />
        </div>
      </Field>

      <Field label="Pieces">
        <Select
          value={pieces}
          onChange={(v) => setPieces(v as PieceSet)}
          ariaLabel="Piece set"
          groups={[{ options: PIECE_SETS.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">Move sounds</div>
          <div className="text-subtle text-xs">Play a click on moves, captures and checks.</div>
        </div>
        <Switch checked={sound} onToggle={() => setSound(!sound)} label="Move sounds" />
      </div>
    </Card>
  );
}

/** A 2×2 checker painted with the live board tokens. The theme presets are
    defined on `:root[data-board=…]`, and selecting one applies it to the
    root immediately, so reading the plain vars here mirrors exactly what the
    real board shows — no hand-copied palette to drift. */
function BoardPreview({ theme }: { theme: BoardTheme }) {
  // `theme` is only a re-render trigger; the colours come from :root.
  void theme;
  return (
    <span
      aria-hidden
      className="border-line block size-9 shrink-0 rounded-md border"
      style={{
        backgroundColor: 'var(--board-light)',
        backgroundImage: 'repeating-conic-gradient(var(--board-dark) 0% 25%, transparent 0% 50%)',
        backgroundSize: '50% 50%',
      }}
    />
  );
}

// --- Security ----------------------------------------------------------------

function SecurityCard({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  return (
    <Card icon={ShieldCheck} title="Security">
      <PasswordBlock gate={settings.gate} />
      <hr className="border-line" />
      <TotpBlock settings={settings} onChanged={onChanged} />
    </Card>
  );
}

function PasswordBlock({ gate }: { gate: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState<Note>(null);

  const change = async (): Promise<void> => {
    if (next !== confirm) {
      setNote({ kind: 'error', text: 'New passwords do not match.' });
      return;
    }
    const res = await json('POST', '/api/settings/password', { current, next });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: body.error ?? 'Could not change the password.' });
      return;
    }
    setNote({ kind: 'ok', text: 'Password changed — signing you out to the lock screen…' });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{gate ? 'Change app password' : 'Set an app password'}</span>
      {!gate && (
        <p className="text-subtle text-xs">
          No password is set — anyone who can reach this server sees everything. Setting one turns
          the lock screen on.
        </p>
      )}
      {gate && (
        <Field label="Current password">
          <Input inputSize="lg" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New password">
          <Input inputSize="lg" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Repeat new password">
          <Input inputSize="lg" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={next.length < 8 || (gate && current === '')} onClick={() => void change()}>
          {gate ? 'Change password' : 'Set password'}
        </Button>
        <Feedback note={note} />
      </div>
    </div>
  );
}

function TotpBlock({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [enroll, setEnroll] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<Note>(null);

  const start = async (): Promise<void> => {
    const res = await json('POST', '/api/settings/2fa/start');
    const body = (await res.json()) as { secret?: string; otpauth?: string; error?: string };
    if (!res.ok || !body.secret || !body.otpauth) {
      setNote({ kind: 'error', text: body.error ?? 'Could not start 2FA enrolment.' });
      return;
    }
    const qr = await QRCode.toDataURL(body.otpauth, { margin: 1, width: 192 });
    setEnroll({ secret: body.secret, qr });
    setCode('');
    setNote(null);
  };

  const enable = async (): Promise<void> => {
    if (!enroll) return;
    const res = await json('POST', '/api/settings/2fa/enable', { secret: enroll.secret, code });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: body.error ?? 'Could not enable 2FA.' });
      return;
    }
    setEnroll(null);
    setNote({ kind: 'ok', text: '2FA is on — signing you out to the lock screen…' });
    await onChanged();
    reauth();
  };

  const disable = async (): Promise<void> => {
    const res = await json('POST', '/api/settings/2fa/disable', { code });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: body.error ?? 'Could not turn 2FA off.' });
      return;
    }
    setNote({ kind: 'ok', text: '2FA is off — signing you out to the lock screen…' });
    await onChanged();
    reauth();
  };

  if (settings.totp) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          Two-factor authentication
          <span className="bg-good/15 text-good rounded-full px-2 py-0.5 text-[0.625rem] font-semibold">On</span>
        </div>
        <p className="text-subtle text-xs">Turning it off needs a current code from your authenticator app.</p>
        <div className="flex items-center gap-2">
          <Input
            inputSize="lg"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            className="w-28"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button variant="danger" disabled={code.trim().length < 6} onClick={() => void disable()}>
            Turn off 2FA
          </Button>
        </div>
        <Feedback note={note} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">Two-factor authentication</span>
      {!enroll ? (
        <>
          <p className="text-subtle text-xs">
            Adds a 6-digit authenticator code (Google Authenticator, 1Password, Aegis…) to the lock
            screen. {settings.gate ? '' : 'Set an app password first.'}
          </p>
          <div className="flex items-center gap-3">
            <Button disabled={!settings.gate} onClick={() => void start()}>Set up 2FA</Button>
            <Feedback note={note} />
          </div>
        </>
      ) : (
        <>
          <p className="text-subtle text-xs">
            Scan with your authenticator app, then enter the code it shows. Nothing is saved until
            the code checks out.
          </p>
          <img src={enroll.qr} alt="TOTP enrolment QR code" className="size-40 rounded-lg bg-white p-1.5" />
          <p className="text-subtle break-all text-xs">
            Manual entry key: <span className="font-mono">{enroll.secret}</span>
          </p>
          <div className="flex items-center gap-2">
            <Input
              inputSize="lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              className="w-28"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button variant="primary" disabled={code.trim().length < 6} onClick={() => void enable()}>
              Verify &amp; enable
            </Button>
            <Button variant="ghost" onClick={() => setEnroll(null)}>Cancel</Button>
          </div>
          <Feedback note={note} />
        </>
      )}
    </div>
  );
}

// --- Lichess -----------------------------------------------------------------

function LichessCard({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [token, setToken] = useState('');
  const [show, setShow] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const save = async (): Promise<void> => {
    const res = await json('PUT', '/api/settings/lichess', { token });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: body.error ?? 'Could not save the token.' });
      return;
    }
    setToken('');
    setNote({ kind: 'ok', text: 'Token saved.' });
    await onChanged();
  };

  const clear = async (): Promise<void> => {
    await json('DELETE', '/api/settings/lichess');
    setNote({ kind: 'ok', text: 'Token removed.' });
    await onChanged();
  };

  return (
    <Card icon={KeyRound} title="Lichess token">
      <p className="text-subtle text-xs">
        Powers the online opening-explorer augmentation and Lichess puzzle history. Create one with{' '}
        <em>no scopes</em> at{' '}
        <a
          className="text-primary underline underline-offset-2"
          href="https://lichess.org/account/oauth/token/create"
          target="_blank"
          rel="noreferrer"
        >
          lichess.org/account/oauth/token/create
        </a>
        . The token is stored in the vault and never shown again.
      </p>
      {settings.lichess.configured && (
        <p className="text-muted text-xs">
          A token ending in <span className="font-mono">…{settings.lichess.last4}</span> is configured.
        </p>
      )}
      <div className="flex items-center gap-2">
        {/* A token is a secret, so it stays masked by default — but you
            paste it here, so an eye toggle lets you check it before saving. */}
        <div className="relative flex-1">
          <Input
            inputSize="lg"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            placeholder="lip_…"
            className="w-full pr-9"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            title={show ? 'Hide token' : 'Show token'}
            className="text-subtle hover:text-fg absolute inset-y-0 right-0 grid w-9 place-items-center"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button variant="primary" disabled={token.trim() === ''} onClick={() => void save()}>Save</Button>
        {settings.lichess.configured && (
          <Button variant="danger" onClick={() => void clear()}>Remove</Button>
        )}
      </div>
      <Feedback note={note} />
    </Card>
  );
}

// --- Danger zone -------------------------------------------------------------

const WIPE_PHRASE = 'wipe everything';

function DangerCard({ gate }: { gate: boolean }) {
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Card icon={Trash2} title="Danger zone">
      <p className="text-subtle text-xs leading-relaxed">
        Wipe every game, study, note, puzzle and imported book from the vault — including its
        change history. The app password, 2FA and tokens survive. There is no undo; if the vault
        matters, back it up first.
      </p>
      <div className="flex items-center gap-2">
        <Input
          inputSize="lg"
          placeholder={`Type “${WIPE_PHRASE}” to arm`}
          className="flex-1"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <Button variant="danger" disabled={phrase !== WIPE_PHRASE} onClick={() => setConfirming(true)}>
          Wipe all data
        </Button>
      </div>
      {confirming && <WipeConfirmDialog gate={gate} onClose={() => setConfirming(false)} />}
    </Card>
  );
}

/** The last gate before an irreversible wipe: a modal that (on a gated
    vault) re-asks for the password. Kept separate from the card so the
    password field only exists for the moment it's needed. */
function WipeConfirmDialog({ gate, onClose }: { gate: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);

  const wipe = async (): Promise<void> => {
    setBusy(true);
    const res = await json('POST', '/api/settings/wipe', {
      confirm: WIPE_PHRASE,
      ...(gate && { password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote({ kind: 'error', text: body.error ?? 'That did not match.' });
      setBusy(false);
      return;
    }
    setNote({ kind: 'ok', text: 'Vault wiped — reloading…' });
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6" onClick={onClose}>
      <div className="bg-scrim absolute inset-0" />
      <div
        className="bg-surface border-line relative w-full max-w-sm rounded-2xl border p-5 shadow-[var(--shadow-pop)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <div className="bg-bad/12 text-bad grid size-9 place-items-center rounded-lg">
            <Trash2 className="size-4" />
          </div>
          <h2 className="text-sm font-semibold">Wipe the entire vault?</h2>
        </div>
        <p className="text-muted mb-4 text-xs leading-relaxed">
          This permanently deletes every game, study, note, puzzle and book, and their history.
          There is no undo.
        </p>
        {gate && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-muted text-xs font-medium">Confirm your app password</span>
            <Input
              autoFocus
              inputSize="lg"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && password !== '' && void wipe()}
            />
          </label>
        )}
        <Feedback note={note} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy || (gate && password === '')} onClick={() => void wipe()}>
            {busy ? 'Wiping…' : 'Wipe everything'}
          </Button>
        </div>
      </div>
    </div>
  );
}
