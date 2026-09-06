import { useEffect, useState, type CSSProperties } from 'react';
import { Skeleton, SkeletonForm, useSlowLoad } from '@/components/skeletons';
import QRCode from 'qrcode';
import { CircleHelp, Crown, Eye, EyeOff, HardDrive, History, Hourglass, Info, KeyRound, MonitorSmartphone, Palette, RotateCcw, Save, ShieldCheck, Smartphone, Trash2, User, Vault, Volume2 } from 'lucide-react';
import { isInstalled, useInstallPrompt } from '@/lib/install';
import { manualUrl } from '@/lib/manual';
import { Button } from '@/components/ui/button';
import { forgetLichessToken } from '@/components/lichess-token-notice';
import { forgetTablebaseAnswers } from '@/explorer/tablebase';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Field } from '@/components/ui/field';
import { ClearableInput } from '@/components/text-fields';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Disclosure } from '@/components/disclosure';
import { SettingRow } from '@/components/setting-row';
import { TitleTip } from '@/components/title-tip';
import { Switch } from '@/components/ui/switch';
import { useTheme, type ThemePreference } from '@/store/theme';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatWhen } from '@/lib/dates';
import { navigate, up, type Section } from '@/lib/router';
import { ANNOTATION_SIZES, BOARD_THEMES, CAPTURE_SOUNDS, CASTLE_STYLES, DENSITIES, MOVE_SOUNDS, PIECE_SETS, RADIUS_PRESETS, SCHEME_PRESETS, usePrefs, type AnnotationSize, type BoardTheme, type CastleStyle, type Density, type PieceSet, type RadiusId, type SoundChoice } from '@/store/prefs';
import { PIECE_THUMBS } from '@/pieces/thumbs';
import { previewSound } from '@/board/sound';
import { t, getLang, setLang, LANGS, type Lang } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';
import { setVaultName } from '@/lib/vaultName';

interface Settings {
  profile: { name?: string; chesscom?: string; lichess?: string };
  gate: boolean;
  totp: boolean;
  lichess: { configured: boolean; last4: string | null };
  /** The Syzygy server this vault asks, and what it falls back to when
      nobody has said — see server/tablebase.ts. */
  tablebase: {
    /** Which of the three answers — stored, not inferred. */
    source: 'lichess' | 'server' | 'files';
    url: string | null;
    fallback: string;
    /** Whether the client and the server are the same computer, which
        decides whether asking for a filesystem path is a fair question. */
    sameMachine: boolean;
    /** A directory of Syzygy files on the server, and whether it can
        actually answer — a path that has gone missing, or a build with
        no native binary, falls back to the server silently. */
    dir: string | null;
    local: boolean;
  };
  vaultPath: string;
  /** What the vault is called, or null when its folder name stands in. */
  name: string | null;
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
  /** Bumped whenever something on this page frees space, so the storage
      card re-reads instead of standing on the figures it loaded with. */
  const [storageStamp, setStorageStamp] = useState(0);
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
            <p className="text-destructive mb-3 text-sm" role="alert">
              {loadError}
            </p>
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
        <JumpList dep={settings} />

        {/* Appearance is the only card that works without a server: it
            writes to this device, not to a vault. The rest change a vault or
            a secret, so in the demo they are described rather than shown —
            a disabled form a visitor can fill in and not submit is a worse
            explanation than a sentence. */}
        {/* Ordered by CONSEQUENCE, with one card moved up: what can change
            a vault or a secret comes first, and the irreversible card
            stays at the bottom where a reader has to travel to it. It used
            to open on three appearance dropdowns — thirty-three options
            between them — with Auto-save, the one switch on this page that
            decides whether work is kept, below them under Sound, and the
            swing away from that put Appearance under Storage used: a
            thirteen-row inventory nobody reads twice, standing in front of
            the language and the theme, which are what most visits to this
            page are for. So Appearance goes just ahead of Storage — after
            everything that changes a vault, before the table — and Sound,
            which nobody comes for, keeps its place. */}
        {isDemo() ? (
          <>
            <DocumentsCard />
            <AppearanceCard />
            {/* Storage is here in the demo as well, now that the in-memory
                vault can answer for itself: it is the one card that says
                what a vault is MADE of — games, studies, notes, and the
                caches that rebuild themselves — which is worth showing
                somebody deciding whether to install. The cards below it
                are the ones that really do need a server. */}
            <StorageCard />
            {/* And recovery: the demo keeps its own versions of whatever
                you edit in the tab (web/src/demo/nodeShim/history.ts), so
                the card is real here too — it starts empty, and fills as
                you work, which is the honest demonstration of a safety
                net. Delete a note and it turns up in this list. */}
            <RecoveryCard />
            <SoundCard />
            <InstallCard />
            <Card icon={Info} title={t('This is a demo')}>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t(
                  'Changes here live in this browser tab and are gone on reload. Profile, password, two-factor authentication, the Lichess token and the vault itself need your own server. Install the app or host it, and this page becomes real.',
                )}
              </p>
            </Card>
            <VersionCard />
          </>
        ) : (
          <>
            <ProfileCard settings={settings} onSaved={refresh} />
            <VaultCard settings={settings} onSaved={refresh} />
            <DocumentsCard />
            <SecurityCard settings={settings} onChanged={refresh} />
            <LichessCard settings={settings} onChanged={refresh} />
            {/* Both of these empty a cache the Storage used card is
                counting, so both have to tell it. The tablebase one was
                the older mistake: forgetting its answers left the
                "Tablebase cache" row saying what it read at mount, so
                the page carried two answers for the same folder until a
                reload. */}
            <TablebaseCard
              settings={settings}
              onChanged={refresh}
              onCleared={() => setStorageStamp((n) => n + 1)}
            />
            {/* Clearing a cached player changes a row of the card below
                — and left it saying the size it read at mount, so the
                page carried two different answers for "Browsed games"
                a card apart. It was reachable before this too, by
                Clear all; a button per row is what made it ordinary. */}
            <BrowsedGamesCard onCleared={() => setStorageStamp((n) => n + 1)} />
            <AppearanceCard />
            <StorageCard reload={storageStamp} />
            <RecoveryCard />
            <DesktopCard />
            <SoundCard />
            <InstallCard />
            <DangerCard gate={settings.gate} />
            {typeof __LAG__ !== 'undefined' && __LAG__ && <LagCard />}
            <VersionCard />
          </>
        )}

        {!isDemo() && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {/* `break-all`: a path is one unbroken word to the line breaker —
                a Windows one has no break opportunity at all, backslashes
                included — so it ran straight out of the paragraph and the
                page cut it. Measured at 320px: the span ended 32px past the
                viewport. It is width and path length together, so it breaks
                rather than waiting for a breakpoint. */}
            {t('Vault:')} <span className="font-mono break-all">{settings.vaultPath}</span>{'. '}
            {t('Every game, study and puzzle lives there as plain files. Display settings live on this device.')}
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
    // data-settings-card is what the jump list above the cards reads.
    <section className="bg-card rounded-xl ring-1 ring-border scroll-mt-14 p-4" data-settings-card>
      <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
        <Icon className="text-muted-foreground size-4" />
        {title}
        {/* The manual is written card by card, and nothing in the app
            pointed at it. One quiet mark per card opens the manual's
            Settings page in a new tab; the shortcut sheet stays what it
            was. */}
        <TitleTip title={t('Open the manual')}>
          <a
            href={manualUrl('settings')}
            target="_blank"
            rel="noreferrer"
            aria-label={t('Open the manual')}
            className="text-muted-foreground hover:text-foreground ml-auto grid size-6 place-items-center rounded-md pointer-coarse:size-9"
          >
            <CircleHelp className="size-3.5" />
          </a>
        </TitleTip>
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/**
 * The card names in a row at the top, each a jump to its card.
 *
 * Settings is fifteen cards in one column, and on a wide window the one
 * you came for could be 1,700px down with nothing to say where. The row
 * reads the cards that are actually on the page (the demo and a real
 * server show different sets), sticks to the top while the page scrolls,
 * and stays out of the way on a phone, where the page is short enough
 * to thumb and the row would cost a line.
 */
function JumpList({ dep }: { dep: unknown }) {
  const [cards, setCards] = useState<{ el: HTMLElement; title: string }[]>([]);
  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>('[data-settings-card]')].map((el) => ({
      el,
      title: el.querySelector('h2')?.firstChild?.textContent?.trim() || el.querySelector('h2')?.textContent?.trim() || '',
    }));
    setCards(found.filter((c) => c.title));
  }, [dep]);
  if (cards.length < 4) return null;
  return (
    <nav
      aria-label={t('Settings sections')}
      className="bg-background/95 sticky top-0 z-10 -mx-1 mb-1 hidden flex-wrap gap-x-3 gap-y-1 px-1 py-2 text-sm md:flex"
    >
      {cards.map((c) => (
        <button
          key={c.title}
          type="button"
          className="text-muted-foreground hover:text-foreground rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => c.el.scrollIntoView({ block: 'start' })}
        >
          {c.title}
        </button>
      ))}
    </nav>
  );
}

