import { useEffect, useState } from 'react';
import { SkeletonForm, useSlowLoad } from '@/ui/Skeleton';
import QRCode from 'qrcode';
import { ChevronLeft, Eye, EyeOff, HardDrive, Info, KeyRound, MonitorSmartphone, Palette, ShieldCheck, Trash2, User, Volume2 } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Switch } from '@/ui/Switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { cn } from '@/lib/cn';
import { BOARD_THEMES, CAPTURE_SOUNDS, CASTLE_STYLES, MOVE_SOUNDS, PIECE_SETS, SCHEME_PRESETS, usePrefs, type BoardTheme, type CastleStyle, type PieceSet, type SoundChoice } from '@/store/prefs';
import { previewSound } from '@/board/sound';
import { t, getLang, setLang, LANGS, type Lang } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';

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

  // Nothing here knows about the keyboard any more. This box used to pad
  // itself by what the keyboard covered, and to claim the phone's bottom
  // bar so the tab row could not ride up onto the keys — both from when
  // the shell was 100svh and ran on underneath. The shell ends at the
  // keyboard now and the bar hides itself while typing, so padding again
  // only pushed the bottom of the page out of a box with nothing under it.
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4 pb-10 md:p-6">
        <header className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              title={t('Back')}
              onClick={() => window.history.back()}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{t('Settings')}</h1>
          </div>
        </header>

        {/* Appearance is the only card that works without a server: it
            writes to this device, not to a vault. The rest change a vault or
            a secret, so in the demo they are described rather than shown —
            a disabled form a visitor can fill in and not submit is a worse
            explanation than a sentence. */}
        {isDemo() ? (
          <>
            <AppearanceCard />
            <SoundCard />
            <Card icon={Info} title={t('This is a demo')}>
              <p className="text-subtle text-xs leading-relaxed">
                {t(
                  'Everything you change here lives in this browser tab and disappears when you reload. Your profile, password, two-factor authentication, the Lichess token and the vault itself need a server of your own — install the app or host it, and this page becomes the real thing.',
                )}
              </p>
            </Card>
            <VersionCard />
          </>
        ) : (
          <>
            <ProfileCard settings={settings} onSaved={refresh} />
            <DesktopCard />
            <AppearanceCard />
            <SoundCard />
            <SecurityCard settings={settings} onChanged={refresh} />
            <LichessCard settings={settings} onChanged={refresh} />
            <BrowsedGamesCard />
            <DangerCard gate={settings.gate} />
            <VersionCard />
          </>
        )}

        {!isDemo() && (
          <p className="text-subtle text-xs leading-relaxed">
            {t('Vault:')} <span className="font-mono">{settings.vaultPath}</span>{' '}
            {t('— every game, study and puzzle lives there as plain files. Display settings live on this device.')}
          </p>
        )}
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

/**
 * A labelled GROUP of controls, which must not be a <label>.
 *
 * Clicking the dead space in a label activates its first labelable
 * descendant — so a row of theme swatches inside one meant that clicking
 * beside them silently pressed the first swatch and reset the colours to
 * default. A label points at one control; this points at several.
 */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <span className="text-muted text-xs font-medium">{label}</span>
      {children}
    </div>
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
    setNote(res.ok ? { kind: 'ok', text: t('Saved.') } : { kind: 'error', text: t('Could not save.') });
    if (res.ok) await onSaved();
  };

  return (
    <Card icon={User} title={t('Profile')}>
      <Field label={t('Display name')}>
        <Input inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('How the app greets you')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('chess.com username')}>
          <Input inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder={t('your chess.com handle')} autoCapitalize="none" />
        </Field>
        <Field label={t('Lichess username')}>
          <Input inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder={t('your Lichess handle')} autoCapitalize="none" />
        </Field>
      </div>
      <p className="text-subtle text-xs">{t('Usernames pre-fill the archive browser on the Games page.')}</p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={() => void save()}>{t('Save profile')}</Button>
        <Feedback note={note} />
      </div>
    </Card>
  );
}

// --- Version -----------------------------------------------------------------

interface UpdateResult {
  state: 'dev' | 'current' | 'available' | 'failed';
  version?: string;
  error?: string;
}

/**
 * What is running, and whether it is current.
 *
 * The server's version always shows. The desktop shell's own version and
 * its update check only appear inside the shell — and they exist because
 * the automatic check on launch reported to a console, so an update that
 * silently failed was indistinguishable from no update existing.
 */
