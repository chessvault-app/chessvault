import { Skeleton } from '@/components/skeletons';
import { HardDrive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SETTINGS_LIST, SettingsCard as Card } from '@/settings/SettingsPage.skeleton';
import { navigate, type Section } from '@/lib/router';
import { t } from '@/lib/i18n';
import { size, type StorageReport } from '@/settings/cards/shared';

// --- Storage used ------------------------------------------------------------

/** The areas /api/storage reports, in its order, with what each is called. */
/**
 * The rows: one for the vault's documents, then each thing that can be
 * cleared or rebuilt, with where to go to do it. A row links either to a
 * section of the app or to a card on this page (`anchor`, the Card's id);
 * a row with neither is a figure and nothing else.
 */
const STORAGE_AREAS: { keys: string[]; label: string; section?: Section; anchor?: string }[] = [
  {
    keys: ['games', 'studies', 'notes', 'books', 'puzzlebooks', 'puzzles', 'repertoire', 'sources', 'history'],
    label: 'Vault',
    anchor: 'vault',
  },
  { keys: ['gamesCache'], label: 'Browsed games', anchor: 'browsed-games' },
  { keys: ['refgames'], label: 'Reference databases', section: 'databases' },
  { keys: ['explorerCache'], label: 'Explorer cache' },
  { keys: ['tablebaseCache'], label: 'Tablebase cache', anchor: 'tablebase' },
  // Removed from the engine's settings, on the Board.
  { keys: ['engineNets'], label: 'Engine networks', section: 'board' },
];

/**
 * What is on disk, and what of it can be freed.
 *
 * The card used to list the vault's folders one by one, and then the
 * Vault card above it grew the same folders as a tree, with the same
 * sizes, forty pixels apart on one page. So the two are split by their
 * question: the Vault card is "where is my data", and this one is "what
 * can I free" — one row for the documents, pointing at the Vault card,
 * and a row per cache with where to clear it. Nothing is cleared from
 * here: each area that can be emptied has its own place, and a list of
 * sizes is not the place to lose data.
 */
export function StorageCard({ storage }: { storage: StorageReport | null }) {
  // The page's one answer (useStorage), which is the Vault card's as
  // well: both cards wanted the same walk of the vault, and it was paid
  // for twice on every visit. A clearing on this page re-asks it there,
  // and the last figures stay up while the new ones come rather than
  // falling back to skeletons.
  const areas = storage && Object.fromEntries(storage.areas.map((a) => [a.key, { bytes: a.bytes, files: a.files }]));
  const total = Object.values(areas ?? {}).reduce((sum, a) => sum + a.bytes, 0);
  return (
    <Card icon={HardDrive} title={t('Storage used')}>
      <p className="text-muted-foreground text-sm leading-relaxed">
        {t('What the app keeps on disk. The vault is your documents. The rest is rebuilt or refetched after it is cleared from its own place.')}
      </p>
      {/* On a phone the well gives up its own frame and its share of the
          row's padding, so its rows sit flush in the group's card and
          read as the group's own rows rather than as a list inside a
          list. Its dividers are what separates them there; on Android
          the surrounding rows are separated by a gap instead, and this
          one list keeps its rules, because a gap between every figure
          would break a table of them into six cards. */}
      <ul className={cn(SETTINGS_LIST, 'max-md:ios:-my-2.5 max-md:android:-mx-4 max-md:android:-my-3 max-md:android:rounded-none max-md:android:border-0')}>
        {STORAGE_AREAS.map(({ keys, label, section, anchor }) => {
          const area = areas && { bytes: keys.reduce((s, k) => s + (areas[k]?.bytes ?? 0), 0) };
          // A card that is not on this page (the demo has no Browsed
          // games card) leaves its row a plain figure.
          const target = anchor ? document.getElementById(anchor) : null;
          const go = section ? () => navigate(section) : target ? () => target.scrollIntoView({ block: 'start' }) : null;
          return (
            <li key={label} className="flex items-baseline gap-2 px-3 py-(--row-py) max-md:android:min-h-12 max-md:android:items-center max-md:android:px-4">
              {go ? (
                <button
                  type="button"
                  // A thumb gets the 36px floor (DESIGN.md, Buttons) out of
                  // the row's own padding: the negative margin keeps the
                  // row at the 40px it already was. An `after:` hit box
                  // would not do here, since `truncate` clips it.
                  className="text-foreground hover:text-primary min-w-0 flex-1 truncate text-left type-row pointer-coarse:-my-1.5 pointer-coarse:min-h-9"
                  onClick={go}
                >
                  {t(label)}
                </button>
              ) : (
                <p className="min-w-0 flex-1 truncate type-row">{t(label)}</p>
              )}
              {areas === null ? (
                <Skeleton className="h-2.5 w-16" />
              ) : (
                <p className="text-muted-foreground shrink-0 type-row-sub tabular-nums">
                  {area ? size(area.bytes) : '—'}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-2">
        {areas === null ? (
          // The line box the sentence lands in, not a bare bar: without
          // it the card stood 10px short of itself.
          <div className="flex h-5 items-center">
            <Skeleton className="h-2.5 w-24" />
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">{t('{size} in total', { size: size(total) })}</span>
        )}
      </div>
    </Card>
  );
}