function Feedback({ note }: { note: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!note) return null;
  return (
    <p className={note.kind === 'ok' ? 'text-good text-sm' : 'text-destructive text-sm'} role="status">
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
        <Field label="Chess.com username">
          <ClearableInput inputSize="lg" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder={t('your Chess.com username')} autoCapitalize="none" />
        </Field>
        <Field label="Lichess username">
          <ClearableInput inputSize="lg" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder={t('your Lichess username')} autoCapitalize="none" />
        </Field>
      </div>
      <p className="text-muted-foreground text-sm">{t('Usernames pre-fill the archive browser on the Games page.')}</p>
      <div className="flex items-center gap-3">
        <Button variant="default" onClick={() => void save()}>{t('Save profile')}</Button>
        <Feedback note={note} />
      </div>
    </Card>
  );
}

// --- Vault name ----------------------------------------------------------------
// Its own card, not a second name in Profile: "Display name" is the
// person's, and two name fields side by side read as one thing. The
// placeholder is what the sidebar shows without a name, so blanking the
// field is not a mystery.

function VaultCard({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(settings.name ?? '');
  const [note, setNote] = useState<Note>(null);
  const folder = settings.vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? settings.vaultPath;

  const save = async (): Promise<void> => {
    const clean = name.trim();
    try {
      await api('/api/settings/name', { method: 'PUT', json: { name: clean } });
    } catch {
      setNote({ kind: 'error', text: t('Could not save.') });
      return;
    }
    // The sidebar foot reads the store, not the settings answer, so it
    // changes with the save rather than on the next full load.
    setVaultName(clean === '' ? null : clean);
    setNote({ kind: 'ok', text: t('Saved.') });
    await onSaved();
  };

  return (
    <Card icon={Vault} title={t('Vault')}>
      <Field label="Vault name">
        <ClearableInput inputSize="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder={folder} maxLength={60} />
      </Field>
      <p className="text-muted-foreground text-sm">
        {t('Names this vault at the foot of the sidebar and in the window title. Every device that opens it sees the same name.')}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="default" onClick={() => void save()}>{t('Save name')}</Button>
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
 * The download, as it happens.
 *
 * The shell downloads an installer of some eighty megabytes in the
 * background and said nothing at all while it did — a slow connection and
 * a stalled one looked the same — then finished in a native message box
 * whose "Later" dismissed the offer to restart for the rest of the run.
 * Both halves are on this card instead.
 */
interface UpdateStatus {
  phase: 'idle' | 'downloading' | 'ready' | 'failed';
  version?: string;
  transferred?: number;
  total?: number;
  percent?: number;
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
          onValueChange={choose}
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
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' });
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

  // Asked for as well as listened to: the check runs at launch, so by the
  // time this page exists the download may already be half done, and a
  // subscription alone would show nothing until the next byte arrives.
  useEffect(() => {
    if (!shell?.onUpdateStatus) return;
    void shell.updateStatus?.().then((s) => s && setStatus(s));
    return shell.onUpdateStatus(setStatus);
  }, [shell]);

  const check = async (): Promise<void> => {
    if (!shell?.checkForUpdates) return;
    // A download that broke is answered by the check that follows it, not
    // left standing in front of it.
    setStatus((s) => (s.phase === 'failed' ? { phase: 'idle' } : s));
    setChecking(true);
    setUpdate(await shell.checkForUpdates());
    setChecking(false);
  };

  const percent = Math.min(100, Math.round(status.percent ?? 0));
  /**
   * What the download itself has to say, which outranks the answer the
   * check button got: "it installs when you quit" is no longer the whole
   * truth once bytes are moving, and is wrong once they have all arrived.
   */
  const live =
    status.phase === 'downloading'
      ? status.total
        ? t('Downloading {version}, {done} of {total}', {
            version: status.version ?? '',
            done: size(status.transferred ?? 0),
            total: size(status.total),
          })
        : t('Starting the download…')
      : status.phase === 'ready'
        ? t('{version} is ready. Restart to install it.', { version: status.version ?? '' })
        : status.phase === 'failed'
          ? // The reason is one of updateFailure()'s sentences, which ko.ts
            // carries — it arrives as English from the shell either way.
            t('Could not update: {reason}', { reason: t(status.error ?? 'no answer') })
          : null;

  return (
    <Card icon={Info} title={t('Version')}>
      {/* Named, because the header used to show a bare "Chess Vault 0.2.1"
          that was the SERVER's version and read as the app's — which is
          how a desktop app sat on 0.1.0 while its own settings page
          appeared to say otherwise. */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t('Server')}</dt>
        <dd className="text-foreground font-mono">{server ?? '—'}</dd>
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
            <dt className="text-muted-foreground">{t('Built')}</dt>
            <dd className="flex h-4 items-center">
              <Skeleton className="h-2.5 w-32" />
            </dd>
          </>
        ) : build ? (
          <>
            <dt className="text-muted-foreground">{t('Built')}</dt>
            <dd className="text-foreground font-mono">{build}</dd>
          </>
        ) : null}
        {app && (
          <>
            <dt className="text-muted-foreground">{t('Desktop app')}</dt>
            <dd className="text-foreground font-mono">{app}</dd>
          </>
        )}
      </dl>
      {/* Wraps rather than sitting on one line: an update failure is a
          sentence, and on a narrow card it used to run out past the panel's
          edge instead of onto a second line. */}
      {shell?.checkForUpdates && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={checking} onClick={() => void check()}>
              {checking ? t('Checking…') : t('Check for updates')}
            </Button>
            {/* The restart the native dialog used to ask for. It stays on
                the card rather than arriving once and vanishing, so an
                update that finished while the reader was mid-game can
                still be taken whenever they are ready for it. */}
            {status.phase === 'ready' && shell.restartToUpdate && (
              <Button variant="default" size="sm" onClick={() => void shell.restartToUpdate!()}>
                {t('Restart now')}
              </Button>
            )}
            {live ? (
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-sm',
                  status.phase === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {live}
              </span>
            ) : (
              update && (
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words text-sm',
                    update.state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {update.state === 'available'
                    ? t('{version} is available. It installs when you quit.', { version: update.version ?? '' })
                    : update.state === 'current'
                      ? t('This is the newest build.')
                      : update.state === 'dev'
                        ? t('Not a packaged build.')
                        : t('Could not check: {reason}', { reason: t(update.error ?? 'no answer') })}
                </span>
              )
            )}
          </div>
          {/* Indeterminate until the first chunk lands: a feed that answers
              slowly would otherwise show a bar pinned at zero, which reads
              as a download that has stalled rather than one not yet begun. */}
          {status.phase === 'downloading' && status.total ? (
            <Progress value={percent} aria-label={t('Download progress')} />
          ) : null}
        </div>
      )}
      {/* The source link is not decoration: pirouetti's pieces are AGPLv3,
          whose §13 owes an offer of source to anyone using the app over a
          network — which is every visitor to the demo. The licence texts
          ship with the build (web/vite.licenses.ts) so a copy that was
          conveyed carries them, rather than pointing at a repository the
          reader may never open. */}
      <p className="text-muted-foreground text-sm leading-relaxed">
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
  /** The shell's native directory dialog, which is the only way to turn
      a folder into a PATH — no browser API yields one (a directory input
      gives relative names, the File System Access API an opaque handle).
      Optional, and absent in every browser, so a caller feature-detects
      and falls back to the text box. */
  pickFolder?: (title?: string) => Promise<string | null>;
  appInfo?: () => Promise<{ version?: string } | undefined>;
  checkForUpdates?: () => Promise<UpdateResult>;
  updateStatus?: () => Promise<UpdateStatus>;
  onUpdateStatus?: (fn: (state: UpdateStatus) => void) => () => void;
  restartToUpdate?: () => Promise<boolean>;
}

/**
 * The way onto the home screen, said in the app. The page has been
 * installable for a long time and nothing told anyone: a phone user
 * lived in a browser tab, with its address bar and its bounce, never
 * knowing the full-screen version was one menu away. Gone once the page
 * runs from an icon or inside the desktop shell, since then it is done.
 * Chromium hands over its own prompt and gets a button; every other
 * browser gets the menu route, which is the same words on all of them.
 */
function InstallCard() {
  const prompt = useInstallPrompt();
  if (isInstalled()) return null;
  return (
    <Card icon={Smartphone} title={t('Home screen')}>
      <SettingRow
        title={t('Add to home screen')}
        blurb={
          prompt
            ? t('Opens full screen from its own icon, like an app.')
            : t('Open the browser menu and choose Add to Home Screen. It then opens full screen from its own icon, like an app.')
        }
      >
        {prompt && (
          <Button variant="secondary" size="sm" onClick={() => void prompt()}>
            {t('Install')}
          </Button>
        )}
      </SettingRow>
    </Card>
  );
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
        blurb={t('Point this window at a server, or host a folder on this device.')}
      >
        <Button variant="secondary" size="sm" onClick={() => void shell.switchVault!()}>
          {t('Switch…')}
        </Button>
      </SettingRow>
    </Card>
  );
}

