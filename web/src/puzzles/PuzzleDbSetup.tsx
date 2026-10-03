import { Download, Hammer, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PuzzleBuildFailure, PuzzleDumpSource } from '@shared/puzzleBuild';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Figures } from '@/components/figures';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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

export interface BuildStatus {
  running: boolean;
  phase?: 'downloading' | 'building' | 'indexing' | 'done';
  bytes?: number;
  total?: number;
  rows?: number;
  puzzles?: number;
  seconds?: number;
  /** Why the last build failed, kept by the server until the next one. */
  error?: PuzzleBuildFailure | null;
  /** What the running or the last build reads. */
  source?: PuzzleDumpSource;
  /** A dump is in place beside the database, which the next build can
      use instead of downloading. */
  dumpInPlace?: boolean;
}

/** What went wrong last: a build that failed, or a start the server
    refused, in its own words ("a build is already running"). */
export type BuildProblem = PuzzleBuildFailure | { reason: 'refused'; detail: string };

const mb = (bytes: number): string => (bytes / 1e6).toFixed(0);

/**
 * A failed build, said as a sentence in the reader's language.
 *
 * It was the builder's last line, shown as it was: "invalid zstd data",
 * "database or disk is full", "terminated", English in either language
 * and no help in any. Each reason the builder and the server can name
 * has its sentence here, saying what failed and, where there is one, what
 * to do about it in the app. The raw words go under it only where they
 * add something the sentence cannot: an HTTP status, a signal, or a
 * failure nobody named (`other`), where they are all there is. A refused
 * start is the server's own sentence, which the dictionary knows.
 */
function problemSentence(problem: BuildProblem, source: PuzzleDumpSource | undefined): string {
  switch (problem.reason) {
    case 'unreachable':
      return t('The puzzle dump could not be downloaded.');
    case 'download':
      return t('The download of the puzzle dump was cut off.');
    case 'decode':
      // The dump in place is the one that can be got past, with the
      // retry's other answer, which it then starts on.
      return source === 'dump'
        ? t('The puzzle dump in its folder could not be read. Try again and download the newest instead.')
        : t('The downloaded puzzle dump could not be read.');
    case 'disk':
      return t('The disk ran out of space. The build needs over 5 GB free.');
    case 'memory':
      return t('The build ran out of memory and was stopped.');
    case 'stopped':
      return t('The build was stopped.');
    case 'swap':
      return t('The new database was built but could not replace the old one. It takes its place when the server next starts.');
    case 'other':
      return t('The build failed.');
    case 'refused':
      return t(problem.detail);
  }
}

const DETAIL_HELPS = new Set<BuildProblem['reason']>(['unreachable', 'stopped', 'swap', 'other']);

/** The warning line a failed build leaves, the setup screen's and the card's. */
export function BuildProblemNote({
  problem,
  source,
  className,
}: {
  problem: BuildProblem;
  source: PuzzleDumpSource | undefined;
  className?: string;
}) {
  return (
    <p className={cn('text-warn flex items-start gap-2 text-sm leading-relaxed', className)}>
      <TriangleAlert className="mt-0.5 glyph shrink-0" />
      <span>
        {problemSentence(problem, source)}
        {problem.detail && DETAIL_HELPS.has(problem.reason) && (
          // The raw words, untranslated, quieter and under the sentence:
          // evidence for whoever looks after the machine, not the message.
          <span className="text-muted-foreground block text-xs break-words">{problem.detail}</span>
        )}
      </span>
    </p>
  );
}

/**
 * Whether a retry starts on the download: when the download is what
 * failed, and when the dump in place could not be read, which the
 * download is the way past.
 */
export const retryPrefersDownload = (problem: BuildProblem | null, source: PuzzleDumpSource | undefined): boolean =>
  problem !== null && problem.reason !== 'refused' && (source === 'download' || problem.reason === 'decode');

/**
 * The card's own words, named once: the placeholder below holds their
 * place by rendering them invisibly, and two copies would wrap apart
 * the day one was edited.
 */
const SETUP_TITLE = 'No puzzle database yet';
export const SETUP_BLURB =
  'The trainer runs on the Lichess puzzle database, 6.1 million puzzles, free to use. The app fetches and builds it: about 300 MB to download, around 2.5 GB once built.';
/**
 * The same, where a dump is already in the database's folder. The build
 * reads that and downloads nothing, and the first blurb's 300 MB was
 * false there. The disk is the measured peak of a full build without
 * the download (docs/databases.md): the new file and VACUUM's temp at
 * 2.62 GB each.
 */
