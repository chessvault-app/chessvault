import { useEffect, useState } from 'react';
import { History, RotateCcw } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { formatAgo, formatWhen } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/skeletons';

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
 * "vault autosave".
 *
 * ONE sheet, two pages. Picking a version turns the page to what that
 * version holds, with the chevron in the corner to turn back; it does not
 * open a second window over the first. The detail page is also where the
 * restore is confirmed, because it already shows the thing being restored
 * — a separate "are you sure?" over the top would be asking about a
 * document it was not showing, which is the weaker of the two questions.
 *
 * Restoring writes over the document in place. That is safe rather than
 * reckless because the server commits the current state first, so the
 * version being replaced is back in this list a moment later — the page
 * says so, since that is the fact that makes the choice easy.
 */

export type HistoryKind = 'studies' | 'notes' | 'games';

interface Version {
  sha: string;
  at: string;
}

function HistorySheet({
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
  /** Null on the list page; a version means the sheet has turned its page. */
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
      } catch {
        // The demo and any deployment without git answer 404 here. That is
        // "no history", not a fault, and must not read as one.
        if (live) setUnavailable(true);
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

  // --- Page two: one version, and the offer to go back to it -------------
  if (chosen) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          size="sm"
          title={formatWhen(chosen.at)}
          onBack={() => setChosen(null)}
          className="gap-3"
          fill
        >
          <p className="text-muted-foreground text-sm">
            {t('This is what “{name}” held {when}.', { name, when: formatAgo(chosen.at) })}
          </p>

          {preview === null ? (
            <Skeleton className="min-h-24 flex-1" />
          ) : (
            <pre className="bg-muted text-muted-foreground min-h-0 flex-1 overflow-auto rounded-sm p-2 font-mono text-xs whitespace-pre-wrap">
              {preview}
            </pre>
          )}

          <p className="text-muted-foreground shrink-0 text-sm">
            {t('The version you have now is kept too, so you can come back to it here.')}
          </p>

          <Button
            variant="destructive"
            size="default"
            className="w-full shrink-0 justify-center"
            disabled={busy || preview === null}
            onClick={() => void restore(chosen)}
          >
            <RotateCcw className="size-3.5" data-icon="inline-start" />
            {t('Restore this version')}
          </Button>

          {error && <p className="text-destructive shrink-0 text-sm">{error}</p>}
        </DialogContent>
      </Dialog>
    );
  }

  // --- Page one: when this document was saved ----------------------------
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        size="sm"
        title={t('Earlier versions')}
        className="gap-3"
        fill
      >
        <p className="text-muted-foreground text-sm">
          {t('Every change to “{name}” is kept automatically. Pick a time to look at it.', { name })}
        </p>

        {unavailable && (
          // Said plainly and without alarm: a vault with no history is not a
          // broken vault, and the recovery screen is the last place to make
          // somebody think something is wrong.
          <p className="text-muted-foreground text-sm">
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
          <p className="text-muted-foreground text-sm">
            {t('This is the only version so far — nothing has changed since it was created.')}
          </p>
        )}

        {versions && versions.length > 0 && (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {versions.map((version) => (
              <li key={version.sha}>
                <button
                  type="button"
                  className="hover:bg-accent/60 flex w-full items-baseline gap-2 rounded-sm px-2 py-2 text-left"
                  onClick={() => void choose(version)}
                >
                  {/* The relative time answers "is this the one?"; the exact
                      one settles it when two are minutes apart. */}
                  <span className="text-foreground text-sm">{formatAgo(version.at)}</span>
                  <span className="text-muted-foreground text-xs">{formatWhen(version.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The way in: a clock in the document's header.
 *
 * It sat behind the header's ⋯ for a while, on the reasoning that a
 * document's actions belong in a menu. But this is the document's only
 * header action besides Edit and Save, and a menu holding one item is a
 * second press to reach a thing that had room to be visible — the ⋯ was
 * chrome standing in for a single button. First of the three, because it
 * is the one that looks BACKWARDS: history, then editing, then saving,
 * left to right in the order the document moves through time.
 */
export function DocumentHistory({
  kind,
  id,
  name,
  onRestored,
}: {
  kind: HistoryKind;
  id: string;
  name: string;
  onRestored: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        title={t('Earlier versions')}
        active={open}
        onClick={() => setOpen(true)}
      >
        <History className="size-3.5" />
      </Button>
      {open && (
        <HistorySheet
          kind={kind}
          id={id}
          name={name}
          onClose={() => setOpen(false)}
          onRestored={onRestored}
        />
      )}
    </>
  );
}
