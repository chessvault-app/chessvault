import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, KeyRound, Palette, ShieldCheck, Trash2, User } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { BOARD_THEMES, PIECE_SETS, usePrefs, type BoardTheme, type PieceSet } from '@/store/prefs';

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

  const refresh = async (): Promise<void> => {
    const res = await fetch('/api/settings');
    if (res.ok) setSettings((await res.json()) as Settings);
  };
  useEffect(() => {
    void refresh();
  }, []);

  if (!settings) return <div className="h-full" />;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-10 md:p-6">
        <header className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
          <span className="text-subtle text-xs">Chess Vault {settings.version}</span>
        </header>

        <ProfileCard settings={settings} onSaved={refresh} />
        <AppearanceCard />
        <SecurityCard settings={settings} onChanged={refresh} />
        <LichessCard settings={settings} onChanged={refresh} />
        <DangerCard />

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
          <Input inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} autoCapitalize="none" />
        </Field>
        <Field label="Lichess username">
          <Input inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} autoCapitalize="none" />
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

// --- Appearance --------------------------------------------------------------

function AppearanceCard() {
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, sound, setBoardTheme, setPieces, setSound } = usePrefs();

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

      <span className="text-muted text-xs font-medium">Board</span>
      <div className="flex flex-wrap gap-2">
        {BOARD_THEMES.map(({ id, label }) => (
          <BoardSwatch key={id} id={id} label={label} active={boardTheme === id} onPick={() => setBoardTheme(id)} />
        ))}
      </div>

      <Field label="Pieces">
        <Select
          value={pieces}
          onChange={(v) => setPieces(v as PieceSet)}
          ariaLabel="Piece set"
          groups={[{ options: PIECE_SETS.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      <div className="flex items-center justify-between">
        <span className="text-sm">Move sounds</span>
        <Switch checked={sound} onToggle={() => setSound(!sound)} label="Move sounds" />
      </div>
    </Card>
  );
}

/** The swatch paints with the same tokens the real board uses, by scoping
    the preset attribute to itself — an honest preview, not a copy of the
    palette. */
function BoardSwatch({
  id,
  label,
  active,
  onPick,
}: {
  id: BoardTheme;
  label: string;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={
        'flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-colors ' +
        (active ? 'border-primary bg-primary-soft' : 'border-line hover:bg-surface-2')
      }
      {...(id !== 'default' && { 'data-board': id })}
    >
      <span
        aria-hidden
        className="block size-10 rounded-sm"
        style={{
          backgroundColor: 'var(--board-light)',
          backgroundImage: 'repeating-conic-gradient(var(--board-dark) 0% 25%, transparent 0% 50%)',
          backgroundSize: '50% 50%',
        }}
      />
      <span className="text-subtle max-w-20 text-center text-[0.625rem] leading-tight">{label}</span>
      {active && <Check className="text-primary size-3" />}
    </button>
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
        <Input
          inputSize="lg"
          type="password"
          autoComplete="off"
          placeholder="lip_…"
          className="flex-1"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
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

function DangerCard() {
  const [phrase, setPhrase] = useState('');
  const [note, setNote] = useState<Note>(null);

  const wipe = async (): Promise<void> => {
    const res = await json('POST', '/api/settings/wipe', { confirm: phrase });
    if (!res.ok) {
      setNote({ kind: 'error', text: 'The confirmation phrase did not match.' });
      return;
    }
    setNote({ kind: 'ok', text: 'Vault wiped — reloading…' });
    setTimeout(() => window.location.reload(), 900);
  };

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
        <Button variant="danger" disabled={phrase !== WIPE_PHRASE} onClick={() => void wipe()}>
          Wipe all data
        </Button>
      </div>
      <Feedback note={note} />
    </Card>
  );
}
