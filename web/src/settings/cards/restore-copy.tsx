import { useEffect, useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FilePicker } from '@/components/file-picker';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogMedia, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { api, apiErrorMessage, apiUpload } from '@/lib/api';
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
  /** What a restore would do with the history, said before it starts. */
  history: 'adopt' | 'keep' | 'none';
  /** Free bytes where the vault is, or null when the server cannot say. */
  free: number | null;
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
        disabled={state?.pending != null}
        title={state?.pending ? t('Keep or undo the last restore first') : undefined}
        onFiles={([picked]) => void pick(picked!)}
        render={<Button variant="secondary" />}
      >
        {t('Restore from a copy')}
      </FilePicker>
      {file && <RestoreDialog file={file} state={state} onClose={() => setFile(null)} />}
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
  onClose,
}: {
  file: File;
  /** Null when the server would not say (its upload then answers for itself). */
  state: RestoreState | null;
  onClose: () => void;
}) {
  /** Percent sent while uploading; 100 while the server puts the copy in place. */
  const [progress, setProgress] = useState<number | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [note, setNote] = useState<Note>(null);
  const free = state?.free ?? null;
  const tooBig = free !== null && file.size > free;
  const placing = progress === 100;

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
      return;
    }
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
    // stopping, so the window stays until it says how that went.
    if (placing) return;
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
          <AlertDialogCancel disabled={placing}>{t('Cancel')}</AlertDialogCancel>
          <Button disabled={progress !== null || tooBig || note?.kind === 'ok'} onClick={() => void restore()}>
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
        })}
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
