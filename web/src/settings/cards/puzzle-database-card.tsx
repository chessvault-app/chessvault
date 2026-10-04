import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Download, Hammer, Puzzle, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { PUZZLE_DUMP_PLACED } from '@shared/puzzleBuild';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Skeleton } from '@/components/skeletons';
import { SETTINGS_LIST, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import {
  BuildProblemNote,
  PuzzleBuildButton,
  PuzzleBuildProgress,
  SETUP_BLURB,
  SETUP_BLURB_DUMP,
  retryPrefersDownload,
  usePuzzleBuild,
} from '@/puzzles/PuzzleDbSetup';
import { announce } from '@/lib/announce';
import { api, apiErrorMessage, apiRefusal } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { Feedback, size, type Note } from '@/settings/cards/shared';

/** What /api/puzzles/meta says about the file itself, and about a dump
    in place beside it. */
interface Installed {
  ready: boolean;
  puzzles?: number;
  builtAt?: string | null;
  dumpInPlace?: boolean;
  dumpBytes?: number | null;
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
  /**
   * The server's own sentence, when it refused to say for a reason it
   * names: a vault part way through a restore refuses the puzzle record
   * (it lives in the vault) until the vault is put back. Then nothing on
   * the row is true but that, and Rebuild was offered over a database
   * nobody could see, to be refused in its turn. A read that failed
   * without one keeps the button, since "we do not know" is not "none".
   */
  const [refusal, setRefusal] = useState<string | null>(null);
  const read = useCallback(() => {
    void api<Installed>('/api/puzzles/meta')
      .then((m) => {
        setRefusal(null);
        setDb({
          ready: m.ready,
          puzzles: m.puzzles,
          builtAt: m.builtAt ?? null,
          dumpInPlace: m.dumpInPlace === true,
          dumpBytes: m.dumpBytes ?? null,
        });
      })
      .catch((e: unknown) => {
        setRefusal(apiRefusal(e));
        setDb('unknown');
      });
  }, []);
  useEffect(() => read(), [read]);

  // A finished build is the moment the figures change.
  const { status, starting, failed, start, refresh } = usePuzzleBuild(read);
  const running = status?.running === true;
  // What went wrong last, whether it went wrong here or before this page
  // was opened: the server keeps the last build's error until the next
  // one starts, and a failed rebuild is one whose old file is still in use.
  const error = running ? null : (failed ?? status?.error ?? null);
  const installed = db !== null && db !== 'unknown' ? db : null;
  // The build's status follows the folder from its first poll on; until
  // then, what the meta said, which the figures wait for anyway.
  const dumpInPlace = status?.dumpInPlace ?? installed?.dumpInPlace ?? false;
  const dumpBytes = status ? (status.dumpBytes ?? null) : (installed?.dumpBytes ?? null);
  // The page's own measure (Storage used, Tablebase), or a dash where the
  // server could not say.
  const dumpSize = dumpBytes === null ? '—' : size(dumpBytes);
  // In the question's sentence the number keeps its unit: at 1280 wide
  // the English one broke "(35" from "kB)" across two lines.
  const askedSize = dumpSize.replace(' ', '\u00a0');

  /**
   * Deleting the dump in place, the second row's bin.
   *
   * A build keeps the dump, and only one asked for the newest set deleted
   * it, after building. So the 300 MB stayed on a server whose database
   * was built, and a first build read a stale dump unless its question
   * was answered the other way, with nothing in the app to let it go:
   * only the server's disk could. The server refuses while a build runs
   * (one is reading it, or will delete it itself), and the bin waits
   * meanwhile, described by the progress under the rows.
   */
  const [deleting, setDeleting] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const progressId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  /** A delete went through and its row is going: see the effect below. */
  const refocus = useRef(false);
  const deleteDump = async (): Promise<void> => {
    setDeleting(true);
    setNote(null);
    try {
      await api('/api/puzzles/dump', { method: 'DELETE' });
      refocus.current = true;
      announce(t('Puzzle dump deleted.'));
    } catch (e) {
      setNote({ kind: 'error', text: apiErrorMessage(e) });
    }
    // Read again whatever the answer. Gone, every word the card adapts
    // to the dump turns at once, the question included, rather than at
    // the next poll; refused, the dump may be gone all the same (deleted
    // from another device), and the row must not stay to be refused again.
    read();
    refresh();
    setDeleting(false);
  };
  // The bin had the focus, given back to it as the question closed, and
  // the row it sat on is gone: the focus would fall to the page's top.
  // It goes to the card's build button, which is what is left to do.
  useEffect(() => {
    if (dumpInPlace || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    listRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [dumpInPlace]);

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
            question. A dump in place changes both: the first build reads
            it and downloads nothing, and a rebuild can read it or fetch
            the newest past it. Refused, what the card is and nothing
            more: no rebuild is offered until the reason under the row is
            gone, and the line said to rebuild it all the same. */}
        {refusal !== null
          ? t('The Lichess puzzles the trainer draws from.')
          : installed && !installed.ready
            ? t(dumpInPlace ? SETUP_BLURB_DUMP : SETUP_BLURB)
            : dumpInPlace
              ? t('The Lichess puzzles the trainer draws from. Rebuild it from the puzzle dump in its folder, or from a download of the ones added since.')
              : t('The Lichess puzzles the trainer draws from. Rebuild it to get the ones added since.')}
      </p>
      <div ref={listRef} className={SETTINGS_LIST}>
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
          {refusal !== null ? null : error ? (
            // Straight to the build: the question was asked before the
            // attempt that failed, and the reason is on the line below.
            // Unless a dump is in place, where the question is also the
            // way past it: a retry of the same file would fail the same
            // way, so it asks again, on the download if that is what
            // failed or the dump could not be read.
            <PuzzleBuildButton
              label="Try again"
              icon={RotateCcw}
              className="shrink-0"
              installed={installed?.ready === true}
              dumpInPlace={dumpInPlace}
              preferDownload={retryPrefersDownload(error, status?.source)}
              disabled={starting}
              onStart={(download) => void start(download)}
            />
          ) : installed && !installed.ready ? (
            // No database to replace: the same offer the Puzzles page
            // makes, with the same sizes in the line above, and the same
            // question where a dump is in place.
            <PuzzleBuildButton
              label={dumpInPlace ? 'Build' : 'Download and build'}
              icon={dumpInPlace ? Hammer : Download}
              className="shrink-0"
              installed={false}
              dumpInPlace={dumpInPlace}
              disabled={starting || running}
              onStart={(download) => void start(download)}
            />
          ) : (
            // What the build will do, asked first. A dump somebody put
            // beside the database is one answer and the newest set the
            // other, where the question said 300 MB all the same. The
            // disk is the measured peak of a full rebuild (docs/
            // databases.md): the new file and VACUUM's temp at 2.62 GB
            // each, 5.24 GB, and the 304 MB download on top makes 5.5.
            <PuzzleBuildButton
              label="Rebuild"
              icon={RefreshCw}
              title={
                dumpInPlace
                  ? 'Rebuild the puzzle database from the puzzle dump in its folder or from a download'
                  : 'Rebuild the puzzle database from the latest Lichess puzzles'
              }
              className="shrink-0"
              installed
              dumpInPlace={dumpInPlace}
              ask
              disabled={db === null || starting || running}
              onStart={(download) => void start(download)}
            />
          )}
        </div>
        {refusal === null && dumpInPlace && (
          // The dump in place, wherever there is one: named, measured and
          // let go of on its own row, the way this page shows everything
          // it holds (Tablebase's cached answers, Browsed games). Gone,
          // the lead above, the build's question, the Puzzles page and
          // its hub and Themes all read as with no dump: they follow the
          // same answer.
          <div className="flex items-center gap-2 py-(--row-py-dense) pl-3 pr-1.5">
            <div className="flex min-w-0 flex-1 items-baseline gap-2 max-sm:flex-col max-sm:items-start max-sm:gap-0">
              <p className="min-w-0 flex-1 truncate type-row max-sm:max-w-full">{t('Puzzle dump')}</p>
              <p className="text-muted-foreground shrink-0 type-row-sub tabular-nums">{dumpSize}</p>
            </div>
            {/* Asked, unlike the cache bins on this page: the file may be
                one somebody put there, and the question names it, its
                size and what goes with it. Red, as a delete is. */}
            <ConfirmDialog
              icon={Trash2}
              triggerTitle="Delete the puzzle dump"
              triggerTone="quiet"
              triggerClassName="shrink-0"
              disabled={starting || running || deleting}
              triggerDescribedBy={running ? progressId : undefined}
              question={
                installed?.ready === true
                  ? t(
                      'Delete the puzzle dump {file} ({size})? The puzzle database keeps working, and the next rebuild downloads the newest puzzles, about 300 MB.',
                      { file: PUZZLE_DUMP_PLACED, size: askedSize },
                    )
                  : t(
                      'Delete the puzzle dump {file} ({size})? Building the database then downloads the newest puzzles, about 300 MB.',
                      { file: PUZZLE_DUMP_PLACED, size: askedSize },
                    )
              }
              confirmLabel="Delete"
              onConfirm={() => void deleteDump()}
            />
          </div>
        )}
      </div>
      {running && (
        // One block, so a phone's settings group draws it as one row. It
        // is also why the dump's bin waits, and describes it meanwhile.
        <div id={progressId} className="flex flex-col gap-2">
          <PuzzleBuildProgress status={status} />
        </div>
      )}
      {/* Said as a sentence in the reader's language, the setup screen's
          own; it was the builder's last line passed through t(), which
          knew none of them. */}
      {error && <BuildProblemNote problem={error} source={status?.source} />}
      <Feedback note={refusal === null ? note : { kind: 'error', text: refusal }} />
    </Card>
  );
}
