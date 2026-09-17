import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/skeletons';
import { Hourglass, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { SettingRow } from '@/components/setting-row';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { size, type VaultShell, type UpdateResult, type UpdateStatus } from '@/settings/cards/shared';

// --- Version -----------------------------------------------------------------

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
export function LagCard() {
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

export function VersionCard() {
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