function VersionCard() {
  const [server, setServer] = useState<string | null>(null);
  const [build, setBuild] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;

  useEffect(() => {
    void fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b: { version?: string; build?: string | null }) => {
        setServer(b.version ?? null);
        setBuild(b.build ?? null);
      })
      .catch(() => setServer(null));
    void shell?.appInfo?.().then((info) => setApp(info?.version ?? null));
  }, [shell]);

  const check = async (): Promise<void> => {
    if (!shell?.checkForUpdates) return;
    setChecking(true);
    setUpdate(await shell.checkForUpdates());
    setChecking(false);
  };

  return (
    <Card icon={Info} title={t('Version')}>
      {/* Named, because the header used to show a bare "Chess Vault 0.2.1"
          that was the SERVER's version and read as the app's — which is
          how a desktop app sat on 0.1.0 while its own settings page
          appeared to say otherwise. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-subtle">{t('Server')}</dt>
        <dd className="text-fg font-mono">{server ?? '—'}</dd>
        {/* Which BUILD, not which release. The version only moves once per
            release, so between releases it cannot tell a just-deployed app
            from one the phone has been holding in a cache — the question
            that comes up every time a fix will not reproduce. */}
        {build && (
          <>
            <dt className="text-subtle">{t('Built')}</dt>
            <dd className="text-fg font-mono">{build}</dd>
          </>
        )}
        {app && (
          <>
            <dt className="text-subtle">{t('Desktop app')}</dt>
            <dd className="text-fg font-mono">{app}</dd>
          </>
        )}
      </dl>
      {/* Wraps rather than sitting on one line: an update failure is a
          sentence, and on a narrow card it used to run out past the panel's
          edge instead of onto a second line. */}
      {shell?.checkForUpdates && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={checking} onClick={() => void check()}>
            {checking ? t('Checking…') : t('Check for updates')}
          </Button>
          {update && (
            <span
              className={cn(
                'min-w-0 flex-1 break-words text-xs',
                update.state === 'failed' ? 'text-bad' : 'text-muted',
              )}
            >
              {update.state === 'available'
                ? t('{version} is available — it installs when you quit.', { version: update.version ?? '' })
                : update.state === 'current'
                  ? t('This is the newest build.')
                  : update.state === 'dev'
                    ? t('Not a packaged build.')
                    : t('Could not check: {reason}', { reason: update.error ?? t('no answer') })}
            </span>
          )}
        </div>
      )}
      {/* The source link is not decoration: pirouetti's pieces are AGPLv3,
          whose §13 owes an offer of source to anyone using the app over a
          network — which is every visitor to the demo. The licence texts
          ship with the build (web/vite.licenses.ts) so a copy that was
          conveyed carries them, rather than pointing at a repository the
          reader may never open. */}
      <p className="text-subtle text-xs leading-relaxed">
        {t('Free software under the GPL-3.0.')}{' '}
        <a
          className="text-primary underline underline-offset-2"
          href={__REPO_URL__}
          target="_blank"
          rel="noreferrer"
        >
          {t('Source code')}
        </a>
        {' · '}
        <a
          className="text-primary underline underline-offset-2"
          href={`${import.meta.env.BASE_URL}licenses/index.html`}
          target="_blank"
          rel="noreferrer"
        >
          {t('Licences')}
        </a>
      </p>
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
  appInfo?: () => Promise<{ version?: string } | undefined>;
  checkForUpdates?: () => Promise<UpdateResult>;
}

function DesktopCard() {
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;
  // switchVault is newer than the bridge itself, so an older shell shows
  // no card rather than a button that does nothing.
  if (!shell?.switchVault) return null;
  return (
    <Card icon={MonitorSmartphone} title={t('Desktop app')}>
      <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('Vault')}</div>
          <div className="text-subtle text-xs">
            {t('Point this window at a server, or host a folder on this machine.')}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void shell.switchVault!()}>
          {t('Switch…')}
        </Button>
      </div>
    </Card>
  );
}

// --- Appearance --------------------------------------------------------------

