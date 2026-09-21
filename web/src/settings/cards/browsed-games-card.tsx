import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/skeletons';
import { HardDrive, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SETTINGS_LIST, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { size } from '@/settings/cards/shared';

// --- Browsed games -----------------------------------------------------------

interface CachedPlayer {
  provider: 'chesscom' | 'lichess';
  user: string;
  months: number;
  bytes: number;
}

const PROVIDER_NAME: Record<string, string> = { chesscom: 'Chess.com', lichess: 'Lichess' };

/**
 * Everything browsing has left on disk, and the way to be rid of it.
 *
 * Looking at a month keeps it, so that it browses offline afterwards and
 * so that a second look costs nothing. Nothing ever removed one — look up
 * a dozen players out of curiosity and the vault is quietly holding a
 * dozen players' entire histories, none of it in the collection and none
 * of it mentioned anywhere in the app. This is the mention, and the
 * buttons: one per player, and one for the lot.
 */
export function BrowsedGamesCard({ onCleared }: { onCleared: () => void }) {
  const [players, setPlayers] = useState<CachedPlayer[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      setPlayers((await api<{ users: CachedPlayer[] }>('/api/games/cache')).users);
    } catch {
      // The card stays on whatever it last knew — it is an inventory,
      // not a health check.
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  // A failed delete needs no note of its own: the refresh right after
  // shows what is (still) being held, which is the honest report. Both
  // buttons are disabled while either runs, so a second press cannot
  // race the refresh that is about to redraw the list under it.
  const drop = async (query: string): Promise<void> => {
    setBusy(true);
    await api(`/api/games/cache${query}`, { method: 'DELETE' }).catch(() => {});
    await refresh();
    setBusy(false);
    // Even when the delete failed: what the storage card is showing came
    // from before it was tried either way, and re-reading is one request.
    onCleared();
  };

  // One row's worth. The list was always here to SAY what is being held —
  // whose history, how much — and once it says it, the size column is the
  // reason to take one player and not the rest: the handle browsed every
  // week sits in it beside the ones looked up once, and clearing the lot
  // to be rid of those re-downloads the months actually in use.
  const clearOne = (p: CachedPlayer): Promise<void> =>
    drop(`?provider=${encodeURIComponent(p.provider)}&user=${encodeURIComponent(p.user)}`);

  const total = (players ?? []).reduce((sum, p) => sum + p.bytes, 0);

  return (
    <Card icon={HardDrive} title={t('Browsed games')} anchor="browsed-games">
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t(
          'Months you have browsed are kept so they open instantly and work offline. Clearing them only means downloading a month again next time. Games you kept are copies and stay in your collection.',
        )}
      </p>
      {players === null && (
        /* The list and its footer come from /api/games/cache, a different
           answer from the one that drew this page — so the card stood at
           its paragraph's height and then grew by a row and a total,
           pushing the danger zone and the version under it down. One
           cached player is what a personal vault almost always holds, so
           that is the shape held open. Drawn at once and not behind
           useSlowLoad: the choice here is not flash-or-nothing, it is
           flash-or-shove. */
        <>
          <div className={SETTINGS_LIST}>
            <div className="flex items-center gap-2 py-(--row-py-dense) pl-3 pr-1.5">
              {/* h-7, matching the row's clear button — the tallest thing
                  in it, and so what the row takes its height from. The
                  name's own line box is 24px and the size's 20px, which
                  is what these stood at while the row was text only. */}
              <div className="flex h-7 min-w-0 flex-1 items-center pointer-coarse:h-9">
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex h-7 shrink-0 items-center pointer-coarse:h-9">
                <Skeleton className="h-2.5 w-40" />
              </div>
              {/* The row's own clear button, held inert: icon-sm's
                  size-7, and its size-9 under a coarse pointer. */}
              <Button variant="ghost" size="icon-sm" className="shrink-0" disabled tabIndex={-1} aria-hidden>
                <Trash2 className="glyph" />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-2.5 w-24" />
            {/* The footer's own button, held inert: h-8, and h-9 under a
                coarse pointer (ui/button). */}
            <Button variant="ghost" disabled tabIndex={-1}>
              {t('Clear all')}
            </Button>
          </div>
        </>
      )}
      {players !== null && players.length === 0 && (
        <p className="text-muted-foreground text-sm">{t('Nothing cached yet.')}</p>
      )}
      {players !== null && players.length > 0 && (
        <>
          <ul className={SETTINGS_LIST}>
            {players.map((p) => (
              <li key={`${p.provider}/${p.user}`} className="flex items-center gap-2 py-(--row-py-dense) pl-3 pr-1.5">
                {/* The name and its sizes keep the baseline they shared
                    when they were the whole row; only the button, which
                    has no text to sit on, is centred against them. */}
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate type-row">{p.user}</p>
                  <p className="text-muted-foreground shrink-0 type-row-sub">
                    {PROVIDER_NAME[p.provider] ?? p.provider} · {t('{n} months', { n: p.months })} ·{' '}
                    {size(p.bytes)}
                  </p>
                </div>
                {/* No confirmation: this is a cache, and the button that
                    takes ALL of it does not ask either — a question in
                    front of the smaller action would be the louder one. */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  disabled={busy}
                  title={t("Clear this player's months")}
                  onClick={() => void clearOne(p)}
                >
                  <Trash2 className="glyph" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-sm">{t('{size} in total', { size: size(total) })}</span>
            <Button variant="ghost" disabled={busy} onClick={() => void drop('')}>
              {t('Clear all')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
