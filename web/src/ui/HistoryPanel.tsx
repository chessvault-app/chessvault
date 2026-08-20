import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatAgo, formatWhen } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { Button } from './Button';
import { ConfirmSheet } from './ConfirmSheet';
import { Sheet } from './Sheet';
import { Skeleton } from './Skeleton';

/**
 * "Put this document back the way it was."
 *
 * Every vault change has been auto-committed to vault/.history.git since
 * the first release (server/vaultBackup.ts), and reading it back needed a
 * terminal until server/vaultHistory.ts. This is the half of that a person
 * actually touches.
 *
 * A version is chosen by WHEN it was taken, so the list leads with the
 * time and nothing else — a commit id is the right key and the wrong
 * label, and there is no message worth showing when every message is
 * "vault autosave". Picking one shows what it holds before anything is
 * written, because the whole point is to look before you leap.
 *
 * Restoring writes over the document in place. That is safe rather than
 * reckless because the server commits the current state first, so the
 * version being replaced is itself in this list a moment later — the
 * confirmation says so, since that is the fact that makes the choice easy.
 */

export type HistoryKind = 'studies' | 'notes' | 'games';

interface Version {
  sha: string;
  at: string;
}

export function HistoryPanel({
  kind,
  id,
  name,
  onClose,
  onRestored,
}: {
  kind: HistoryKind;
  /** Document id relative to its kind's directory, without the extension. */
  id: string;
  /** What to call the document in the sheet's own sentences. */
  name: string;
  onClose: () => void;
  /** The document on screen is now stale — reload it. */
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  /** Distinct from "no versions": this vault cannot offer history at all. */
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Version | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = `/api/history/doc/${kind}/${encodeURIComponent(id)}`;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await api<{ available: boolean; versions?: Version[] }>(path);
        if (!live) return;
        if (!res.available) setUnavailable(true);
        else setVersions(res.versions ?? []);
      } catch (caught) {
        // The demo and any deployment without git answer 404 here. That is
        // "no history", not a fault, and must not read as one.
        if (!live) return;
        setUnavailable(true);
        void caught;
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);

  const choose = async (version: Version): Promise<void> => {
    setChosen(version);
    setPreview(null);
    setError(null);
    try {
      const res = await api<{ content?: string }>(
        `/api/history/at/${version.sha}/${kind}/${encodeURIComponent(id)}`,
      );
      setPreview(res.content ?? '');
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  };

  const restore = async (version: Version): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/history/restore', {
        method: 'POST',
        json: { kind, id, sha: version.sha },
      });
      onRestored();
      onClose();
    } catch (caught) {
      setError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet label={t('Earlier versions')} onClose={onClose} className="gap-3" fill>
      <p className="text-subtle text-sm">
        {t('Every change to “{name}” is kept automatically. Pick a time to look at it.', {
          name,
        })}
      </p>

      {unavailable && (
        // Said plainly and without alarm: a vault with no history is not a
        // broken vault, and the recovery screen is the last place to make
        // somebody think something is wrong.
        <p className="text-subtle text-sm">
          {t('This vault is not keeping a history, so there is nothing earlier to show.')}
        </p>
      )}

      {!unavailable && versions === null && (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}

      {versions?.length === 0 && (
        <p className="text-subtle text-sm">
          {t('This is the only version so far — nothing has changed since it was created.')}
        </p>
      )}

      {versions && versions.length > 0 && (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {versions.map((version) => (
            <li key={version.sha}>
              <button
                type="button"
                className={`flex w-full items-baseline gap-2 rounded px-2 py-2 text-left ${
                  chosen?.sha === version.sha ? 'bg-surface-2' : 'hover:bg-surface-2/60'
                }`}
                onClick={() => void choose(version)}
              >
                {/* The relative time answers "is this the one?"; the exact
                    one settles it when two are minutes apart. */}
                <span className="text-fg text-sm">{formatAgo(version.at)}</span>
                <span className="text-subtle text-xs">{formatWhen(version.at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <div className="flex min-h-0 shrink-0 flex-col gap-2">
          {preview === null ? (
            <Skeleton className="h-24" />
          ) : (
            <pre className="bg-surface-2 text-subtle max-h-40 overflow-auto rounded p-2 font-mono text-xs whitespace-pre-wrap">
              {preview.slice(0, 4000)}
            </pre>
          )}
          <ConfirmSheet
            icon={RotateCcw}
            label={t('Restore this version')}
            triggerTitle={t('Restore this version')}
            triggerTone="danger"
            disabled={busy || preview === null}
            question={t(
              'Replace “{name}” with the version from {when}? The version you have now is kept too, so you can come back to it here.',
              { name, when: formatWhen(chosen.at) },
            )}
            confirmLabel="Restore"
            onConfirm={() => void restore(chosen)}
          />
        </div>
      )}

      {error && <p className="text-bad text-sm">{error}</p>}
    </Sheet>
  );
}

/** The header button that opens the panel. Same shape in every document. */
export function HistoryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" title={t('Earlier versions')} onClick={onClick}>
      <History className="size-3.5" />
    </Button>
  );
}