// --- Appearance --------------------------------------------------------------

/**
 * The colour schemes, grouped the way SCHEME_PRESETS lists them.
 *
 * The first group was labelled "shadcn", which is the name of a build
 * dependency and meant nothing to the club player reading it — it is the
 * first heading in the first control on the Appearance page. These five
 * are the registry's base neutral ramps, so they are called that. The
 * headings go through `t()` at the Select, so they need Korean like any
 * other string; they did not have it, and `check:repo`'s new dictionary
 * check cannot see them because `t(group.label)` is a variable.
 */
const SCHEME_GROUPS = [
  { label: 'Neutrals', ids: ['default', 'stone', 'zinc', 'gray', 'shadcn-slate'] },
  { label: 'Coloured', ids: ['slate', 'paper', 'forest', 'rose', 'midnight', 'mono', 'graphite'] },
  { label: 'Contrast', ids: ['high-contrast'] },
].map(({ label, ids }) => ({
  label,
  options: ids.map((id) => {
    const preset = SCHEME_PRESETS.find((p) => p.id === id)!;
    const { accent, accentTint = 1, contrast = 0, tint, hue } = preset.scheme;
    return {
      value: preset.id,
      label: preset.label,
      // The dot the swatch row used to draw (lanph3re: keep it in the
      // dropdown). It has to be able to be grey, or Greyscale advertises
      // itself with a blue spot, and BLACK ringed in white, or Neutral and
      // High contrast — same hue, same tint, same accent — draw the same
      // dot. The lightness follows the primary's, the rule --primary-l
      // applies in index.css: grey near-black, colour mid-scale.
      dot: {
        color: `oklch(${(20.5 + 37.5 * accentTint) * (1 - contrast)}% ${0.135 * accentTint} ${accent})`,
        ring: `oklch(${90 + 10 * contrast}% ${0.006 * tint} ${hue})`,
      },
    };
  }),
}));

