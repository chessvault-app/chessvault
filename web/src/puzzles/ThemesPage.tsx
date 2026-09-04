import { Puzzle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { navigate } from '@/lib/router';
import { ChipRow } from '@/components/chip-row';
import { SearchInput } from '@/components/text-fields';
import { Skeleton, SkeletonThemeCard, SkeletonThemeGroups, useSlowLoad } from '@/components/skeletons';
import { t } from '@/lib/i18n';

/**
 * Full-page theme picker — cards grouped the way lichess organises its
 * puzzle themes, replacing a bare <select> (lanph3re's call: the dropdown was
 * "plain and not aesthetically good").
 */

const GROUPS: { title: string; themes: string[] }[] = [
  {
    title: 'Game phase',
    themes: [
      'opening',
      'middlegame',
      'endgame',
      'rookEndgame',
      'pawnEndgame',
      'queenEndgame',
      'bishopEndgame',
      'knightEndgame',
      'queenRookEndgame',
    ],
  },
  {
    title: 'Checkmates',
    themes: [
      'mate',
      'mateIn1',
      'mateIn2',
      'mateIn3',
      'mateIn4',
      'mateIn5',
      'backRankMate',
      'smotheredMate',
      'anastasiaMate',
      'arabianMate',
      'bodenMate',
      'doubleBishopMate',
      'dovetailMate',
      'hookMate',
      'vukovicMate',
      'killBoxMate',
    ],
  },
  {
    title: 'Tactical motifs',
    themes: [
      'fork',
      'pin',
      'skewer',
      'hangingPiece',
      'trappedPiece',
      'discoveredAttack',
      'doubleCheck',
      'sacrifice',
      'attraction',
      'deflection',
      'interference',
      'intermezzo',
      'clearance',
      'capturingDefender',
      'xRayAttack',
      'zugzwang',
    ],
  },
  {
    title: 'Attacks',
    themes: ['kingsideAttack', 'queensideAttack', 'attackingF2F7', 'exposedKing'],
  },
  {
    title: 'Special moves',
    themes: ['castling', 'enPassant', 'promotion', 'underPromotion', 'quietMove', 'defensiveMove'],
  },
  { title: 'Goals', themes: ['crushing', 'advantage', 'equality'] },
  { title: 'Length', themes: ['oneMove', 'short', 'long', 'veryLong'] },
  { title: 'Source', themes: ['master', 'masterVsMaster', 'superGM'] },
];

const LABELS: Record<string, string> = {
  attackingF2F7: 'Attacking f2/f7',
  xRayAttack: 'X-ray attack',
  enPassant: 'En passant',
  masterVsMaster: 'Master vs master',
  superGM: 'Super-GM games',
  master: 'Master games',
  oneMove: 'One move',
  killBoxMate: 'Kill box mate',
};

/** camelCase theme id → human label ("hangingPiece" → "Hanging piece"). */
export function themeLabel(theme: string): string {
  if (LABELS[theme]) return t(LABELS[theme]);
  const spaced = theme
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .toLowerCase()
    .trim();
  return t(spaced.charAt(0).toUpperCase() + spaced.slice(1));
}

/**
 * The one theme that names a puzzle to the person who solved it.
 *
 * Lichess tags carry six kinds of fact at once, and half of them say
 * nothing about the position: "short", "advantage", "middlegame" is
 * every second puzzle. A row that has one word for a puzzle wants the
 * motif first (a fork is what you remember), then the mate, then the
 * attack or the special move, then the phase; the goal, the length and
 * the source never. Null when the tags hold nothing of the kind, so the
 * caller can fall back to what it had.
 */
const DESCRIBES = ['Tactical motifs', 'Checkmates', 'Attacks', 'Special moves', 'Game phase'];
export function describeTheme(themes: readonly string[]): string | null {
  for (const title of DESCRIBES) {
    const group = GROUPS.find((g) => g.title === title);
    if (!group) continue;
    // "Mate" heads its group and every mate puzzle carries it; the named
    // one beside it ("Mate in 2", "Back rank mate") says more, so it goes
    // first and the bare tag is the last resort.
    const hit =
      group.themes.find((th) => th !== 'mate' && themes.includes(th)) ??
      (themes.includes('mate') && group.themes.includes('mate') ? 'mate' : undefined);
    if (hit) return themeLabel(hit);
  }
  return null;
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** Every theme a GROUPS section claims — what tells a leftover apart. */
const KNOWN = new Set(GROUPS.flatMap((g) => g.themes));

/**
 * The page's shape last visit, per device: cards per drawn section, the
 * "More" group last. The real counts come from the vault's puzzle
 * database, so 3×6 was wrong in both directions — a full Lichess dump
 * draws ~9 sections and ~70 cards, and a vault with no database draws
 * nothing at all. The histogram does not move once the database is
 * built, which makes it the most stable shape in the app to remember.
 * Same bargain as home/reservation.ts: a paint hint, never the
 * authority, corrected by the answer. Only a successful answer writes
 * it — an outage sets `themes` to [] too, and recording that would
 * reserve nothing at a vault that has plenty.
 */
const SHAPE_KEY = 'vault:puzzle-themes-shape';

/**
 * The stored shape as counts: positive whole numbers, clamped the way
 * reservation.ts clamps — a count past any real group's size is rounded
 * down, not thrown away, because dropping it would take the reservation
 * from the fullest vault. [] is a vault seen WITHOUT a database (reserve
 * nothing); null is a device that has never been here (guess the
 * default).
 */
function parseShape(raw: string | null): number[] | null {
  if (raw === null) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(stored)) return null;
  return stored
    .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
    .slice(0, GROUPS.length + 1)
    .map((n) => Math.min(n, 24));
}

interface ThemeCount {
  theme: string;
  count: number;
}

export function ThemesPage() {
  const [themes, setThemes] = useState<ThemeCount[] | null>(null);
  const pending = useSlowLoad(themes === null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);

  // What this device reserves while the answer is in the air — read once;
  // the wait it stands through cannot change it.
  const [reserved] = useState(() => parseShape(localStorage.getItem(SHAPE_KEY)));

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ themes?: ThemeCount[]; puzzles?: number; failed?: number }>('/api/puzzles/meta')
      .then((d) => {
        const list = d.themes ?? [];
        setThemes(list);
        setTotal(d.puzzles ?? 0);
        setFailed(d.failed ?? 0);
        // Remembered for the next visit's reservation, above. Query
        // filtering plays no part: this is the page's whole histogram.
        const present = new Set(list.map((t) => t.theme));
        const counts = GROUPS.map((g) => g.themes.filter((th) => present.has(th)).length).filter(
          (n) => n > 0,
        );
        const extra = list.filter((t) => !KNOWN.has(t.theme)).length;
        if (extra > 0) counts.push(extra);
        localStorage.setItem(SHAPE_KEY, JSON.stringify(counts));
      })
      // An empty page under an error line, never an immortal skeleton.
      .catch((e: unknown) => {
        setThemes([]);
        setError(apiErrorMessage(e));
      });
  }, []);

  // The page's only job is finding one theme in ~70 cards; a filter beats
  // scanning a wall. Matched against the translated label, which is what
  // is being read.
  const [query, setQuery] = useState('');
  const matches = (theme: string): boolean =>
    query.trim() === '' || themeLabel(theme).toLowerCase().includes(query.trim().toLowerCase());

  const byName = new Map((themes ?? []).map((t) => [t.theme, t.count]));
  const leftovers = (themes ?? []).filter((t) => !KNOWN.has(t.theme) && matches(t.theme));

  return (
    // `block`: this page spaces its sections with their own margins, not
    // the shell's column gap.
    <PageShell width="medium" className="block">
        {/* The shelves' two-row shape: the heading row carries what is
            ABOUT the page, and the search gets a full-width line of its
            own instead of a stub squeezed beside the title. */}
        {/* gap-4, the shelf toolbar's and PageShell's: see shelf-toolbar. */}
        <div className="mb-4 flex flex-col gap-4">
          <PageHeader
            title={t('Puzzle themes')}
            back={() => navigate('puzzles', 'hub')}
            actions={
              error && (
                <span className="text-destructive text-sm" role="alert">
                  {error}
                </span>
              )
            }
          />
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Find a theme')}
            aria-label={t('Find a theme')}
            className="w-full"
          />
        </div>

        <ChipRow className="mb-4" innerClassName="gap-2">
          <ThemeCard
            className="w-full sm:w-auto"
            label={t('All themes')}
            count={total}
            pending={themes === null}
            highlight
            onClick={() => navigate('puzzles')}
          />
          {/* The review chip and the counts come from the same answer as
              the themes, so it used to arrive with them — turning a row of
              one into a row of two under a search box that had not moved.
              Its place is held instead. A vault with nothing failed gives
              the place up when the answer says so, which is the one case
              that cannot be known in advance. */}
          {themes === null ? (
            <SkeletonThemeCard className="w-full sm:w-auto" />
          ) : failed > 0 ? (
            <ThemeCard
              className="w-full sm:w-auto"
              label={t('Review failed puzzles')}
              count={failed}
              icon={RotateCcw}
              onClick={() => navigate('puzzles', 'failed')}
            />
          ) : null}
        </ChipRow>

        {themes === null ? (
          pending ? (
            // The shape this vault drew last visit; the 3×6 guess only
            // for a device that has never been here; nothing at all for
            // a vault seen without a database — its settled page is
            // empty, and a wall of invented groups would be the jump in
            // the other direction.
            reserved === null ? (
              <SkeletonThemeGroups />
            ) : reserved.length > 0 ? (
              <SkeletonThemeGroups counts={reserved} />
            ) : null
          ) : null
        ) : (
          <>
            {GROUPS.map((group) => {
              const present = group.themes.filter((t) => byName.has(t) && matches(t));
              if (present.length === 0) return null;
              return (
                <ThemeGroup key={group.title} title={t(group.title)}>
                  {present.map((t) => (
                    <ThemeCard
                      key={t}
                      label={themeLabel(t)}
                      count={byName.get(t)!}
                      onClick={() => navigate('puzzles', 'theme', t)}
                    />
                  ))}
                </ThemeGroup>
              );
            })}
            {leftovers.length > 0 && (
              <ThemeGroup title={t('More')}>
                {leftovers.map((t) => (
                  <ThemeCard
                    key={t.theme}
                    label={themeLabel(t.theme)}
                    count={t.count}
                    onClick={() => navigate('puzzles', 'theme', t.theme)}
                  />
                ))}
              </ThemeGroup>
            )}
            {query.trim() !== '' &&
              leftovers.length === 0 &&
              GROUPS.every(
                (g) => g.themes.filter((th) => byName.has(th) && matches(th)).length === 0,
              ) && <p className="text-muted-foreground text-sm">{t('No theme matches it.')}</p>}
          </>
        )}
    </PageShell>
  );
}

function ThemeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="text-muted-foreground mb-2 text-sm font-medium">
        {title}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

function ThemeCard({
  label,
  count,
  onClick,
  highlight = false,
  className,
  icon: Icon = Puzzle,
  pending,
}: {
  label: string;
  count: number;
  onClick: () => void;
  highlight?: boolean;
  className?: string;
  icon?: typeof Puzzle;
  /** The count is not known yet, so it is a bar rather than a 0. */
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left',
        'transition-colors duration-100',
        highlight
          ? 'bg-muted border-primary/30 hover:border-primary/60'
          : 'bg-card border-border hover:border-border hover:bg-accent',
        className,
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 transition-colors',
          highlight ? 'text-primary' : 'text-muted-foreground group-hover:text-primary',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-medium', highlight ? 'text-primary' : 'text-foreground')}>
          {label}
        </span>
        <span className="text-muted-foreground block font-mono text-xs">
          {pending ? (
            // A zero that becomes six million is a number the page stated
            // and then took back; the placeholder says nothing instead.
            <Skeleton className="my-[0.1875rem] block h-2 w-10" />
          ) : (
            compact.format(count)
          )}
        </span>
      </span>
    </button>
  );
}
