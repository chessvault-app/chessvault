import { useEffect, useState } from 'react';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import { History, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { api, apiErrorMessage } from '@/lib/api';
import { formatWhen } from '@/lib/dates';
import { t } from '@/lib/i18n';
import { Feedback, type Note } from '@/settings/cards/shared';

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
 * A deleted document back at the version it had when deleted, which is
 * the newest one its history holds. Outside the card because the React
 * Compiler cannot lower a throw inside a try yet, and the card wants one
 * catch for "no version" and "the route refused" alike.
 */
async function restoreLatest(kind: string, id: string): Promise<void> {
  const versions = await api<{ versions?: { sha: string }[] }>(
    `/api/history/doc/${kind}/${encodeURIComponent(id)}`,
  );
  const sha = versions.versions?.[0]?.sha;
  if (!sha) throw new Error(t('no version to restore'));
  await api('/api/history/restore', { method: 'POST', json: { kind, id, sha } });
}

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
export function RecoveryCard() {
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
    // Only the request is in the try: the React Compiler cannot lower
    // the `?? []` inside one yet.
    let res: { available: boolean; deleted?: Gone[] };
    try {
      res = await api<{ available: boolean; deleted?: Gone[] }>('/api/history/deleted');
    } catch {
      // No history route at all: nothing to offer, and nothing is wrong.
      setAvailable(false);
      return;
    }
    setAvailable(res.available);
    setGone(res.deleted ?? []);
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
      await restoreLatest(item.kind, item.id);
      setNote({ kind: 'ok', text: t('“{name}” is back.', { name: item.id.split('/').at(-1)! }) });
      await load();
    } catch (error) {
      setNote({ kind: 'error', text: apiErrorMessage(error) });
    }
    // After the try, not in a finally: the React Compiler cannot lower
    // one yet, and both arms fall through to here.
    setBusy('');
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
              className="flex items-center justify-between gap-2 py-(--row-py-tight)"
            >
              <span className="min-w-0">
                <span className="text-foreground block truncate type-row">{item.id}</span>
                <span className="text-muted-foreground type-row-sub">
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
                <RotateCcw className="glyph" />
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
