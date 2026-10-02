import { useCallback, useEffect, useState } from 'react';
import { Download, Puzzle, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';
import { Skeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SETTINGS_LIST, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { PuzzleBuildProgress, SETUP_BLURB, usePuzzleBuild } from '@/puzzles/PuzzleDbSetup';
import { api } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { t } from '@/lib/i18n';

/** What /api/puzzles/meta says about the file itself. */
interface Installed {
  ready: boolean;
  puzzles?: number;
  builtAt?: string | null;
}

/**
 * The puzzle database, and the way to replace it with a newer one.
 *
 * The app offered to build it only when there was none: the Puzzles page
 * shows its setup screen to a vault without the file and the trainer to
 * one with it, so a working database could only be replaced from a shell,
 * or by deleting it first and losing the trainer for the length of the
 * build. Lichess adds puzzles every month, and getting them is a user
 * action like any other.
 *
 * Here, beside Tablebase and Browsed games, because that is where the
 * app keeps the data it fetched for you: a card names what is held, how
 * much and how old, and the control that empties or refetches it sits on
 * the same row. The Puzzles pages are for training, and the setup screen
 * is not there once a database is. Reference databases have a page of
 * their own because they are many and built from your uploads; this is
 * one file from one source.
 *
 * The build is the server's, the one the setup screen starts, and so is
 * everything shown while it runs (usePuzzleBuild, PuzzleBuildProgress).
 * It runs beside the old file, which keeps serving until the new one is
 * renamed over it, so nothing here stops the trainer meanwhile.
 */
export function PuzzleDatabaseCard() {
  /** null while it is read, 'unknown' if the read failed. */
  const [db, setDb] = useState<Installed | 'unknown' | null>(null);
  const read = useCallback(() => {
    void api<Installed>('/api/puzzles/meta')
      .then((m) => setDb({ ready: m.ready, puzzles: m.puzzles, builtAt: m.builtAt ?? null }))
      .catch(() => setDb('unknown'));
  }, []);
  useEffect(() => read(), [read]);

  // A finished build is the moment the figures change.
  const { status, starting, failed, start } = usePuzzleBuild(read);
  const running = status?.running === true;
  // What went wrong last, whether it went wrong here or before this page
  // was opened: the server keeps the last build's error until the next
  // one starts, and a failed rebuild is one whose old file is still in use.
  const error = running ? null : (failed ?? status?.error ?? null);
  const installed = db !== null && db !== 'unknown' ? db : null;

  // How many, and how old: the age is what a rebuild is for. An em dash
  // for a read that failed, as Storage used draws an area it could not
  // measure; the button stays, since "we do not know" is not "none".
  let figures: string | null = null;
  if (db === 'unknown') figures = '—';
  else if (db && !db.ready) figures = t('Not built yet');
  else if (db) {
    const count = (db.puzzles ?? 0).toLocaleString();
    figures = db.builtAt ? `${count} · ${t('built {when}', { when: formatAgo(db.builtAt) })}` : count;
  }

  return (
    <Card icon={Puzzle} title={t('Puzzle database')} anchor="puzzle-database">
      <p className="text-muted-foreground text-sm leading-relaxed">
        {/* With no database yet, the Puzzles page's own words, which carry
            the sizes the first build costs; the rebuild's are in its
            question. */}
        {installed && !installed.ready
          ? t(SETUP_BLURB)
          : t('The Lichess puzzles the trainer draws from. Rebuild it to get the ones added since.')}
      </p>
      <div className={SETTINGS_LIST}>
        <div className="flex items-center gap-2 py-(--row-py-dense) pl-3 pr-1.5">
          {/* Under sm the figures go under the name: beside it and a
              labelled button, a 390px phone had the name down to "Lic…". */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2 max-sm:flex-col max-sm:items-start max-sm:gap-0">
            <p className="min-w-0 flex-1 truncate type-row max-sm:max-w-full">{t('Lichess puzzles')}</p>
            {/* h-5: the line box the figures stand in, held while they are
                unknown so the row does not change height when they land,
                as the Tablebase card's cached-answers row does. */}
            {figures === null ? (
              <span className="flex h-5 shrink-0 items-center">
                <Skeleton className="h-2.5 w-28" />
              </span>
            ) : (
              <p className="text-muted-foreground shrink-0 type-row-sub tabular-nums">{figures}</p>
            )}
          </div>
          {error ? (
            // Straight to the build: the question was asked before the
            // attempt that failed, and the reason is on the line below.
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void start()} disabled={starting}>
              <RotateCcw className="glyph" data-icon="inline-start" />
              {t('Try again')}
            </Button>
          ) : installed && !installed.ready ? (
            // No database to replace, so no question: the same offer the
            // Puzzles page makes, with the same sizes in the line above.
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => void start()} disabled={starting || running}>
              <Download className="glyph" data-icon="inline-start" />
              {t('Download and build')}
            </Button>
          ) : (
            <ConfirmDialog
              icon={RefreshCw}
              tone="default"
              label="Rebuild"
              triggerTitle="Rebuild the puzzle database from the latest Lichess puzzles"
              triggerClassName="shrink-0"
              disabled={db === null || starting || running}
              question="Rebuild the puzzle database from the latest Lichess puzzles? It downloads about 300 MB and needs about 5.5 GB of free disk while it builds, and can run out of memory on a small server. The current one keeps working until the new one is ready, and your attempts are kept."
              confirmLabel="Rebuild"
              onConfirm={() => void start()}
            />
          )}
        </div>
      </div>
      {running && (
        // One block, so a phone's settings group draws it as one row.
        <div className="flex flex-col gap-2">
          <PuzzleBuildProgress status={status} />
        </div>
      )}
      {error && (
        <p className="text-warn flex items-start gap-2 text-sm leading-relaxed">
          <TriangleAlert className="mt-0.5 glyph shrink-0" />
          {/* The server's own words, which the dictionary knows when they
              are fixed ones and leaves as sent when they carry a detail. */}
          <span>{t(error)}</span>
        </p>
      )}
    </Card>
  );
}