export const SETUP_BLURB_DUMP =
  'The trainer runs on the Lichess puzzle database. The app builds it from the puzzle dump already in its folder: nothing to download, over 5 GB of free disk while it builds, around 2.5 GB once built.';

/**
 * What a build asks before it starts, by what it would replace and what
 * it could read. A first build with nothing in place asks nothing: its
 * button says "Download and build" and its blurb carries the sizes.
 */
const QUESTION_REBUILD =
  'Rebuild the puzzle database from the latest Lichess puzzles? It downloads about 300 MB and needs about 5.5 GB of free disk while it builds, and can run out of memory on a small server. The current one keeps working until the new one is ready, and your attempts are kept.';
const QUESTION_REBUILD_DUMP =
  'Rebuild the puzzle database? It needs over 5 GB of free disk while it builds, and can run out of memory on a small server. The current one keeps working until the new one is ready, and your attempts are kept.';
const QUESTION_BUILD_DUMP =
  'Build the puzzle database? It needs over 5 GB of free disk while it builds and around 2.5 GB once built, and can run out of memory on a small server.';

/**
 * The two answers where a dump is in place: build from it, or download
 * the newest set past it.
 *
 * A dump in place used to be the only answer. Whatever was there, one an
 * older version had left after a build that died, or one somebody put
 * there a year ago, every build and rebuild read it and none downloaded,
 * so the newest puzzles were out of reach of anything but deleting the
 * file on the server's disk. The second answer deletes it, once the new
 * database is built: a dump older than the database is no use, and
 * keeping it would leave 300 MB that nothing in the app could remove. A
 * file the user may have put there is not deleted without the question
 * saying so, which is the second answer's own line.
 *
 * The rows are ExistingChoice's (pdf-import-parts): the dot, the answer,
 * and what it costs under it.
 */
function DumpSourceChoice({
  value,
  onChange,
}: {
  value: PuzzleDumpSource;
  onChange: (value: PuzzleDumpSource) => void;
}) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as PuzzleDumpSource)}>
      {(
        [
          ['dump', 'From the puzzle dump in its folder', 'Downloads nothing, and the file stays.'],
          [
            'download',
            'Download the newest puzzles',
            'Downloads about 300 MB. The file in the folder is deleted once the new database is built.',
          ],
        ] as const
      ).map(([source, label, blurb]) => (
        <label key={source} className="flex cursor-pointer items-start gap-2 text-left">
          {/* mt-0.5 lines the dot up with the first line of the label;
              on iOS the mark is a checkmark centred on the whole row. */}
          <RadioGroupItem value={source} className="mt-0.5 ios:mt-0" />
          <span className="text-sm">
            {t(label)}
            <span className="text-muted-foreground block">{t(blurb)}</span>
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}

/**
 * The button that starts a puzzle build, and the question it asks first
 * when there is one: always where a dump is in place, since a dump in
 * place is a choice, and wherever the caller asks for one (`ask`, a
 * rebuild, which is minutes of work beside a database that works).
 *
 * Shared by the setup screen and Settings' card, which draw it at their
 * own weight, so the two cannot ask different questions about one file.
 * `preferDownload` picks the second answer to start on, for a retry
 * (retryPrefersDownload says when).
 */
export function PuzzleBuildButton({
  label,
  icon: Icon,
  title,
  installed,
  dumpInPlace,
  ask = false,
  preferDownload = false,
  busy = false,
  disabled = false,
  variant = 'ghost',
  size = 'sm',
  className,
  onStart,
}: {
  label: string;
  icon: LucideIcon;
  /** The tooltip, English; translated here. */
  title?: string;
  /** A database is there for this one to replace. */
  installed: boolean;
  dumpInPlace: boolean;
  ask?: boolean;
  preferDownload?: boolean;
  /** Starting: the icon turns into a spinner. */
  busy?: boolean;
  disabled?: boolean;
  variant?: 'default' | 'ghost';
  size?: 'default' | 'sm';
  className?: string;
  /** `download`: the newest set, past the dump in place. */
  onStart: (download: boolean) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [source, setSource] = useState<PuzzleDumpSource>('dump');
  const asks = ask || dumpInPlace;
  const question = !dumpInPlace ? QUESTION_REBUILD : installed ? QUESTION_REBUILD_DUMP : QUESTION_BUILD_DUMP;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        title={title === undefined ? undefined : t(title)}
        aria-haspopup={asks ? 'dialog' : undefined}
        aria-expanded={asks ? asking : undefined}
        disabled={disabled}
        onClick={() => {
          if (!asks) {
            onStart(false);
            return;
          }
          // Asked afresh each time: the answer is not remembered past
          // the question it answered.
          setSource(preferDownload ? 'download' : 'dump');
          setAsking(true);
        }}
      >
        {busy ? <Spinner className="glyph" data-icon="inline-start" /> : <Icon className="glyph" data-icon="inline-start" />}
        {t(label)}
      </Button>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        icon={installed ? RefreshCw : Hammer}
        // Heavy, not destructive: the old database stays until the new
        // one is in, and a red question would say otherwise.
        tone="default"
        question={question}
        confirmLabel={installed ? 'Rebuild' : 'Build'}
        onConfirm={() => onStart(dumpInPlace && source === 'download')}
      >
        {dumpInPlace && <DumpSourceChoice value={source} onChange={setSource} />}
      </ConfirmDialog>
    </>
  );
}

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
            <Download className="glyph" data-icon="inline-start" />
            {t('Download and build')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The server's build, followed: its status read once a second for as
 * long as the caller is on screen, and the way to start one.
 *
 * `onReady` is called once when a build this has watched running ends
 * without an error; `failed` is set when one ends with one, or when the
 * start itself is refused.
 */
export function usePuzzleBuild(onReady: () => void): {
  status: BuildStatus | null;
  starting: boolean;
  failed: BuildProblem | null;
  /** `download`: the newest set, past a dump in place (PuzzleBuildButton). */
  start: (download?: boolean) => Promise<void>;
} {
  const [status, setStatus] = useState<BuildStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<BuildProblem | null>(null);
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
    if (next.running) {
      wasRunning.current = true;
      // A refused start ("a build is already running") is answered by the
      // build it lost to, and must not outlive that build: Settings keeps
      // this card on screen after a build ends, where the setup screen
      // was always replaced by the trainer.
      setFailed(null);
    }
    return next.running;
  }, [onReady]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => clearInterval(timer);
  }, [poll]);

  const start = async (download = false): Promise<void> => {
    setStarting(true);
    setFailed(null);
    try {
      await api('/api/puzzles/build', { method: 'POST', json: { download } });
      wasRunning.current = true;
      await poll();
    } catch (e) {
      setFailed({ reason: 'refused', detail: apiErrorMessage(e) });
    }
    // Both arms fall through to here, which is what the finally used to do.
    setStarting(false);
  };

  return { status, starting, failed, start };
}

