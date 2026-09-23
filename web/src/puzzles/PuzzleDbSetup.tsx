import { Download, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Figures } from '@/components/figures';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/skeletons';

/**
 * Getting the puzzle database, from inside the app.
 *
 * This page used to print two shell commands. A chess player installing a
 * desktop app has no shell, no repository and no `zstd` — so the commands
 * were not a workaround, they were the feature being unavailable. The
 * server builds it now; this is the button and the bar.
 *
 * The job lives on the SERVER, not in this component: closing the page,
 * navigating away or reloading does not stop it, and coming back finds it
 * still running. So the first thing this does is ask whether one is already
 * in progress, rather than assuming it started here.
 */

interface BuildStatus {
  running: boolean;
  phase?: 'downloading' | 'building' | 'indexing' | 'done';
  bytes?: number;
  total?: number;
  rows?: number;
  puzzles?: number;
  seconds?: number;
  error?: string | null;
}

const mb = (bytes: number): string => (bytes / 1e6).toFixed(0);

/**
 * The card's own words, named once: the placeholder below holds their
 * place by rendering them invisibly, and two copies would wrap apart
 * the day one was edited.
 */
const SETUP_TITLE = 'No puzzle database yet';
const SETUP_BLURB =
  'The trainer runs on the Lichess puzzle database, 6.1 million puzzles, free to use. The app fetches and builds it: about 300 MB to download, around 2.5 GB once built.';

/**
 * The setup screen's place while /api/puzzles/meta is in the air, for a
 * device whose stored hint says this vault has no database yet.
 *
 * Without it the wait fell through to the TRAINER — board, panels,
 * action bar — and a vault without the database watched that whole page
 * be replaced by this centred card on every visit until the download
 * was run. The cold card's shape is the floor: a build already running
 * draws more, and the answer corrects this in one beat.
 */
export function PuzzleDbSetupPlaceholder() {
  return (
    <div
      role="status"
      aria-label={t('Loading')}
      aria-live="polite"
      className="optical-center h-full overflow-y-auto p-6"
    >
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <p className="relative text-base font-medium">
          <span className="invisible">{t(SETUP_TITLE)}</span>
          <Skeleton className="absolute inset-y-0.5 left-1/2 w-48 max-w-full -translate-x-1/2" />
        </p>
        <p className="relative text-sm leading-relaxed">
          <span className="invisible">{t(SETUP_BLURB)}</span>
          <Skeleton className="absolute inset-x-0 inset-y-1" />
        </p>
        <div className="flex justify-center">
          {/* The button itself, inert: the cold card's label is a constant,
              so it is drawn at the width its words make it rather than a
              guessed 176px bar, disabled and out of the tab order. */}
          <Button variant="default" disabled tabIndex={-1}>
            <Download className="glyph" />
            {t('Download and build')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PuzzleDbSetup({ onReady }: { onReady: () => void }) {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // So the finish is noticed once, rather than on every poll afterwards.
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    let next: BuildStatus | null = null;
    try {
      next = await api<BuildStatus>('/api/puzzles/build');
    } catch {
      // the server will be there on the next tick
    }
    if (!next) return false;
    setStatus(next);
    if (wasRunning.current && !next.running) {
      wasRunning.current = false;
      if (next.error) setFailed(next.error);
      else onReady();
    }
    if (next.running) wasRunning.current = true;
    return next.running;
  }, [onReady]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [poll]);

  const start = async (): Promise<void> => {
    setStarting(true);
    setFailed(null);
    try {
      await api('/api/puzzles/build', { method: 'POST' });
      wasRunning.current = true;
      await poll();
    } catch (e) {
      setFailed(apiErrorMessage(e));
    }
    // Both arms fall through to here, which is what the finally used to do.
    setStarting(false);
  };

  const running = status?.running === true;
  const phase = status?.phase;
  // Only the download knows its size. The rest reports what it has done so
  // far, which is honest — a bar that invents a total is worse than a count.
  const fraction =
    running && phase === 'downloading' && status?.total
      ? Math.min(1, (status.bytes ?? 0) / status.total)
      : null;

  return (
    <div className="optical-center h-full overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <p className="text-foreground text-base font-medium">{t(SETUP_TITLE)}</p>

        {running ? (
          <>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {phase === 'downloading'
                ? t('Downloading the puzzle dump')
                : phase === 'indexing'
                  ? t('Indexing')
                  : t('Building the database')}
            </p>

            <span className="bg-muted/50 flex h-2 w-full overflow-hidden rounded-full">
              <span
                // Marks the sweep as motion that CARRIES the status, so
                // index.css's reduced-motion block slows it instead of
                // crushing it to a flicker with everything decorative.
                data-motion={fraction === null ? 'status' : undefined}
                className={cn(
                  // The Progress primitive's own fill clock (ui/progress,
                  // `transition-all`): a tracked value glides between
                  // reports rather than stepping.
                  'bg-primary h-full transition-all',
                  // Nothing to measure against: a segment that sweeps the
                  // track says "working" without claiming a percentage. A
                  // part-filled static bar would be read as one.
                  fraction === null && 'w-1/4 animate-[sweep_1.6s_cubic-bezier(0.4,0,0.2,1)_infinite]',
                )}
                style={fraction === null ? undefined : { width: `${100 * fraction}%` }}
              />
            </span>

            {/* Figures and words on one line, so the figures alone take
                the mono role (components/figures.tsx), as the vault
                tree's sizes do. As one mono paragraph the words went too,
                and in Korean they are hangul, which JetBrains Mono cannot
                draw. */}
            <p className="text-muted-foreground text-xs">
              <Figures
                text={
                  phase === 'downloading'
                    ? `${mb(status?.bytes ?? 0)} / ${status?.total ? mb(status.total) : '?'} MB`
                    : phase === 'indexing'
                      ? t('Almost done')
                      : t('{rows} puzzles read', { rows: (status?.rows ?? 0).toLocaleString() })
                }
              />
            </p>

            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('This keeps running if you leave the page. It takes a few minutes.')}
            </p>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm leading-relaxed">{t(SETUP_BLURB)}</p>

            {failed && (
              <p className="text-warn flex items-start gap-2 text-left text-sm leading-relaxed">
                <TriangleAlert className="mt-0.5 glyph shrink-0" />
                <span>{failed}</span>
              </p>
            )}

            <div className="flex justify-center">
              <Button variant="default" onClick={() => void start()} disabled={starting}>
                {starting ? (
                  <Spinner className="glyph" />
                ) : (
                  <Download className="glyph" />
                )}
                {failed ? t('Try again') : t('Download and build')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
