import { useEffect, useState } from 'react';
import { Skeleton, SkeletonForm, useSlowLoad } from '@/ui/Skeleton';
import QRCode from 'qrcode';
import { Eye, EyeOff, HardDrive, History, Hourglass, Info, KeyRound, MonitorSmartphone, Palette, RotateCcw, Save, ShieldCheck, Trash2, User, Volume2 } from 'lucide-react';
import { Button } from '@/ui/Button';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { Field } from '@/ui/Field';
import { ClearableInput, Input } from '@/ui/Input';
import { Modal } from '@/ui/Modal';
import { Select } from '@/ui/Select';
import { SettingRow } from '@/ui/SettingRow';
import { Switch } from '@/ui/Switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatWhen } from '@/lib/dates';
import { navigate, up } from '@/lib/router';
import { ANNOTATION_SIZES, BOARD_THEMES, CAPTURE_SOUNDS, CASTLE_STYLES, MOVE_SOUNDS, PIECE_SETS, SCHEME_PRESETS, usePrefs, type AnnotationSize, type BoardTheme, type CastleStyle, type PieceSet, type SoundChoice } from '@/store/prefs';
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

/** This tab's session just stopped being honoured — a credential change
    revoked every session, or Sign out revoked this one — so the cleanest
    continuation is the lock screen with fresh state. The delay gives the
    feedback note a beat to be read before the reload takes it. */
