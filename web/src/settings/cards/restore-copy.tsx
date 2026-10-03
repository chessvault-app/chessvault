import { useEffect, useState } from 'react';
import { ArchiveRestore, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FilePicker } from '@/components/file-picker';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api, ApiError, apiErrorMessage, apiUpload } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { Feedback, size, type Note } from '@/settings/cards/shared';

// --- Restore from a copy ---------------------------------------------------
// The other half of "Download a copy" (server/restore.ts). The Vault card
// draws the button beside the download and, while a restore waits to be
// kept or undone, the line that says so with its two verbs.

/** What GET /api/storage/restore answers. */
export interface RestoreState {
  /** A restore waiting to be kept or undone, and what the vault it replaced takes. */
  pending: { at: string; bytes: number; history: 'adopted' | 'kept' | 'none' } | null;
  /** A restore or its undo stopped part way and could not put itself
      back: the vault is half of one and half of another until it is put
      back, and `pending` is null until then. */
  stuck: boolean;
  /** What a restore would do with the history, said before it starts. */
  history: 'adopt' | 'keep' | 'none';
  /** Free bytes where the vault is, or null when the server cannot say. */
  free: number | null;
  /** Whether this client runs on the server's own machine; see RestoreStuck. */
  sameMachine: boolean;
}

/** The restore's state, read once the card mounts, and how to read it again. */
export function useRestoreState(): { state: RestoreState | null; reload: () => Promise<void> } {
  const [state, setState] = useState<RestoreState | null>(null);
  // A failed read leaves the state as it was: an older server has no
  // restore, and the button's own upload then says so.
  const read = (): Promise<RestoreState | null> => api<RestoreState>('/api/storage/restore').catch(() => null);
  const reload = async (): Promise<void> => {
    const next = await read();
    if (next) setState(next);
  };
  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (live && next) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return { state, reload };
}

/**
 * Whether a file starts like a tar: the ustar magic in its first header.
 * Read in the page so a wrong pick is said at once, not after the upload
 * of a file the server would refuse at its first block.
 */
async function looksLikeTar(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  return head.length === 512 && new TextDecoder('latin1').decode(head.subarray(257, 262)) === 'ustar';
}

/** The sentence the confirmation says about the history, by what the server will do. */
const HISTORY_LINE: Record<RestoreState['history'], string> = {
  adopt: 'This vault has no history of its own yet, so it takes the copy’s.',
  keep: 'This vault keeps its own history, with the restore recorded in it.',
  none: 'This server keeps no history, so the copy’s is left out.',
};

/**
 * The sentence in RestorePending that says why Restore waits. The button
 * is described by it rather than titled with it: a disabled button shows
 * no tooltip to a mouse, a key or a finger (ui/button.tsx), so the reason
 * is on the card, where a phone can read it too. One Vault card a page.
 */
const RESTORE_WAITS = 'restore-waits';

/**
 * The same for a restore stuck part way: the sentence in RestoreStuck's
 * warning that says why Restore, and Download a copy in the Vault card,
 * are off until the vault is put back. Stuck says it apart from pending,
 * as the server does, so it wins where both stand.
 */
export const RESTORE_STUCK = 'restore-stuck';