function AppearanceCard() {
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, schemeId, castleStyle, setBoardTheme, setPieces, setSchemeId, setCastleStyle } =
    usePrefs();

  return (
    <Card icon={Palette} title={t('Appearance')}>
      {/* Language leads: it changes every other label on this page, so
          reading it first is what makes the rest of the card make sense. */}
      <Field label={t('App language')}>
        <Select
          value={getLang()}
          onChange={(v) => setLang(v as Lang)}
          ariaLabel={t('App language')}
          groups={[{ options: LANGS.map((l) => ({ value: l.id, label: l.label })) }]}
        />
      </Field>

      <Field label={t('App theme')}>
        <Select
          value={theme}
          onChange={(v) => setTheme(v as ThemePreference)}
          ariaLabel={t('App theme')}
          groups={[{ options: [
            { value: 'system', label: 'Follow system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ] }]}
        />
      </Field>

      <FieldGroup label={t('Colours')}>
        <div className="flex flex-col gap-2">
          {/* Swatches rather than a dropdown: a colour scheme is the one
              setting whose name tells you least about it. */}
          <div className="flex flex-wrap gap-1.5">
            {SCHEME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={t(preset.label)}
                aria-label={t(preset.label)}
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
                    // The dot has to be able to be grey, or Greyscale
                    // advertises itself with a blue spot.
                    background: `oklch(58% ${0.135 * (preset.scheme.accentTint ?? 1)} ${preset.scheme.accent})`,
                    outline: `2px solid oklch(90% ${0.006 * preset.scheme.tint} ${preset.scheme.hue})`,
                  }}
                />
                {t(preset.label)}
              </button>
            ))}
          </div>

        </div>
      </FieldGroup>

      <Field label={t('Board')}>
        <div className="flex items-center gap-3">
          <BoardPreview theme={boardTheme} />
          <Select
            value={boardTheme}
            onChange={(v) => setBoardTheme(v as BoardTheme)}
            ariaLabel={t('Board theme')}
            className="flex-1"
            groups={[{ options: BOARD_THEMES.map(({ id, label }) => ({ value: id, label })) }]}
          />
        </div>
      </Field>

      <Field label={t('Castling')}>
        <Select
          value={castleStyle}
          onChange={(v) => setCastleStyle(v as CastleStyle)}
          ariaLabel={t('How to castle')}
          groups={[{ options: CASTLE_STYLES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      <Field label={t('Pieces')}>
        <Select
          value={pieces}
          onChange={(v) => setPieces(v as PieceSet)}
          ariaLabel={t('Piece set')}
          groups={[{ options: PIECE_SETS.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

    </Card>
  );
}

// --- Sound ---------------------------------------------------------------

/**
 * Numbered options, or the rotating one — see MOVE_SOUNDS for the order.
 *
 * Named per kind ("Move 3", "Capture 3") rather than a bare number, so a
 * choice read aloud or written down still says which sound it is.
 */
const soundOption =
  (kind: 'Move' | 'Capture') =>
  ({ id, take }: SoundChoice): { value: string; label: string } => ({
    value: id,
    label:
      take === null
        ? t('Rotate through all')
        : kind === 'Move'
          ? t('Move {n}', { n: take })
          : t('Capture {n}', { n: take }),
  });


/**
 * Its own card rather than one switch under Appearance.
 *
 * Choosing a sound is the one setting on this page that cannot be judged by
 * reading it, so every control here plays what it does the moment it
 * changes — picking from a dropdown IS the audition, with no separate
 * preview step to find.
 */
function SoundCard() {
  const { sound, soundVolume, moveSound, captureSound, setSound, setSoundVolume, setMoveSound, setCaptureSound } =
    usePrefs();

  return (
    <Card icon={Volume2} title={t('Sound')}>
      <div className="border-line bg-surface-inset flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium">{t('Move sounds')}</div>
          <div className="text-subtle text-xs">{t('Play a click on moves and captures.')}</div>
        </div>
        <Switch checked={sound} onToggle={() => setSound(!sound)} label={t('Move sounds')} />
      </div>

      <label className={cn('grid gap-1', !sound && 'opacity-50')}>
        <span className="flex items-baseline justify-between text-xs">
          <span className="text-muted">{t('Volume')}</span>
          <span className="text-fg font-mono tabular-nums">{Math.round(soundVolume * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(soundVolume * 100)}
          disabled={!sound}
          // Preview on release rather than on every step: dragging fires
          // dozens of times and would machine-gun the sample.
          onChange={(e) => setSoundVolume(Number(e.target.value) / 100)}
          onPointerUp={() => previewSound('move', moveSound)}
          onKeyUp={() => previewSound('move', moveSound)}
          className="accent-primary h-1 w-full cursor-pointer"
          aria-label={t('Volume')}
        />
      </label>

      <Field label={t('Move sound')}>
        <Select
          value={moveSound}
          onChange={(v) => {
            setMoveSound(v);
            previewSound('move', v);
          }}
          ariaLabel={t('Move sound')}
          groups={[{ options: MOVE_SOUNDS.map(soundOption('Move')) }]}
        />
      </Field>

      <Field label={t('Capture sound')}>
        <Select
          value={captureSound}
          onChange={(v) => {
            setCaptureSound(v);
            previewSound('capture', v);
          }}
          ariaLabel={t('Capture sound')}
          groups={[{ options: CAPTURE_SOUNDS.map(soundOption('Capture')) }]}
        />
      </Field>

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
    <Card icon={ShieldCheck} title={t('Security')}>
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
      setNote({ kind: 'error', text: t('New passwords do not match.') });
      return;
    }
    const res = await json('POST', '/api/settings/password', { current, next });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: t(body.error ?? 'Could not change the password.') });
      return;
    }
    setNote({ kind: 'ok', text: t('Password changed — signing you out to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{gate ? t('Change app password') : t('Set an app password')}</span>
      {!gate && (
        <p className="text-subtle text-xs">
          {t('No password is set — anyone who can reach this server sees everything. Setting one turns the lock screen on.')}
        </p>
      )}
      {gate && (
        <Field label={t('Current password')}>
          <Input inputSize="lg" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('New password')}>
          <Input inputSize="lg" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label={t('Repeat new password')}>
          <Input inputSize="lg" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={next.length < 8 || (gate && current === '')} onClick={() => void change()}>
          {t(gate ? 'Change password' : 'Set password')}
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
      setNote({ kind: 'error', text: t(body.error ?? 'Could not start 2FA enrolment.') });
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
      setNote({ kind: 'error', text: t(body.error ?? 'Could not enable 2FA.') });
      return;
    }
    setEnroll(null);
    setNote({ kind: 'ok', text: t('2FA is on — signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  const disable = async (): Promise<void> => {
    const res = await json('POST', '/api/settings/2fa/disable', { code });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) {
      setNote({ kind: 'error', text: t(body.error ?? 'Could not turn 2FA off.') });
      return;
    }
    setNote({ kind: 'ok', text: t('2FA is off — signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  if (settings.totp) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          {t('Two-factor authentication')}
          <span className="bg-good/15 text-good rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold">{t('On')}</span>
        </div>
        <p className="text-subtle text-xs">{t('Turning it off needs a current code from your authenticator app.')}</p>
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
            {t('Turn off 2FA')}
          </Button>
        </div>
        <Feedback note={note} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{t('Two-factor authentication')}</span>
      {!enroll ? (
        <>
          <p className="text-subtle text-xs">
            {t('Adds a 6-digit authenticator code (Google Authenticator, 1Password, Aegis…) to the lock screen.')}{' '}
            {settings.gate ? '' : t('Set an app password first.')}
          </p>
          <div className="flex items-center gap-3">
            <Button disabled={!settings.gate} onClick={() => void start()}>{t('Set up 2FA')}</Button>
            <Feedback note={note} />
          </div>
        </>
      ) : (
        <>
          <p className="text-subtle text-xs">
            {t('Scan with your authenticator app, then enter the code it shows. Nothing is saved until the code checks out.')}
          </p>
          <img src={enroll.qr} alt={t('TOTP enrolment QR code')} className="size-40 rounded-lg bg-white p-1.5" />
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
              {t('Verify & enable')}
            </Button>
            <Button variant="ghost" onClick={() => setEnroll(null)}>{t('Cancel')}</Button>
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
      setNote({ kind: 'error', text: t(body.error ?? 'Could not save the token.') });
      return;
    }
    setToken('');
    setNote({ kind: 'ok', text: t('Token saved.') });
    await onChanged();
  };

  const clear = async (): Promise<void> => {
    await json('DELETE', '/api/settings/lichess');
    setNote({ kind: 'ok', text: t('Token removed.') });
    await onChanged();
  };

  return (
    <Card icon={KeyRound} title={t('Lichess token')}>
      {/* One sentence, one string. Assembling it around the link left the
          tail in English while the head was Korean, and no translator can
          fix a sentence that is three fragments in the source. */}
      <p className="text-subtle text-xs">
        {t('Powers the online opening explorer and your Lichess puzzle history. Create one with no scopes, then paste it here — it is stored in the vault and never shown again.')}
      </p>
      <a
        className="text-primary text-xs underline underline-offset-2"
        href="https://lichess.org/account/oauth/token/create"
        target="_blank"
        rel="noreferrer"
      >
        lichess.org/account/oauth/token/create
      </a>
      {settings.lichess.configured && (
        <p className="text-muted text-xs">
          {t('A token ending in {last4} is configured.', { last4: `…${settings.lichess.last4}` })}
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
        <Button variant="primary" disabled={token.trim() === ''} onClick={() => void save()}>{t('Save')}</Button>
        {settings.lichess.configured && (
          <Button variant="danger" onClick={() => void clear()}>{t('Remove')}</Button>
        )}
      </div>
      <Feedback note={note} />
    </Card>
  );
}

// --- Danger zone -------------------------------------------------------------

const WIPE_PHRASE = 'wipe everything';

// --- Browsed games -----------------------------------------------------------

interface CachedPlayer {
  provider: 'chesscom' | 'lichess';
  user: string;
  months: number;
  bytes: number;
}

const PROVIDER_NAME: Record<string, string> = { chesscom: 'chess.com', lichess: 'Lichess' };

/** Bytes as something readable; a cache of a few megabytes should not be
    reported in seven digits. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Everything browsing has left on disk, and the way to be rid of it.
 *
 * Looking at a month keeps it, so that it browses offline afterwards and
 * so that a second look costs nothing. Nothing ever removed one — look up
 * a dozen players out of curiosity and the vault is quietly holding a
 * dozen players' entire histories, none of it in the collection and none
 * of it mentioned anywhere in the app. This is the mention, and the
 * button.
 */
function BrowsedGamesCard() {
  const [players, setPlayers] = useState<CachedPlayer[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const res = await fetch('/api/games/cache');
    if (res.ok) setPlayers(((await res.json()) as { users: CachedPlayer[] }).users);
  };
  useEffect(() => {
    void refresh();
  }, []);

  // All of it. The list is here to SAY what is being held — whose history,
  // how much — not to be picked through: choosing which player to keep is
  // a question nobody has about data that costs one fetch to get back.
  const clear = async (): Promise<void> => {
    setBusy(true);
    await json('DELETE', '/api/games/cache');
    await refresh();
    setBusy(false);
  };

  const total = (players ?? []).reduce((sum, p) => sum + p.bytes, 0);

  return (
    <Card icon={HardDrive} title={t('Browsed games')}>
      <p className="text-subtle text-xs leading-relaxed">
        {t(
          'Months you have browsed are kept so they open again instantly and work offline. Nothing here is in your collection — a game you kept was copied — so clearing this only means downloading a month again next time you look at it.',
        )}
      </p>
      {players !== null && players.length === 0 && (
        <p className="text-subtle text-xs">{t('Nothing cached yet.')}</p>
      )}
      {players !== null && players.length > 0 && (
        <>
          <ul className="divide-line border-line divide-y rounded-lg border">
            {players.map((p) => (
              <li key={`${p.provider}/${p.user}`} className="flex items-baseline gap-2 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-sm">{p.user}</p>
                <p className="text-subtle shrink-0 text-xs">
                  {PROVIDER_NAME[p.provider] ?? p.provider} · {t('{n} months', { n: p.months })} ·{' '}
                  {size(p.bytes)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-subtle text-xs">{t('{size} in total', { size: size(total) })}</span>
            <Button variant="ghost" disabled={busy} onClick={() => void clear()}>
              {t('Clear all')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function DangerCard({ gate }: { gate: boolean }) {
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Card icon={Trash2} title={t('Danger zone')}>
      <p className="text-subtle text-xs leading-relaxed">
        {t('Wipe every game, study, note, puzzle and imported book from the vault — including its change history. The app password, 2FA and tokens survive. There is no undo; if the vault matters, back it up first.')}
      </p>
      <div className="flex items-center gap-2">
        <Input
          inputSize="lg"
          placeholder={t('Type “{phrase}” to arm', { phrase: WIPE_PHRASE })}
          className="flex-1"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <Button variant="danger" disabled={phrase !== WIPE_PHRASE} onClick={() => setConfirming(true)}>
          {t('Wipe all data')}
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
      setNote({ kind: 'error', text: t(body.error ?? 'That did not match.') });
      setBusy(false);
      return;
    }
    setNote({ kind: 'ok', text: t('Vault wiped — reloading…') });
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
          <h2 className="text-sm font-semibold">{t('Wipe the entire vault?')}</h2>
        </div>
        <p className="text-muted mb-4 text-xs leading-relaxed">
          {t('This permanently deletes every game, study, note, puzzle and book, and their history. There is no undo.')}
        </p>
        {gate && (
          <label className="mb-3 flex flex-col gap-1">
            <span className="text-muted text-xs font-medium">{t('Confirm your app password')}</span>
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
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="danger" disabled={busy || (gate && password === '')} onClick={() => void wipe()}>
            {busy ? t('Wiping…') : t('Wipe everything')}
          </Button>
        </div>
      </div>
    </div>
  );
}