const reauth = (): void => {
  setTimeout(() => window.location.reload(), 1200);
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pending = useSlowLoad(settings === null && loadError === null);

  const refresh = async (): Promise<void> => {
    // Uncaught, this stranded the page on its skeleton with no way out —
    // and the skeleton only shows after a beat, so a fast failure showed
    // NOTHING at all.
    try {
      setSettings(await api<Settings>('/api/settings'));
      setLoadError(null);
    } catch (e) {
      setLoadError(apiErrorMessage(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  // Settings arrive fast on a local server, so nothing is shown at all
  // unless the wait is long enough to notice.
  if (!settings) {
    if (loadError)
      return (
        <PageShell width="narrow">
          <div>
            <p className="text-bad mb-3 text-sm">{loadError}</p>
            <Button variant="secondary" size="sm" onClick={() => void refresh()}>
              {t('Try again')}
            </Button>
          </div>
        </PageShell>
      );
    // The shell the settled page uses, not a bare scroller. This drew its
    // own column and its own padding, so the gutters moved when the
    // settings landed and the page header — which the skeleton did not
    // stand in for at all — appeared from nowhere and pushed every card
    // down the height of a title.
    return <PageShell width="narrow">{pending && <SkeletonForm groups={3} />}</PageShell>;
  }

  // Nothing here knows about the keyboard any more. This box used to pad
  // itself by what the keyboard covered, and to claim the phone's bottom
  // bar so the tab row could not ride up onto the keys — both from when
  // the shell was 100svh and ran on underneath. The shell ends at the
  // keyboard now and the bar hides itself while typing, so padding again
  // only pushed the bottom of the page out of a box with nothing under it.
  return (
    <PageShell width="narrow">
        <PageHeader title={t('Settings')} back={() => up('home')} />

        {/* Appearance is the only card that works without a server: it
            writes to this device, not to a vault. The rest change a vault or
            a secret, so in the demo they are described rather than shown —
            a disabled form a visitor can fill in and not submit is a worse
            explanation than a sentence. */}
        {isDemo() ? (
          <>
            <AppearanceCard />
            <SoundCard />
            <DocumentsCard />
            <Card icon={Info} title={t('This is a demo')}>
              <p className="text-subtle text-sm leading-relaxed">
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
            <DocumentsCard />
            <SecurityCard settings={settings} onChanged={refresh} />
            <LichessCard settings={settings} onChanged={refresh} />
            <BrowsedGamesCard />
            <RecoveryCard />
            <DangerCard gate={settings.gate} />
            {typeof __LAG__ !== 'undefined' && __LAG__ && <LagCard />}
            <VersionCard />
          </>
        )}

        {!isDemo() && (
          <p className="text-subtle text-sm leading-relaxed">
            {/* `break-all`: a path is one unbroken word to the line breaker —
                a Windows one has no break opportunity at all, backslashes
                included — so it ran straight out of the paragraph and the
                page cut it. Measured at 320px: the span ended 32px past the
                viewport. It is width and path length together, so it breaks
                rather than waiting for a breakpoint. */}
            {t('Vault:')} <span className="font-mono break-all">{settings.vaultPath}</span>{' '}
            {t('— every game, study and puzzle lives there as plain files. Display settings live on this device.')}
          </p>
        )}
    </PageShell>
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
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Icon className="text-muted size-4" />
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * A labelled GROUP of controls, which must not be a <label>.
 *
 * Clicking the dead space in a label activates its first labelable
 * descendant — so a row of theme swatches inside one meant that clicking
 * beside them silently pressed the first swatch and reset the colours to
 * default. A label points at one control; this points at several — which
 * is also why it cannot be ui/Field, whose label wires itself to one
 * child. The label voice matches ui/Field's so the two read as one form.
 */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1" role="group" aria-label={label}>
      <span className="text-subtle text-xs font-medium">{label}</span>
      {children}
    </div>
  );
}

function Feedback({ note }: { note: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!note) return null;
  return (
    <p className={note.kind === 'ok' ? 'text-good text-sm' : 'text-bad text-sm'} role="status">
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
    try {
      await api('/api/settings/profile', { method: 'PUT', json: { name, chesscom, lichess } });
    } catch {
      setNote({ kind: 'error', text: t('Could not save.') });
      return;
    }
    setNote({ kind: 'ok', text: t('Saved.') });
    await onSaved();
  };

  return (
    <Card icon={User} title={t('Profile')}>
      <Field label="Display name">
        <ClearableInput inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('How the app greets you')} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="chess.com username">
          <ClearableInput inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder={t('your chess.com handle')} autoCapitalize="none" />
        </Field>
        <Field label="Lichess username">
          <ClearableInput inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder={t('your Lichess handle')} autoCapitalize="none" />
        </Field>
      </div>
      <p className="text-subtle text-sm">{t('Usernames pre-fill the archive browser on the Games page.')}</p>
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
/**
 * Artificial latency, for looking at the loading placeholders on a real
 * device. The delay itself is in lib/api.ts; this is the only way to reach it.
 *
 * A control rather than a console line, because on the device this was added
 * to test there is no console to type it into: a home-screen app has no
 * address bar, and its storage is a container of its own, so setting the key
 * in Safari never reaches the installed app. The switch would have been
 * unusable on the one device that mattered.
 *
 * Wrapped in __LAG__, so it exists only in a build made with CHESS_LAG=1 and
 * folds away with the delay it sets. A choice takes effect on the next
 * request — lagMs() reads the key every call, so nothing needs reloading.
 */
function LagCard() {
  const [lag, setLag] = useState(() => localStorage.getItem('lag') ?? '0');
  const choose = (value: string): void => {
    setLag(value);
    if (value === '0') localStorage.removeItem('lag');
    else localStorage.setItem('lag', value);
  };
  return (
    <Card icon={Hourglass} title={t('Artificial latency')}>
      <SettingRow
        title={t('Delay every request')}
        blurb={t('For looking at the loading placeholders. This device only.')}
      >
        <Select
          value={lag}
          onChange={choose}
          ariaLabel={t('Artificial latency')}
          steady
          groups={[
            {
              options: [
                { value: '0', label: t('Off') },
                { value: '500', label: t('0.5 seconds') },
                { value: '1500', label: t('1.5 seconds') },
                { value: '3000', label: t('3 seconds') },
              ],
            },
          ]}
        />
      </SettingRow>
    </Card>
  );
}

function VersionCard() {
  const [server, setServer] = useState<string | null>(null);
  const [build, setBuild] = useState<string | null>(null);
  const [app, setApp] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateResult | null>(null);
  const [checking, setChecking] = useState(false);
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;

  useEffect(() => {
    void api<{ version?: string; build?: string | null }>('/api/health', { cache: 'no-store' })
      .then((b) => {
        setServer(b?.version ?? null);
        setBuild(b?.build ?? null);
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
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-subtle">{t('Server')}</dt>
        <dd className="text-fg font-mono">{server ?? '—'}</dd>
        {/* Which BUILD, not which release. The version only moves once per
            release, so between releases it cannot tell a just-deployed app
            from one the phone has been holding in a cache — the question
            that comes up every time a fix will not reproduce. */}
        {/* Held open while the answer is out, rather than added when it
            lands: /api/health carries a build every time, so this row is
            all but certain and the card grew by it a moment after the
            page had settled. */}
        {build === null && server === null ? (
          <>
            <dt className="text-subtle">{t('Built')}</dt>
            <dd className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-32" />
            </dd>
          </>
        ) : build ? (
          <>
            <dt className="text-subtle">{t('Built')}</dt>
            <dd className="text-fg font-mono">{build}</dd>
          </>
        ) : null}
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
                'min-w-0 flex-1 break-words text-sm',
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
      <p className="text-subtle text-sm leading-relaxed">
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
        {/* A route, not a target="_blank". In a browser that was a tab and
            in the desktop shell a whole second app window, neither of
            which has a way back to the settings you were reading. */}
        <button
          type="button"
          className="text-primary underline underline-offset-2"
          onClick={() => navigate('settings', 'licenses')}
        >
          {t('Licences')}
        </button>
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
      <SettingRow
        title={t('Vault')}
        blurb={t('Point this window at a server, or host a folder on this machine.')}
      >
        <Button variant="secondary" size="sm" onClick={() => void shell.switchVault!()}>
          {t('Switch…')}
        </Button>
      </SettingRow>
    </Card>
  );
}

// --- Appearance --------------------------------------------------------------

function AppearanceCard() {
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, schemeId, castleStyle, coordinates, annotationSize, setBoardTheme, setPieces, setSchemeId, setCastleStyle, setCoordinates, setAnnotationSize } =
    usePrefs();

  return (
    <Card icon={Palette} title={t('Appearance')}>
      {/* Language leads: it changes every other label on this page, so
          reading it first is what makes the rest of the card make sense. */}
      <Field label="App language">
        <Select
          value={getLang()}
          onChange={(v) => setLang(v as Lang)}
          ariaLabel={t('App language')}
          groups={[{ options: LANGS.map((l) => ({ value: l.id, label: l.label })) }]}
        />
      </Field>

      <Field label="App theme">
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
                  'flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors duration-100',
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

      <Field label="Board">
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

      <Field label="Castling">
        <Select
          value={castleStyle}
          onChange={(v) => setCastleStyle(v as CastleStyle)}
          ariaLabel={t('How to castle')}
          groups={[{ options: CASTLE_STYLES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      <Field label="Pieces">
        <Select
          value={pieces}
          onChange={(v) => setPieces(v as PieceSet)}
          ariaLabel={t('Piece set')}
          groups={[{ options: PIECE_SETS.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      {/* Appearance rather than Documents: it changes how one panel is
          drawn on THIS device, and nothing about the document — the same
          study read on a phone and a desktop is the same file either way.
          Named for the size rather than the subject, so it cannot be read
          as a switch for whether annotations show at all. */}
      <Field label="Annotation size">
        <Select
          value={annotationSize}
          onChange={(v) => setAnnotationSize(v as AnnotationSize)}
          ariaLabel={t('Annotation size')}
          groups={[{ options: ANNOTATION_SIZES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      <SettingRow
        title={t('Board coordinates')}
        blurb={t('File and rank labels on the board edge.')}
      >
        <Switch
          checked={coordinates}
          onToggle={() => setCoordinates(!coordinates)}
          label={t('Board coordinates')}
        />
      </SettingRow>

    </Card>
  );
}

// --- Documents -----------------------------------------------------------

/**
 * Whether your games, studies and notes write themselves.
 *
 * Its own card rather than a switch under Appearance: this one is not
 * about how the app looks, it is about who decides when the vault
 * changes. Off by default — a document is yours until you save it — and
 * on for anyone who would rather never think about it.
 *
 * Shown in the demo too. The demo runs the real server in the browser, so
 * saving genuinely works there; it is the only card besides Appearance
 * and Sound that means something without a vault of your own.
 */
function DocumentsCard() {
  const autosave = usePrefs((p) => p.autosave);
  const setAutosave = usePrefs((p) => p.setAutosave);

  return (
    <Card icon={Save} title={t('Documents')}>
      <SettingRow
        title={t('Auto-save')}
        blurb={t('Write changes to the vault as you make them. Off, they wait for you to save.')}
      >
        <Switch
          checked={autosave}
          onToggle={() => setAutosave(!autosave)}
          label={t('Auto-save')}
        />
      </SettingRow>
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
  const { sound, soundVolume, moveSound, captureSound, haptics, setSound, setSoundVolume, setMoveSound, setCaptureSound, setHaptics } =
    usePrefs();

  return (
    <Card icon={Volume2} title={t('Sound')}>
      <SettingRow title={t('Move sounds')} blurb={t('Play a click on moves and captures.')}>
        <Switch checked={sound} onToggle={() => setSound(!sound)} label={t('Move sounds')} />
      </SettingRow>

      {/* Only where the browser has the API at all (Android, in practice).
          iOS Safari has no web haptics, and a switch that can only ever
          no-op is worse than an absent one. */}
      {'vibrate' in navigator && (
        <SettingRow title={t('Vibrate on moves')} blurb={t('One short tick when your piece lands.')}>
          <Switch
            checked={haptics}
            onToggle={() => setHaptics(!haptics)}
            label={t('Vibrate on moves')}
          />
        </SettingRow>
      )}

      <label className={cn('grid gap-1', !sound && 'opacity-50')}>
        <span className="flex items-baseline justify-between text-sm">
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

      <Field label="Move sound">
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

      <Field label="Capture sound">
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
      {/* Only when a gate exists: with no password there is no session to
          end, and a Sign out that reloads into an open app is noise. */}
      {settings.gate && (
        <>
          <hr className="border-line" />
          <SignOutBlock />
        </>
      )}
    </Card>
  );
}

/**
 * The way out of a session from inside the app. /auth/logout genuinely
 * revokes now (the store forgets this token, so a stolen copy dies with
 * it) — but nothing called it, which made signing out a user action that
 * needed a shell. PasswordGate has no relock hook to reach from here (its
 * 401 handler only fires on an unauthorised api() reply, and logout
 * answers 200), so this takes the card's own reauth() path: the same
 * note-then-reload every credential change uses, landing on the lock
 * screen once the cookie is gone.
 */
function SignOutBlock() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const signOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    // Deliberately still busy: the button must not invite a second press
    // during the beat before the reload.
    setNote({ kind: 'ok', text: t('Signed out — back to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{t('Sign out')}</span>
      <p className="text-subtle text-sm">
        {t('Ends this device’s session on the server, so a copy of its cookie stops working too. Other devices stay signed in.')}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="secondary" disabled={busy} onClick={() => void signOut()}>
          {t('Sign out')}
        </Button>
        <Feedback note={note} />
      </div>
    </div>
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
    try {
      await api('/api/settings/password', { method: 'POST', json: { current, next } });
    } catch (e) {
      // Through t(): the server's refusals ("wrong password") are
      // translation keys, as they were before api() carried them.
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('Password changed — signing you out to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{gate ? t('Change app password') : t('Set an app password')}</span>
      {!gate && (
        <p className="text-subtle text-sm">
          {t('No password is set — anyone who can reach this server sees everything. Setting one turns the lock screen on.')}
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
    let body: { secret?: string; otpauth?: string } | undefined;
    try {
      body = await api<{ secret?: string; otpauth?: string }>('/api/settings/2fa/start', {
        method: 'POST',
      });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    if (!body?.secret || !body.otpauth) {
      setNote({ kind: 'error', text: t('Could not start 2FA enrolment.') });
      return;
    }
    const qr = await QRCode.toDataURL(body.otpauth, { margin: 1, width: 192 });
    setEnroll({ secret: body.secret, qr });
    setCode('');
    setNote(null);
  };

  const enable = async (): Promise<void> => {
    if (!enroll) return;
    try {
      await api('/api/settings/2fa/enable', { method: 'POST', json: { secret: enroll.secret, code } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setEnroll(null);
    setNote({ kind: 'ok', text: t('2FA is on — signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  const disable = async (): Promise<void> => {
    try {
      await api('/api/settings/2fa/disable', { method: 'POST', json: { code } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('2FA is off — signing you out to the lock screen…') });
    await onChanged();
    reauth();
  };

  if (settings.totp) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-base font-medium">
          {t('Two-factor authentication')}
          <span className="bg-good/15 text-good rounded-full px-2 py-0.5 text-xs font-semibold">{t('On')}</span>
        </div>
        <p className="text-subtle text-sm">{t('Turning it off needs a current code from your authenticator app.')}</p>
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
      <span className="text-base font-medium">{t('Two-factor authentication')}</span>
      {!enroll ? (
        <>
          <p className="text-subtle text-sm">
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
          <p className="text-subtle text-sm">
            {t('Scan with your authenticator app, then enter the code it shows. Nothing is saved until the code checks out.')}
          </p>
          <img src={enroll.qr} alt={t('TOTP enrolment QR code')} className="size-40 rounded-lg bg-white p-1.5" />
          <p className="text-subtle break-all text-sm">
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
    try {
      await api('/api/settings/lichess', { method: 'PUT', json: { token } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setToken('');
    setNote({ kind: 'ok', text: t('Token saved.') });
    await onChanged();
  };

  const clear = async (): Promise<void> => {
    // Saying "removed" while the token survived was the old behaviour
    // (the response went unchecked); a failed delete now says so.
    try {
      await api('/api/settings/lichess', { method: 'DELETE' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('Token removed.') });
    await onChanged();
  };

  return (
    <Card icon={KeyRound} title={t('Lichess token')}>
      {/* One sentence, one string. Assembling it around the link left the
          tail in English while the head was Korean, and no translator can
          fix a sentence that is three fragments in the source. */}
      <p className="text-subtle text-sm">
        {t('Powers the online opening explorer and your Lichess puzzle history. Create one with no scopes, then paste it here — it is stored in the vault and never shown again.')}
      </p>
      <a
        className="text-primary text-sm underline underline-offset-2"
        href="https://lichess.org/account/oauth/token/create"
        target="_blank"
        rel="noreferrer"
      >
        lichess.org/account/oauth/token/create
      </a>
      {settings.lichess.configured && (
        <p className="text-muted text-sm">
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

// --- Deleted documents -------------------------------------------------------

/**
 * Bringing back something that is no longer there.
 *
 * The history panel on a document answers "this got wrecked"; it cannot
 * answer "this is gone", because a deleted study has no page left to open
 * a panel from. That case is why people opened a terminal, so it gets the
 * one place in the app you go when you do not know where else to go.
 *
 * The card hides itself when the vault keeps no history — a packaged
 * install with no git, the demo — rather than showing a permanently empty
 * box. It stays visible when the history exists and nothing is missing,
 * because a card that only appears after a disaster is one nobody knows
 * they have.
 */
function RecoveryCard() {
  type Gone = { kind: 'studies' | 'notes' | 'games'; id: string; at: string };
  const [gone, setGone] = useState<Gone[] | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState('');
  const [showAll, setShowAll] = useState(false);
  const pending = useSlowLoad(available === null);
  /**
   * Nothing ever leaves this list — a document deleted a year ago is still
   * missing — so on a vault of any age it is long, and mostly old scratch
   * documents somebody meant to delete. The newest few are the ones a
   * person came here for; the rest are one press away, with the count
   * said out loud rather than quietly dropped.
   */
  const FIRST = 8;

  const load = async (): Promise<void> => {
    try {
      const res = await api<{ available: boolean; deleted?: Gone[] }>('/api/history/deleted');
      setAvailable(res.available);
      setGone(res.deleted ?? []);
    } catch {
      // No history route at all: nothing to offer, and nothing is wrong.
      setAvailable(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Named the way the rest of the app names them, so a row reads as the
  // thing it will put back rather than as a directory.
  const kindLabel = (kind: Gone['kind']): string =>
    kind === 'studies' ? t('Study') : kind === 'games' ? t('Game') : t('Note');

  const restore = async (item: Gone): Promise<void> => {
    setBusy(`${item.kind}/${item.id}`);
    setNote(null);
    try {
      const versions = await api<{ versions?: { sha: string }[] }>(
        `/api/history/doc/${item.kind}/${encodeURIComponent(item.id)}`,
      );
      // The newest version it ever had is the one it was when deleted.
      const sha = versions.versions?.[0]?.sha;
      if (!sha) throw new Error(t('no version to restore'));
      await api('/api/history/restore', {
        method: 'POST',
        json: { kind: item.kind, id: item.id, sha },
      });
      setNote({ kind: 'ok', text: t('“{name}” is back.', { name: item.id.split('/').at(-1)! }) });
      await load();
    } catch (error) {
      setNote({ kind: 'error', text: apiErrorMessage(error) });
    } finally {
      setBusy('');
    }
  };

  if (available === null) return pending ? <Skeleton className="h-28 rounded-xl" /> : null;
  if (!available) return null;

  return (
    <Card icon={History} title={t('Deleted documents')}>
      <p className="text-subtle text-sm leading-relaxed">
        {t(
          'Every version of every document is kept automatically. Anything deleted can be brought back here; an open document keeps its own earlier versions under the clock in its header.',
        )}
      </p>

      {gone?.length === 0 && (
        <p className="text-subtle text-sm">{t('Nothing is missing.')}</p>
      )}

      {gone && gone.length > 0 && (
        <ul className="flex flex-col gap-1">
          {(showAll ? gone : gone.slice(0, FIRST)).map((item) => (
            <li
              key={`${item.kind}/${item.id}`}
              className="flex items-center justify-between gap-2 py-1"
            >
              <span className="min-w-0">
                <span className="text-fg block truncate text-sm">{item.id}</span>
                <span className="text-subtle text-xs">
                  {t('{kind} · deleted {when}', {
                    kind: kindLabel(item.kind),
                    when: formatWhen(item.at),
                  })}
                </span>
              </span>
              {/* No confirmation, unlike the restore inside a document.
                  That one overwrites a document you still have; this one
                  brings back one you do not — the list holds only paths
                  absent from the vault, so there is nothing here to
                  overwrite and nothing to lose by pressing it. Asking
                  "are you sure?" before an action that cannot take
                  anything away is how a confirmation stops meaning
                  anything where it matters. */}
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('Bring this back')}
                disabled={busy !== ''}
                onClick={() => void restore(item)}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {gone && gone.length > FIRST && !showAll && (
        <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>
          {t('Show all {n}', { n: gone.length })}
        </Button>
      )}

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
    try {
      setPlayers((await api<{ users: CachedPlayer[] }>('/api/games/cache')).users);
    } catch {
      // The card stays on whatever it last knew — it is an inventory,
      // not a health check.
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  // All of it. The list is here to SAY what is being held — whose history,
  // how much — not to be picked through: choosing which player to keep is
  // a question nobody has about data that costs one fetch to get back.
  const clear = async (): Promise<void> => {
    setBusy(true);
    // A failed delete needs no note of its own: the refresh right after
    // shows what is (still) being held, which is the honest report.
    await api('/api/games/cache', { method: 'DELETE' }).catch(() => {});
    await refresh();
    setBusy(false);
  };

  const total = (players ?? []).reduce((sum, p) => sum + p.bytes, 0);

  return (
    <Card icon={HardDrive} title={t('Browsed games')}>
      <p className="text-subtle text-sm leading-relaxed">
        {t(
          'Months you have browsed are kept so they open again instantly and work offline. Nothing here is in your collection — a game you kept was copied — so clearing this only means downloading a month again next time you look at it.',
        )}
      </p>
      {players === null && (
        /* The list and its footer come from /api/games/cache, a different
           answer from the one that drew this page — so the card stood at
           its paragraph's height and then grew by a row and a total,
           pushing the danger zone and the version under it down. One
           cached player is what a personal vault almost always holds, so
           that is the shape held open. Drawn at once and not behind
           useSlowLoad: the choice here is not flash-or-nothing, it is
           flash-or-shove. */
        <>
          <div className="divide-line border-line divide-y rounded-lg border">
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="flex h-5 min-w-0 flex-1 items-center">
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex h-5 shrink-0 items-center">
                <Skeleton className="h-2.5 w-40" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-9 w-20 rounded-lg" />
          </div>
        </>
      )}
      {players !== null && players.length === 0 && (
        <p className="text-subtle text-sm">{t('Nothing cached yet.')}</p>
      )}
      {players !== null && players.length > 0 && (
        <>
          <ul className="divide-line border-line divide-y rounded-lg border">
            {players.map((p) => (
              <li key={`${p.provider}/${p.user}`} className="flex items-baseline gap-2 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-base">{p.user}</p>
                <p className="text-subtle shrink-0 text-sm">
                  {PROVIDER_NAME[p.provider] ?? p.provider} · {t('{n} months', { n: p.months })} ·{' '}
                  {size(p.bytes)}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-subtle text-sm">{t('{size} in total', { size: size(total) })}</span>
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
      <p className="text-subtle text-sm leading-relaxed">
        {t('Wipe every game, study, note, puzzle and imported book from the vault — including its change history. The app password, 2FA and tokens survive. There is no undo; if the vault matters, back it up first.')}
      </p>
      <div className="flex items-center gap-2">
        <ClearableInput
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
    try {
      await api('/api/settings/wipe', {
        method: 'POST',
        json: { confirm: WIPE_PHRASE, ...(gate && { password }) },
      });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      setBusy(false);
      return;
    }
    setNote({ kind: 'ok', text: t('Vault wiped — reloading…') });
    setTimeout(() => window.location.reload(), 900);
  };

  // The shared Modal, not a hand-rolled layer: this was the one dialog in
  // Settings with no Escape, no focus management and no phone-sheet form.
  // The most destructive question in the app should behave like every
  // other window, only more so.
  return (
    <Modal title="Wipe the entire vault?" icon={Trash2} onClose={onClose}>
      <p className="text-muted text-sm leading-relaxed">
        {t('This permanently deletes every game, study, note, puzzle and book, and their history. There is no undo.')}
      </p>
      {gate && (
        <label className="flex flex-col gap-1">
          <span className="text-muted text-sm font-medium">{t('Confirm your app password')}</span>
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
      {/* ConfirmSheet's row, to the letter, because this is the same
          question and the most serious instance of it: stacked and not a
          row (a row puts them a thumb's width apart on a phone, which is
          the wrong geometry for a pair where one is irreversible and the
          other is the way out), full width each with a real gap between
          them, the destructive one on TOP and FILLED — the tinted danger
          style belongs to the trigger that opens this question, which is
          Wipe all data on the card behind — and Cancel plainly secondary
          under it. Not justify-end: that is the row a WINDOW ends on, and
          it is right for Save and Apply, not for this. */}
      <div className="mt-1 flex flex-col gap-2">
        <Button
          variant="danger-solid"
          size="md"
          className="w-full justify-center"
          disabled={busy || (gate && password === '')}
          onClick={() => void wipe()}
        >
          <Trash2 className="size-3.5" />
          {busy ? t('Wiping…') : t('Wipe everything')}
        </Button>
        <Button variant="secondary" size="md" className="w-full justify-center" onClick={onClose}>
          {t('Cancel')}
        </Button>
      </div>
    </Modal>
  );
}
