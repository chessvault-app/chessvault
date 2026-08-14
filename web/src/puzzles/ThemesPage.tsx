import { ChevronLeft, Puzzle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/Button';
import { navigate } from '@/lib/router';
import { ChipRow } from '@/ui/ChipRow';
import { SearchInput } from '@/ui/Input';
import { SkeletonRows, useSlowLoad } from '@/ui/Skeleton';
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

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

interface ThemeCount {
  theme: string;
  count: number;
}

export function ThemesPage() {
  const [themes, setThemes] = useState<ThemeCount[] | null>(null);
  const pending = useSlowLoad(themes === null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api<{ themes?: ThemeCount[]; puzzles?: number; failed?: number }>('/api/puzzles/meta')
      .then((d) => {
        setThemes(d.themes ?? []);
        setTotal(d.puzzles ?? 0);
        setFailed(d.failed ?? 0);
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
  const known = new Set(GROUPS.flatMap((g) => g.themes));
  const leftovers = (themes ?? []).filter((t) => !known.has(t.theme) && matches(t.theme));

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            title={t('Back to the dashboard')}
            onClick={() => navigate('puzzles', 'dashboard')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-base font-semibold">{t('Puzzle themes')}</h1>
          {error && <span className="text-bad text-xs">{error}</span>}
          <span className="min-w-0 flex-1" />
          <SearchInput
            inputSize="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Find a theme')}
            aria-label={t('Find a theme')}
            className="w-44 max-w-full"
          />
        </div>

        <ChipRow className="mb-5" innerClassName="gap-2">
          <ThemeCard
            className="w-full sm:w-auto"
            label={t('All themes')}
            count={total}
            highlight
            onClick={() => navigate('puzzles')}
          />
          {failed > 0 && (
            <ThemeCard
              className="w-full sm:w-auto"
              label={t('Review failed puzzles')}
              count={failed}
              icon={RotateCcw}
              onClick={() => navigate('puzzles', 'failed')}
            />
          )}
        </ChipRow>

        {themes === null ? (
          pending ? <SkeletonRows rows={6} className="p-0" /> : null
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
              ) && <p className="text-subtle text-xs">{t('No theme matches it.')}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function ThemeGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-subtle mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
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
}: {
  label: string;
  count: number;
  onClick: () => void;
  highlight?: boolean;
  className?: string;
  icon?: typeof Puzzle;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left',
        'transition-colors duration-100',
        highlight
          ? 'bg-primary-soft border-primary/30 hover:border-primary/60'
          : 'bg-surface border-line hover:border-line-strong hover:bg-surface-2',
        className,
      )}
    >
      <Icon
        className={cn(
          'size-4 shrink-0 transition-colors',
          highlight ? 'text-primary' : 'text-subtle group-hover:text-primary',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-xs font-medium', highlight ? 'text-primary' : 'text-fg')}>
          {label}
        </span>
        <span className="text-subtle block font-mono text-[0.6875rem]">
          {compact.format(count)}
        </span>
      </span>
    </button>
  );
}