export function RestoreButton({ state, reload }: { state: RestoreState | null; reload: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const pick = async (picked: File): Promise<void> => {
    if (!(await looksLikeTar(picked))) {
      toast.add({ title: t('That file is not a copy of a vault.'), timeout: 5000 });
      return;
    }
    // The question depends on the history and the free space, so it waits
    // for them when the card has not read them yet.
    if (state === null) await reload();
    setFile(picked);
  };
  return (
    <>
      <FilePicker
        accept=".tar,application/x-tar"
        disabled={state?.pending != null || state?.stuck === true}
        aria-describedby={state?.stuck ? RESTORE_STUCK : state?.pending ? RESTORE_WAITS : undefined}
        onFiles={([picked]) => void pick(picked!)}
        render={<Button variant="secondary" />}
      >
        {t('Restore from a copy')}
      </FilePicker>
      {file && <RestoreDialog file={file} state={state} reload={reload} onClose={() => setFile(null)} />}
    </>
  );
}

/**
 * The question, and then the upload in the same window: a copy of a vault
 * of books is gigabytes, and a phone sending it for minutes with nothing
 * moving on screen is a window that looks dead.
 */
function RestoreDialog({
  file,
  state,
  reload,
  onClose,
}: {
  file: File;
  /** Null when the server would not say (its upload then answers for itself). */
  state: RestoreState | null;
  /** Reads the card's state again: a copy that stuck part way leaves the
      card a vault to put back. */
  reload: () => Promise<void>;
  onClose: () => void;
}) {
  /** Percent sent while uploading; 100 while the server puts the copy in place. */
  const [progress, setProgress] = useState<number | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [note, setNote] = useState<Note>(null);
  /**
   * The server refused this file for what it holds, or has no room for
   * it, or the vault is left part way through a restore. Sending it again
   * gets the same answer, so it is not offered again, as the book
   * importer drops a file it cannot read; Close is what is left, and the
   * Vault card picks another or puts the vault back. A dropped
   * connection, a stalled upload or a busy server leaves Restore to try
   * again.
   */
  const [refused, setRefused] = useState(false);
  const free = state?.free ?? null;
  const tooBig = free !== null && file.size > free;
  const placing = progress === 100;
  /** Restored, with the page about to reload. */
  const done = note?.kind === 'ok';

  const restore = async (): Promise<void> => {
    const controller = new AbortController();
    setAbort(controller);
    setNote(null);
    setProgress(0);
    let result: { history: 'adopted' | 'kept' | 'none' };
    try {
      result = await apiUpload<{ history: 'adopted' | 'kept' | 'none' }>('/api/storage/restore', file, {
        contentType: 'application/x-tar',
        onProgress: (sent, total) => setProgress(Math.min(100, Math.floor((sent / total) * 100))),
        signal: controller.signal,
      });
    } catch (error) {
      setAbort(null);
      setProgress(null);
      if (controller.signal.aborted) return;
      setNote({ kind: 'error', text: apiErrorMessage(error) });
      // A vault left part way through a restore takes no other copy until
      // it is put back, which the card offers once this window closes.
      const stuck = error instanceof ApiError && error.reason === 'stuck';
      setRefused(stuck || (error instanceof ApiError && (error.status === 400 || error.status === 507)));
      if (stuck) void reload();
      return;
    }
    // One state at a time: the bar and "Putting the copy in place…" give
    // way to the line that says it is done, in the same render.
    setAbort(null);
    setProgress(null);
    setNote({
      kind: 'ok',
      text: result.history === 'adopted' ? t('Restored, with the copy’s history. Reloading…') : t('Restored. Reloading…'),
    });
    // Every page reads the vault again: the simplest true answer to
    // "what does the app show now" after the vault under it was replaced.
    setTimeout(() => window.location.reload(), 900);
  };

  const close = (): void => {
    // Mid-upload, closing is cancelling, and the server keeps nothing of
    // it. Once the copy is in, it is being put in place and is past
    // stopping, so the window stays until it says how that went, and
    // after a success until the reload takes it.
    if (placing || done) return;
    abort?.abort();
    onClose();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-primary/10 text-primary">
            <ArchiveRestore />
          </AlertDialogMedia>
          <AlertDialogTitle>{t('Restore from this copy?')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('The vault becomes “{name}”, apart from its settings and tokens. What it holds now is kept until you keep or undo the restore.', { name: file.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state && <p className="text-muted-foreground text-sm">{t(HISTORY_LINE[state.history])}</p>}
        {tooBig && (
          <p className="text-destructive text-sm" role="alert">
            {t('The server has {free} free, and this copy needs {size}.', { free: size(free), size: size(file.size) })}
          </p>
        )}
        {progress !== null && (
          <div className="flex flex-col gap-2">
            <Progress value={progress} aria-label={t('Upload progress')} />
            <p className="text-primary flex items-center gap-2 text-sm">
              <Spinner className="glyph" />
              {placing ? t('Putting the copy in place…') : t('Uploading… {pct}%', { pct: progress })}
            </p>
          </div>
        )}
        <Feedback note={note} />
        <AlertDialogFooter>
          {/* Close when this file will not go: the server refused it, or
              the page can already see it will not fit. */}
          <AlertDialogCancel disabled={placing || done}>{refused || tooBig ? t('Close') : t('Cancel')}</AlertDialogCancel>
          <Button disabled={progress !== null || tooBig || refused || done} onClick={() => void restore()}>
            {t('Restore ({size})', { size: size(file.size) })}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * A restore waiting to be kept or undone: what the vault it replaced
 * still takes, and the two ways out of the wait. Nothing while there is
 * none.
 */
export function RestorePending({ state, reload }: { state: RestoreState | null; reload: () => Promise<void> }) {
  const [asking, setAsking] = useState<'keep' | 'undo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const pending = state?.pending;
  if (!pending) return note ? <Feedback note={note} /> : null;
  const history = pending.history !== 'none';

  const keep = async (): Promise<void> => {
    setBusy(true);
    let freed: number;
    try {
      freed = (await api<{ freed: number }>('/api/storage/restore/keep', { method: 'POST' })).freed;
    } catch (error) {
      setNote({ kind: 'error', text: apiErrorMessage(error) });
      setBusy(false);
      if (error instanceof ApiError && error.reason === 'stuck') await reload();
      return;
    }
    setNote({ kind: 'ok', text: t('Kept. {size} freed.', { size: size(freed) }) });
    setBusy(false);
    await reload();
  };

  const undo = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/api/storage/restore/undo', { method: 'POST' });
    } catch (error) {
      setNote({ kind: 'error', text: apiErrorMessage(error) });
      setBusy(false);
      // An undo that stuck part way: the card has a vault to put back now.
      if (error instanceof ApiError && error.reason === 'stuck') await reload();
      return;
    }
    setNote({ kind: 'ok', text: t('Undone. Reloading…') });
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {t('Restored from a copy {when}. The vault as it was before still takes {size} on the server.', {
          when: formatAgo(pending.at),
          size: size(pending.bytes),
        })}{' '}
        <span id={RESTORE_WAITS}>{t('Keep or undo this restore before restoring another copy.')}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => setAsking('keep')}>
          {t('Keep the restored vault')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setAsking('undo')}>
          {t('Undo the restore')}
        </Button>
      </div>
      <Feedback note={note} />
      <ConfirmDialog
        icon={ArchiveRestore}
        open={asking === 'keep'}
        onOpenChange={(open) => setAsking(open ? 'keep' : null)}
        question={
          history
            ? t('This deletes the vault as it was before the restore and frees {size}. Its documents can still be brought back from their history; its book PDFs and PGN files cannot.', { size: size(pending.bytes) })
            : t('This deletes the vault as it was before the restore and frees {size}. Nothing of it can be brought back.', { size: size(pending.bytes) })
        }
        confirmLabel="Keep the restored vault"
        onConfirm={() => void keep()}
      />
      <ConfirmDialog
        icon={ArchiveRestore}
        tone="default"
        open={asking === 'undo'}
        onOpenChange={(open) => setAsking(open ? 'undo' : null)}
        question={
          history
            ? t('The vault goes back to how it was before the restore, and the restored files are deleted. Documents edited since keep those edits in their history.')
            : t('The vault goes back to how it was before the restore, and the restored files are deleted with any changes made since.')
        }
        confirmLabel="Undo the restore"
        onConfirm={() => void undo()}
      />
    </div>
  );
}

/** Whether the page is in the desktop app's window (desktop/preload.cjs). */
const inDesktopApp = (): boolean => 'vaultShell' in window;

/**
 * A restore, or its undo, that stopped part way and could not put itself
 * back (server/restore.ts): what happened, and the button that finishes
 * putting the vault back on the server, from any device. Only when that
 * fails too does the card say what finishes it, in the order that works:
 * whatever else has the vault's files open is closed and the button
 * pressed again, since a held file refuses a restart's put-back just as
 * it refuses this one; then a restart, which starts the server guarded
 * and tries once more. In the words of whoever can do it: the desktop
 * app's own server restarts with the app, and any other has somebody who
 * runs it. Nothing while nothing is stuck.
 */
export function RestoreStuck({ state }: { state: RestoreState | null }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  /** The put-back failed with the journal standing: something still holds a file. */
  const [failed, setFailed] = useState(false);
  if (!state?.stuck) return null;
  /** Put back, with the page about to reload. */
  const done = note?.kind === 'ok';

  const putBack = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      await api('/api/storage/restore/recover', { method: 'POST' });
    } catch (error) {
      setNote({ kind: 'error', text: apiErrorMessage(error) });
      setFailed(error instanceof ApiError && error.reason === 'stuck');
      setBusy(false);
      return;
    }
    setNote({ kind: 'ok', text: t('The vault is back. Reloading…') });
    // Every page reads the vault again, as after an undo.
    setTimeout(() => window.location.reload(), 900);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-warn flex items-start gap-2 text-sm leading-relaxed">
        <TriangleAlert className="mt-0.5 glyph shrink-0" />
        <span>
          {t('A restore stopped part way through. Some of the vault’s folders are set aside until it is put back.')}{' '}
          <span id={RESTORE_STUCK}>{t('Put the vault back before downloading or restoring a copy.')}</span>
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy || done} onClick={() => void putBack()}>
          {busy && <Spinner className="glyph" data-icon="inline-start" />}
          {t('Put the vault back')}
        </Button>
      </div>
      <Feedback note={note} />
      {failed && (
        <p className="text-muted-foreground text-sm">
          {state.sameMachine && inDesktopApp()
            ? t('Close any other program that has the vault’s files open, such as a sync client, an editor or a terminal in a vault folder, and try again. If it still fails, quit and reopen the app.')
            : t('Close any program on the server that has the vault’s files open, such as a sync client, an editor or a terminal in a vault folder, and try again. If it still fails, restart the server, or ask whoever runs it to.')}
        </p>
      )}
    </div>
  );
}