/**
 * A running build, as the setup screen draws it: the phase, a bar, what
 * has been done so far, and that leaving the page does not stop it. For
 * a status whose build is running; the caller decides when that is.
 */
export function PuzzleBuildProgress({ status }: { status: BuildStatus | null }) {
  const phase = status?.phase;
  // Only the download knows its size. The rest reports what it has done so
  // far, which is honest — a bar that invents a total is worse than a count.
  const fraction =
    phase === 'downloading' && status?.total ? Math.min(1, (status.bytes ?? 0) / status.total) : null;

  return (
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
  );
}

/**
 * `dumpInPlace` is what /api/puzzles/meta said, which this screen waited
 * for, so its first words are already the right ones; the build's own
 * status takes over once it is read, and follows a dump put there or
 * taken away while the page is open.
 */
export function PuzzleDbSetup({ onReady, dumpInPlace: metaDump = false }: { onReady: () => void; dumpInPlace?: boolean }) {
  const { status, starting, failed, start } = usePuzzleBuild(onReady);
  const running = status?.running === true;
  const dumpInPlace = status?.dumpInPlace ?? metaDump;
  // What went wrong last, here or before this page was opened, as the
  // card in Settings has it: the server keeps a failed build's reason
  // until the next one starts, and a reload used to lose it here.
  const error = running ? null : (failed ?? status?.error ?? null);

  return (
    <div className="optical-center h-full overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-3 text-center">
        <p className="text-foreground text-base font-medium">{t(SETUP_TITLE)}</p>

        {running ? (
          <PuzzleBuildProgress status={status} />
        ) : (
          <>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t(dumpInPlace ? SETUP_BLURB_DUMP : SETUP_BLURB)}
            </p>

            {error && <BuildProblemNote problem={error} source={status?.source} className="text-left" />}

            <div className="flex justify-center">
              {/* With a dump in place the button asks which to build
                  from, and says "Build": nothing is downloaded unless
                  the answer is the newest set. */}
              <PuzzleBuildButton
                label={error ? 'Try again' : dumpInPlace ? 'Build' : 'Download and build'}
                icon={dumpInPlace ? Hammer : Download}
                variant="default"
                size="default"
                installed={false}
                dumpInPlace={dumpInPlace}
                preferDownload={retryPrefersDownload(error, status?.source)}
                busy={starting}
                disabled={starting}
                onStart={(download) => void start(download)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