function AppearanceCard() {
  const [moreOpen, setMoreOpen] = useState(false);
  const theme = useTheme((s) => s.preference);
  const setTheme = useTheme((s) => s.setPreference);
  const { boardTheme, pieces, schemeId, radius, density, castleStyle, coordinates, moveBox, annotationSize, setBoardTheme, setPieces, setSchemeId, setRadius, setDensity, setCastleStyle, setCoordinates, setMoveBox, setAnnotationSize } =
    usePrefs();

  return (
    <Card icon={Palette} title={t('Appearance')}>
      {/* Language leads: it changes every other label on this page, so
          reading it first is what makes the rest of the card make sense. */}
      <Field label="App language">
        <Select
          value={getLang()}
          onValueChange={(v) => setLang(v as Lang)}
          ariaLabel={t('App language')}
          groups={[{ options: LANGS.map((l) => ({ value: l.id, label: l.label })) }]}
        />
      </Field>

      <Field label="App theme">
        <Select
          value={theme}
          onValueChange={(v) => setTheme(v as ThemePreference)}
          ariaLabel={t('App theme')}
          groups={[{ options: [
            { value: 'system', label: 'Follow system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ] }]}
        />
      </Field>

      {/* Above the fold, and not with Corners: this is not how the app
          looks, it is how much of your vault is on the screen at once. On
          a page that is four hundred games it decides whether you read or
          scroll, which is a working setting and not a decorative one.
          Per-device, so the same vault is compact on a monitor and
          comfortable under a thumb. */}
      <Field label="Density">
        <Select
          value={density}
          onValueChange={(v) => setDensity(v as Density)}
          ariaLabel={t('Density')}
          groups={[{ options: DENSITIES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      {/* A dropdown like the rest of the card (lanph3re's call) — the row
          of swatches was the one control here that did not look like its
          neighbours. The list's headings stand in for the swatches' hint:
          shadcn's own five greys, the app's coloured ones, and the
          contrast one, each under its own label. */}
      <Field label="Colours">
        <Select
          value={schemeId}
          onValueChange={setSchemeId}
          ariaLabel={t('Colours')}
          className="w-full"
          groups={SCHEME_GROUPS}
        />
      </Field>

      {/* The swatch used to sit BESIDE the control, showing the theme
          already chosen — which is the one theme you can already see, on
          the board itself. What the list could not say was what the other
          nine look like: nine colour names, picked by reading. So the
          swatch moved onto the rows, one per preset, and the trigger wears
          the same one — the separate preview would now be the selected
          row's swatch drawn twice. */}
      <Field label="Board">
        <Select
          value={boardTheme}
          onValueChange={(v) => setBoardTheme(v as BoardTheme)}
          ariaLabel={t('Board theme')}
          className="w-full"
          groups={[
            {
              options: BOARD_THEMES.map(({ id, label }) => ({
                value: id,
                label,
                thumb: <BoardPreview theme={id} />,
              })),
            },
          ]}
        />
      </Field>

      <Field label="Pieces">
        <Select
          value={pieces}
          onValueChange={(v) => setPieces(v as PieceSet)}
          ariaLabel={t('Piece set')}
          className="w-full"
          groups={[
            {
              options: PIECE_SETS.map(({ id, label }) => ({
                value: id,
                label,
                thumb: <PiecePreview set={id} />,
              })),
            },
          ]}
        />
      </Field>

      <Field label="Castling">
        <Select
          value={castleStyle}
          onValueChange={(v) => setCastleStyle(v as CastleStyle)}
          ariaLabel={t('How to castle')}
          groups={[{ options: CASTLE_STYLES.map(({ id, label }) => ({ value: id, label })) }]}
        />
      </Field>

      {/* Above the fold with the board it labels, not behind More options.
          It went in with Corners and Annotation size on the grounds that
          all three are decoration, and it is not: file and rank letters
          are how a position is READ, and whether they are there is a
          legibility choice somebody makes once and wants to find. */}
      <SettingRow
        title={t('Board coordinates')}
        blurb={t('File and rank labels on the board edge.')}
      >
        <Switch
          checked={coordinates}
          onCheckedChange={() => setCoordinates(!coordinates)}
          aria-label={t('Board coordinates')}
        />
      </SettingRow>

      {/* Beside coordinates rather than under More options for the same
          reason: it is a row that is on every moves panel or on none of
          them, and the keyboard's only way onto the board. */}
      <SettingRow
        title={t('Move box')}
        blurb={t('Play moves from the keyboard.')}
      >
        <Switch
          checked={moveBox}
          onCheckedChange={() => setMoveBox(!moveBox)}
          aria-label={t('Move box')}
        />
      </SettingRow>

      {/* The card was nine controls in one flat column, and a flat column
          says every row is worth the same glance. These two are not: they
          are how the app is DRAWN rather than what it draws. What stays
          above the fold is what a vault is set up with once — the language
          every other label on this page is in, the theme, the density, the
          colours, the board with its pieces and coordinates, and how a
          castle is entered.

          Nothing is removed and nothing is more than one press away. The
          fold is NOT remembered: a settings page that opens differently
          depending on what you did last time is a settings page you have
          to re-read before you can use it. */}
      <Disclosure label="More options" open={moreOpen} onToggle={() => setMoreOpen((v) => !v)}>
        <div className="flex flex-col gap-3">
          {/* shadcn's own second knob: every corner in the app is a multiple
              of one radius, so one number squares or rounds the whole thing. */}
          <Field label="Corners">
            <Select
              value={radius}
              onValueChange={(v) => setRadius(v as RadiusId)}
              ariaLabel={t('Corners')}
              className="w-full"
              groups={[{ options: RADIUS_PRESETS.map(({ id, label }) => ({ value: id, label })) }]}
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
              onValueChange={(v) => setAnnotationSize(v as AnnotationSize)}
              ariaLabel={t('Annotation size')}
              groups={[{ options: ANNOTATION_SIZES.map(({ id, label }) => ({ value: id, label })) }]}
            />
          </Field>
        </div>
      </Disclosure>
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
          onCheckedChange={() => setAutosave(!autosave)}
          aria-label={t('Auto-save')}
        />
      </SettingRow>
    </Card>
  );
}

/**
 * The one lookup the app makes without being asked for it.
 *
 * Every other online source in the app is chosen — the explorer's
 * Lichess databases are picked from a switcher and need a token of your
 * own. The tablebase is not picked: it answers whenever the position is
 * small enough, which is what makes it useful and what makes this switch
 * necessary. The blurb says where the position goes and what is kept,
 * because a setting that hides its cost is not a choice.
 *
 * Beside the token card rather than under Documents: both cards are
 * about what this vault says to somebody else's server.
 */
function TablebaseCard({
  settings,
  onChanged,
  onCleared,
}: {
  settings: Settings;
  onChanged: () => Promise<void>;
  /** Say so when the cache folder has been emptied: Storage used counts
      it, and it does not re-read on its own. */
  onCleared: () => void;
}) {
  const tablebase = usePrefs((p) => p.tablebase);
  const setTablebase = usePrefs((p) => p.setTablebase);
  const [url, setUrl] = useState(settings.tablebase.url ?? '');
  const [dir, setDir] = useState(settings.tablebase.dir ?? '');
  const [note, setNote] = useState<Note>(null);
  /** null while it is being read, 'unknown' if the read failed. */
  const [cache, setCache] = useState<{ answers: number; bytes: number } | 'unknown' | null>(null);
  /** Counts this card's own clearings — a re-read, not a poll. */
  const [cacheStamp, setCacheStamp] = useState(0);
  const source = settings.tablebase.source;
  const shell = (window as unknown as { vaultShell?: VaultShell }).vaultShell;

  /**
   * What the cache holds, which is what the button is about to throw
   * away. Nothing else on this card needs the server, so it is read
   * apart from the settings that drew the page; a failure leaves the
   * figures unsaid rather than the card broken.
   */
  useEffect(() => {
    // Nothing shows the figures while the switch is off, so nothing asks
    // for them; turning it on is what sends the request.
    if (!tablebase) return;
    void api<{ answers: number; bytes: number }>('/api/tablebase/cache')
      .then((held) => setCache({ answers: held.answers, bytes: held.bytes }))
      // Not back to null, which is the skeleton: a card that cannot read
      // the figures would have sat on a placeholder for good. An em dash
      // is what Storage used shows for an area it could not measure, and
      // the button stays live, because "we do not know" is not "empty".
      .catch(() => setCache('unknown'));
  }, [cacheStamp, tablebase]);

  /**
   * Follow the server when it changes under us.
   *
   * These boxes are local state seeded from the settings, and `useState`
   * seeds ONCE — so a card that mounted before an answer arrived, or
   * while a value was unset, kept showing the stale one after every
   * refresh. That is not just a wrong-looking box: the Save beside it
   * compares against the SERVER's value, so an empty box next to a
   * configured folder is an enabled Save that would delete the folder.
   * The settings only move as a result of this card's own saves, so
   * following them costs no typing.
   */
  useEffect(() => {
    setUrl(settings.tablebase.url ?? '');
  }, [settings.tablebase.url]);
  useEffect(() => {
    setDir(settings.tablebase.dir ?? '');
  }, [settings.tablebase.dir]);

  const pick = async (next: 'lichess' | 'server' | 'files'): Promise<void> => {
    try {
      await api('/api/settings/tablebase-source', { method: 'PUT', json: { source: next } });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote(null);
    await onChanged();
  };

  const save = async (path: string, json: unknown): Promise<void> => {
    try {
      await api(path, { method: 'PUT', json });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      return;
    }
    setNote({ kind: 'ok', text: t('Saved.') });
    await onChanged();
  };

  const forget = async (): Promise<void> => {
    try {
      await api('/api/tablebase/cache', { method: 'DELETE' });
    } catch (e) {
      setNote({ kind: 'error', text: t(apiErrorMessage(e)) });
      // Both re-read anyway, the way Browsed games re-reads: the delete
      // walks a folder and can fail part way through it, so a failure is
      // not a promise that the figures are unchanged.
      onCleared();
      setCacheStamp((n) => n + 1);
      return;
    }
    // The tab remembers this session's answers too, and a cleared server
    // with a full page memo would be a button that only half worked.
    forgetTablebaseAnswers();
    onCleared();
    // No line of green saying how many went. It was the app's SUCCESS
    // colour on a discard, it never cleared, and it grew the card by 32px
    // — measured — so Browsed games and Storage used both jumped down as
    // you read it. The row's own figures falling to nothing say the same
    // thing in the place you were already looking, and cost no height.
    setCacheStamp((n) => n + 1);
  };

  /**
   * What is answering, where the select does not already say it.
   *
   * The panel used to make you work this out: three controls with a
   * precedence between them that was never written down, so "am I on
   * Lichess or my own tables, and does the switch matter?" had no answer
   * on the screen. One sentence settled it — and then two of its three
   * cases became the select's own value in a full sentence, because the
   * three controls became one. "Lichess's public tablebase" over
   * "Answering from Lichess's public tablebase." is a paragraph of grey
   * saying what the control above it already says.
   *
   * Table files keep it, and are the reason it exists at all: they are
   * the one choice that can be SET and not be answering, because a path
   * that has gone missing or a build with no native binary falls back to
   * Lichess in silence. There the line is the only thing on the card
   * that can tell working from fallen back.
   */
  const answering = settings.tablebase.local
    ? t('Answering from the table files on the server, nothing else involved.')
    : t('Set to your own table files, but they cannot be read. Lichess’s public server is answering instead.');

  return (
    <Card icon={Crown} title={t('Tablebase')}>
      <SettingRow
        title={t('Use the tablebase')}
        blurb={
          tablebase
            ? t(
                'Show the exact result for positions of seven pieces or fewer in the explorer and the engine review. This device only. The source is the vault setting below.',
              )
            : // Nothing is below while this is off, so it does not promise one.
              t(
                'Show the exact result for positions of seven pieces or fewer, in the explorer and the engine review. This device only.',
              )
        }
      >
        <Switch
          checked={tablebase}
          onCheckedChange={() => setTablebase(!tablebase)}
          aria-label={t('Use the tablebase')}
        />
      </SettingRow>

      {tablebase && (
        <>
          {/* One choice, not three controls with a hidden order between
              them. The field a choice needs appears under it and nothing
              else does; the others keep whatever was typed in them, since
              the choice is stored rather than inferred from which box is
              full (server/tablebase.ts). */}
          <div className="flex flex-col gap-2">
            {/* A Field and a Select, because that is what a choice looks
                like on this page — App theme, Density, Colour, Board,
                Pieces, Castling and both sounds are all this shape, and
                a segmented strip here would have been the only one of
                its kind on the page. All three options are offered
                wherever you are looking from: only the PATH BOX below is
                a question a remote client cannot answer, and a server
                that holds the tables is an ordinary setup its owner must
                be able to see and change from a phone. */}
            <Field label={t('Answers come from')}>
              <Select
                value={source}
                onValueChange={(v) => void pick(v as 'lichess' | 'server' | 'files')}
                ariaLabel={t('Answers come from')}
                groups={[
                  {
                    options: [
                      { value: 'lichess', label: t('Lichess’s public tablebase') },
                      { value: 'server', label: t('A tablebase server of your own') },
                      { value: 'files', label: t('Table files on the server') },
                    ],
                  },
                ]}
              />
            </Field>
            {source === 'files' && <p className="text-muted-foreground text-sm">{answering}</p>}
          </div>

          {source === 'server' && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                {t(
                  'A tablebase server of your own: lila-tablebase over your own tables, or any address that speaks its protocol. Empty falls back to Lichess.',
                )}
              </p>
              <div className="flex items-center gap-2">
                <ClearableInput
                  inputSize="lg"
                  className="flex-1"
                  autoComplete="off"
                  placeholder={settings.tablebase.fallback}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  aria-label={t('Tablebase server')}
                />
                <Button
                  variant="default"
                  disabled={url.trim() === (settings.tablebase.url ?? '')}
                  onClick={() => void save('/api/settings/tablebase', { url })}
                >
                  {t('Save')}
                </Button>
              </div>
            </div>
          )}

          {source === 'files' && settings.tablebase.sameMachine && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                {t(
                  'A folder of Syzygy files on this device, read directly with nothing else running. Needs the native core built.',
                )}
              </p>
              <div className="flex items-center gap-2">
                <ClearableInput
                  inputSize="lg"
                  className="min-w-0 flex-1"
                  autoComplete="off"
                  placeholder={t('A folder of .rtbw and .rtbz files')}
                  value={dir}
                  onChange={(e) => setDir(e.target.value)}
                  aria-label={t('Tablebase files')}
                />
                {/* Only in the desktop shell, which is the only place a
                    folder can become a path: browsers hand out relative
                    names or opaque handles, never something a server can
                    open. Absent elsewhere rather than present and
                    broken, the way DesktopCard treats the same bridge.
                    It fills the box; Save still commits, so picking by
                    mistake costs nothing. */}
                {shell?.pickFolder && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void shell.pickFolder?.(t('Choose the folder of Syzygy tables')).then(
                        (picked) => {
                          if (picked) setDir(picked);
                        },
                      );
                    }}
                  >
                    {t('Choose…')}
                  </Button>
                )}
                <Button
                  variant="default"
                  disabled={dir.trim() === (settings.tablebase.dir ?? '')}
                  onClick={() => void save('/api/settings/tablebase-dir', { dir })}
                >
                  {t('Save')}
                </Button>
              </div>
            </div>
          )}

          {/* Not offered from a phone pointed at a server in another
              room: a text box asking for a path on a disk you cannot see
              is a question nobody can answer, and one that used to tell
              anybody who asked which paths existed there. It is a
              deployment setting in that case, and says so. */}
          {source === 'files' && !settings.tablebase.sameMachine && (
            <p className="text-muted-foreground text-sm">
              {settings.tablebase.dir
                ? t('This server also has table files at {dir}, set in its vault config.', {
                    dir: settings.tablebase.dir,
                  })
                : t(
                    'To answer from table files on the server itself, set “tablebaseDir” in its vault config. A path cannot be typed from another device.',
                  )}
            </p>
          )}

          {/* The cache never expires, which is right for a fact and wrong
              for a source that has since learned something: add the
              six-piece tables to the machine above and every six-piece
              ending you had already looked at still answers "nothing
              here", because nothing asks it again. This is how you ask
              again — and the way to take the disk back, and to stop
              keeping a record of which endings you studied. */}
          {/* Shaped like a row of Browsed games and of Storage used, which
              is how this page says "here is something you are holding":
              named on the left, measured on the right, emptied by the bin
              at the end. It was a sentence and a ghost button reading
              "Forget cached answers" — the only cache control on the page
              not called Clear, and one that never said what it was about
              to throw away, so the size had to be read off the Storage
              used card two below. That is also the shape the manual has
              been describing all along. */}
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('Answers are kept for good, so each ending is asked about once.')}
          </p>
          <div className="border-border rounded-lg border">
            <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-base">{t('Cached answers')}</p>
                {/* h-5: the line box the figures stand in, held while they
                    are unknown so the row does not change height when they
                    arrive — the trick the Browsed games rows use. */}
                {cache === null ? (
                  <span className="flex h-5 shrink-0 items-center">
                    <Skeleton className="h-2.5 w-24" />
                  </span>
                ) : (
                  <p className="text-muted-foreground shrink-0 text-sm tabular-nums">
                    {cache === 'unknown'
                      ? '—'
                      : cache.answers === 0
                        ? t('Nothing cached')
                        : `${cache.answers.toLocaleString()} · ${size(cache.bytes)}`}
                  </p>
                )}
              </div>
              {/* No confirmation, the same reasoning as the bins below:
                  this is a cache, and what it costs to be wrong is one
                  request per position the next time each is looked at. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0"
                disabled={cache !== null && cache !== 'unknown' && cache.answers === 0}
                title={t('Clear cached answers')}
                onClick={() => void forget()}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
      <Feedback note={note} />
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
        <Switch checked={sound} onCheckedChange={() => setSound(!sound)} aria-label={t('Move sounds')} />
      </SettingRow>

      {/* Only where the browser has the API at all (Android, in practice).
          iOS Safari has no web haptics, and a switch that can only ever
          no-op is worse than an absent one. */}
      {'vibrate' in navigator && (
        <SettingRow title={t('Vibrate on moves')} blurb={t('One short tick when your piece lands.')}>
          <Switch
            checked={haptics}
            onCheckedChange={() => setHaptics(!haptics)}
            aria-label={t('Vibrate on moves')}
          />
        </SettingRow>
      )}

      <Field
        label="Volume"
        hint={
          <span className="text-foreground font-mono text-sm tabular-nums">
            {Math.round(soundVolume * 100)}%
          </span>
        }
        className={cn(!sound && 'opacity-50')}
      >
        <Slider
          min={0}
          max={100}
          step={5}
          value={Math.round(soundVolume * 100)}
          disabled={!sound}
          onValueChange={(v) => setSoundVolume((v as number) / 100)}
          // Preview on release rather than on every step: dragging fires
          // dozens of times and would machine-gun the sample.
          onValueCommitted={() => previewSound('move', moveSound)}
          aria-label={t('Volume')}
        />
      </Field>

      <Field label="Move sound">
        <Select
          value={moveSound}
          onValueChange={(v) => {
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
          onValueChange={(v) => {
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

/** A 2×2 checker in one named preset, for a row of the theme list.

    It declares `data-board` and then reads the plain board tokens, which
    is the whole trick: index.css defines every preset unanchored as well
    as on the root, so the attribute puts that preset's palette on this
    span and the swatch is painted by the same table the real board is.
    There is no palette here to drift from it.

    `--board-grain` is reset on the way in because only one preset defines
    it: on a page already wearing Wood, every OTHER swatch would inherit
    the grain from the root. The reset is on the outer span so Wood's own
    rule — which lands on the inner one, with the attribute — still wins. */
function BoardPreview({ theme }: { theme: BoardTheme }) {
  return (
    <span aria-hidden className="contents" style={{ '--board-grain': 'none' } as CSSProperties}>
      <span
        data-board={theme}
        className="border-border block size-5 shrink-0 rounded-sm border"
        style={{
          backgroundColor: 'var(--board-light)',
          // Same two layers as cg-board, so a textured theme is picked with
          // its texture visible. The swatch shows 4x4 squares, and the grain
          // is an 8x8 grid of cells, so it takes twice the swatch to put one
          // cell on one square — at 200% the top-left 4x4 of it shows.
          backgroundImage:
            'var(--board-grain, none), repeating-conic-gradient(var(--board-dark) 0% 25%, transparent 0% 50%)',
          backgroundSize: '200% 200%, 50% 50%',
          backgroundBlendMode: 'soft-light, normal',
        }}
      />
    </span>
  );
}

/** One knight of a set, standing on a square of the board in use.

    An <img> and not the board's own `piece` element, which is what every
    other picture of a piece in this app is. Those are painted by CSS keyed
    on an ANCESTOR's `data-pieces`, and this list wants ten sets at once
    under a page already wearing one of them: every row would match its own
    set's rule AND the page's, at the same specificity, and the winner
    would be whichever stylesheet chunk loaded last. So the art comes
    straight from `PIECE_THUMBS` — one knight per set, generated beside the
    stylesheets by scripts/setup-pieces.mjs — and the cascade never enters
    into it. It also means a row can show Fantasy without fetching the
    other eleven Fantasy pieces to do it.

    On a board square rather than on the popover, because that is the only
    background these are drawn to be legible on: white pieces are white,
    and the list is white in one app theme and near-black in the other. */
function PiecePreview({ set }: { set: PieceSet }) {
  return (
    <span
      aria-hidden
      className="border-border block size-5 shrink-0 overflow-hidden rounded-sm border"
      style={{ backgroundColor: 'var(--board-light)' }}
    >
      <img src={PIECE_THUMBS[set]} alt="" className="size-full" />
    </span>
  );
}

// --- Security ----------------------------------------------------------------

function SecurityCard({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  return (
    <Card icon={ShieldCheck} title={t('Security')}>
      <PasswordBlock gate={settings.gate} />
      <Separator />
      <TotpBlock settings={settings} onChanged={onChanged} />
      {/* Only when a gate exists: with no password there is no session to
          end, and a Sign out that reloads into an open app is noise. */}
      {settings.gate && (
        <>
          <Separator />
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
    setNote({ kind: 'ok', text: t('Signed out. Back to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{t('Sign out')}</span>
      <p className="text-muted-foreground text-sm">
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
    setNote({ kind: 'ok', text: t('Password changed. Signing you out to the lock screen…') });
    reauth();
  };

  return (
    <div className="flex flex-col gap-3">
      <span className="text-base font-medium">{gate ? t('Change app password') : t('Set an app password')}</span>
      {!gate && (
        <p className="text-muted-foreground text-sm">
          {t('No password is set, so anyone who can reach this server sees everything. Setting one turns the lock screen on.')}
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
        <Button variant="default" disabled={next.length < 8 || (gate && current === '')} onClick={() => void change()}>
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
    setNote({ kind: 'ok', text: t('2FA is on. Signing you out to the lock screen…') });
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
    setNote({ kind: 'ok', text: t('2FA is off. Signing you out to the lock screen…') });
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
        <p className="text-muted-foreground text-sm">{t('Turning it off needs a current code from your authenticator app.')}</p>
        <div className="flex items-center gap-2">
          <Input
            inputSize="lg"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123 456"
            aria-label={t('Authenticator code')}
            className="w-28"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button variant="destructive" disabled={code.trim().length < 6} onClick={() => void disable()}>
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
          <p className="text-muted-foreground text-sm">
            {t('Adds a 6-digit authenticator code (Google Authenticator, 1Password, Aegis…) to the lock screen.')}{' '}
            {settings.gate ? '' : t('Set an app password first.')}
          </p>
          <div className="flex items-center gap-3">
            <Button variant="secondary" disabled={!settings.gate} onClick={() => void start()}>{t('Set up 2FA')}</Button>
            <Feedback note={note} />
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {t('Scan with your authenticator app, then enter the code it shows. Nothing is saved until the code checks out.')}
          </p>
          <img src={enroll.qr} alt={t('TOTP enrolment QR code')} className="size-40 rounded-lg bg-white p-1.5" />
          <p className="text-muted-foreground break-all text-sm">
            Manual entry key: <span className="font-mono">{enroll.secret}</span>
          </p>
          <div className="flex items-center gap-2">
            <Input
              inputSize="lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123 456"
              aria-label={t('Authenticator code')}
              className="w-28"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button variant="default" disabled={code.trim().length < 6} onClick={() => void enable()}>
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
    // Every view that warns about a missing token asked once for the
    // session; without this the warning outlives the token it is about.
    forgetLichessToken();
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
    forgetLichessToken();
    setNote({ kind: 'ok', text: t('Token removed.') });
    await onChanged();
  };

  return (
    <Card icon={KeyRound} title={t('Lichess token')}>
      {/* One sentence, one string. Assembling it around the link left the
          tail in English while the head was Korean, and no translator can
          fix a sentence that is three fragments in the source. */}
      <p className="text-muted-foreground text-sm">
        {t('Powers the online opening explorer and your Lichess puzzle history. Create one with no scopes and paste it here. It is stored in the vault and never shown again.')}
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
        <p className="text-muted-foreground text-sm">
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
            aria-label={t('Lichess token')}
            className="w-full pr-9"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <TitleTip title={t(show ? 'Hide token' : 'Show token')}>
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={t(show ? 'Hide token' : 'Show token')}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 grid w-9 place-items-center"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </TitleTip>
        </div>
        <Button variant="default" disabled={token.trim() === ''} onClick={() => void save()}>{t('Save')}</Button>
        {settings.lichess.configured && (
          <Button variant="destructive" onClick={() => void clear()}>{t('Remove')}</Button>
        )}
      </div>
      <Feedback note={note} />
    </Card>
  );
}

// --- Deleted documents -------------------------------------------------------

/**
 * What the card says about itself, named once: the placeholder below
 * holds the paragraph's place by rendering the same words invisibly, and
 * two copies of the sentence would wrap differently the day one of them
 * was edited.
 */
const RECOVERY_BLURB =
  'Every version of every document is kept automatically. Anything deleted can be brought back here. An open document keeps its earlier versions under the clock in its header.';

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

  if (available === null)
    return pending ? (
      /* The card's own shape, not the bare h-28 this stood at — 112px
         against a card that is its p-4, a heading, this paragraph at
         3 lines on a desktop and 5-6 on a phone, and at least the
         "Nothing is missing." line: ~168px at 768px wide, more below it.
         Everything under this card took the difference when it landed.
         The heading is real — it is the one thing about the card the
         device already knows (the home panels' argument) — and the
         paragraph is the real words drawn invisibly, so it wraps where
         they will at every width instead of standing at a guessed line
         count. */
      <div role="status" aria-label={t('Loading')} aria-live="polite">
        <Card icon={History} title={t('Deleted documents')}>
          <p className="relative text-sm leading-relaxed">
            <span className="invisible">{t(RECOVERY_BLURB)}</span>
            <Skeleton className="absolute inset-x-0 inset-y-1" />
          </p>
          <div className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-28" />
          </div>
        </Card>
      </div>
    ) : null;
  if (!available) return null;

  return (
    <Card icon={History} title={t('Deleted documents')}>
      <p className="text-muted-foreground text-sm leading-relaxed">{t(RECOVERY_BLURB)}</p>

      {gone?.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('Nothing is missing.')}</p>
      )}

      {gone && gone.length > 0 && (
        <ul className="flex flex-col gap-1">
          {(showAll ? gone : gone.slice(0, FIRST)).map((item) => (
            <li
              key={`${item.kind}/${item.id}`}
              className="flex items-center justify-between gap-2 py-1"
            >
              <span className="min-w-0">
                <span className="text-foreground block truncate text-sm">{item.id}</span>
                <span className="text-muted-foreground text-xs">
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

const PROVIDER_NAME: Record<string, string> = { chesscom: 'Chess.com', lichess: 'Lichess' };

/** Bytes as something readable; a cache of a few megabytes should not be
    reported in seven digits. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Everything browsing has left on disk, and the way to be rid of it.
 *
 * Looking at a month keeps it, so that it browses offline afterwards and
 * so that a second look costs nothing. Nothing ever removed one — look up
 * a dozen players out of curiosity and the vault is quietly holding a
 * dozen players' entire histories, none of it in the collection and none
 * of it mentioned anywhere in the app. This is the mention, and the
 * buttons: one per player, and one for the lot.
 */
function BrowsedGamesCard({ onCleared }: { onCleared: () => void }) {
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

  // A failed delete needs no note of its own: the refresh right after
  // shows what is (still) being held, which is the honest report. Both
  // buttons are disabled while either runs, so a second press cannot
  // race the refresh that is about to redraw the list under it.
  const drop = async (query: string): Promise<void> => {
    setBusy(true);
    await api(`/api/games/cache${query}`, { method: 'DELETE' }).catch(() => {});
    await refresh();
    setBusy(false);
    // Even when the delete failed: what the storage card is showing came
    // from before it was tried either way, and re-reading is one request.
    onCleared();
  };

  // One row's worth. The list was always here to SAY what is being held —
  // whose history, how much — and once it says it, the size column is the
  // reason to take one player and not the rest: the handle browsed every
  // week sits in it beside the ones looked up once, and clearing the lot
  // to be rid of those re-downloads the months actually in use.
  const clearOne = (p: CachedPlayer): Promise<void> =>
    drop(`?provider=${encodeURIComponent(p.provider)}&user=${encodeURIComponent(p.user)}`);

  const total = (players ?? []).reduce((sum, p) => sum + p.bytes, 0);

  return (
    <Card icon={HardDrive} title={t('Browsed games')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t(
          'Months you have browsed are kept so they open instantly and work offline. Clearing them only means downloading a month again next time. Games you kept are copies and stay in your collection.',
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
          <div className="divide-border border-border divide-y rounded-lg border">
            <div className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
              {/* h-7, matching the row's clear button — the tallest thing
                  in it, and so what the row takes its height from. The
                  name's own line box is 24px and the size's 20px, which
                  is what these stood at while the row was text only. */}
              <div className="flex h-7 min-w-0 flex-1 items-center pointer-coarse:h-9">
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex h-7 shrink-0 items-center pointer-coarse:h-9">
                <Skeleton className="h-2.5 w-40" />
              </div>
              {/* icon-sm's own size-7, and its size-9 under a coarse
                  pointer (ui/button) — the footer's trick, per row. */}
              <Skeleton className="size-7 shrink-0 rounded-[min(var(--radius-md),12px)] pointer-coarse:size-9" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-24" />
            {/* The default button's own h-8 — h-9 only under a coarse
                pointer (ui/button), the dashboard's fix over again. */}
            <Skeleton className="h-8 w-20 rounded-lg pointer-coarse:h-9" />
          </div>
        </>
      )}
      {players !== null && players.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('Nothing cached yet.')}</p>
      )}
      {players !== null && players.length > 0 && (
        <>
          <ul className="divide-border border-border divide-y rounded-lg border">
            {players.map((p) => (
              <li key={`${p.provider}/${p.user}`} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
                {/* The name and its sizes keep the baseline they shared
                    when they were the whole row; only the button, which
                    has no text to sit on, is centred against them. */}
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-base">{p.user}</p>
                  <p className="text-muted-foreground shrink-0 text-sm">
                    {PROVIDER_NAME[p.provider] ?? p.provider} · {t('{n} months', { n: p.months })} ·{' '}
                    {size(p.bytes)}
                  </p>
                </div>
                {/* No confirmation: this is a cache, and the button that
                    takes ALL of it does not ask either — a question in
                    front of the smaller action would be the louder one. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  disabled={busy}
                  title={t("Clear this player's months")}
                  onClick={() => void clearOne(p)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-sm">{t('{size} in total', { size: size(total) })}</span>
            <Button variant="ghost" disabled={busy} onClick={() => void drop('')}>
              {t('Clear all')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// --- Storage used ------------------------------------------------------------

/** The areas /api/storage reports, in its order, with what each is called. */
const STORAGE_AREAS: { key: string; label: string; section?: Section }[] = [
  { key: 'games', label: 'Games', section: 'games' },
  { key: 'studies', label: 'Studies', section: 'studies' },
  { key: 'notes', label: 'Notes', section: 'notes' },
  { key: 'books', label: 'Books', section: 'books' },
  { key: 'puzzlebooks', label: 'Puzzle books' },
  { key: 'puzzles', label: 'Puzzle progress' },
  { key: 'repertoire', label: 'Repertoire' },
  { key: 'sources', label: 'PGN files' },
  { key: 'gamesCache', label: 'Browsed games' },
  { key: 'history', label: 'Document history' },
  { key: 'refgames', label: 'Reference databases' },
  { key: 'explorerCache', label: 'Explorer cache' },
  { key: 'tablebaseCache', label: 'Tablebase cache' },
];

/**
 * What the vault takes on disk, area by area.
 *
 * An inventory, like the browsed-games card above it — the answer to
 * "what is using the space" for someone running this on a small box or a
 * phone's worth of server. Nothing is cleared from here: each area that
 * can be emptied has its own place (the library, the browsed-games card,
 * the databases page), and a list of sizes is not the place to lose data.
 */
function StorageCard({ reload = 0 }: { reload?: number }) {
  const [areas, setAreas] = useState<Record<string, { bytes: number; files: number }> | null>(null);
  // `reload` counts the clearings done on this page — a re-read, not a
  // poll, and the reason the card keeps its last figures until the new
  // ones arrive rather than falling back to skeletons.
  useEffect(() => {
    void api<{ areas: { key: string; bytes: number; files: number }[] }>('/api/storage')
      .then((body) =>
        setAreas(Object.fromEntries(body.areas.map((a) => [a.key, { bytes: a.bytes, files: a.files }]))),
      )
      .catch(() => setAreas({}));
  }, [reload]);
  const total = Object.values(areas ?? {}).reduce((sum, a) => sum + a.bytes, 0);
  return (
    <Card icon={HardDrive} title={t('Storage used')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t(
          'What each part of the app keeps on disk. Your documents are at the top. The caches and reference data below are rebuilt or refetched when cleared from their own pages.',
        )}
      </p>
      <ul className="divide-border border-border divide-y rounded-lg border">
        {STORAGE_AREAS.map(({ key, label, section }) => {
          const area = areas?.[key];
          return (
            <li key={key} className="flex items-baseline gap-2 px-3 py-2">
              {section ? (
                <button
                  type="button"
                  // A thumb gets the 36px floor (DESIGN.md, Buttons) out of
                  // the row's own padding: the negative margin keeps the
                  // row at the 40px it already was. An `after:` hit box
                  // would not do here, since `truncate` clips it.
                  className="text-foreground hover:text-primary min-w-0 flex-1 truncate text-left text-base pointer-coarse:-my-1.5 pointer-coarse:min-h-9"
                  onClick={() => navigate(section)}
                >
                  {t(label)}
                </button>
              ) : (
                <p className="min-w-0 flex-1 truncate text-base">{t(label)}</p>
              )}
              {areas === null ? (
                <Skeleton className="h-2.5 w-16" />
              ) : (
                <p className="text-muted-foreground shrink-0 text-sm tabular-nums">
                  {area ? size(area.bytes) : '—'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        {areas === null ? (
          <Skeleton className="h-2.5 w-24" />
        ) : (
          <span className="text-muted-foreground text-sm">{t('{size} in total', { size: size(total) })}</span>
        )}
      </div>
    </Card>
  );
}

function DangerCard({ gate }: { gate: boolean }) {
  const [phrase, setPhrase] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <Card icon={Trash2} title={t('Danger zone')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('Wipe every game, study, note, puzzle and imported book from the vault, including its change history. The password, 2FA and tokens survive. There is no undo, so back up first.')}
      </p>
      <div className="flex items-center gap-2">
        <ClearableInput
          inputSize="lg"
          placeholder={t('Type “{phrase}” to arm', { phrase: WIPE_PHRASE })}
          aria-label={t('Type “{phrase}” to arm', { phrase: WIPE_PHRASE })}
          className="flex-1"
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
        />
        <Button variant="destructive" disabled={phrase !== WIPE_PHRASE} onClick={() => setConfirming(true)}>
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
    setNote({ kind: 'ok', text: t('Vault wiped. Reloading…') });
    setTimeout(() => window.location.reload(), 900);
  };

  // The registry's destructive alert dialog, the same shape as every other
  // confirmation here, only more so: the most destructive question in the
  // app behaves like every other window. The action is a plain Button
  // rather than AlertDialogAction, because the window has to stay up to
  // show a wrong password or the wipe's own failure.
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('Wipe the entire vault?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('This permanently deletes every game, study, note, puzzle and book, and their history. There is no undo.')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {gate && (
          <Field label="Confirm your app password">
            <Input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && password !== '' && void wipe()}
            />
          </Field>
        )}
        <Feedback note={note} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={busy || (gate && password === '')}
            onClick={() => void wipe()}
          >
            {busy ? t('Wiping…') : t('Wipe everything')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
