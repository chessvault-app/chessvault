import { ArrowLeft, Puzzle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { Button } from '@/ui/Button';

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
  if (LABELS[theme]) return LABELS[theme];
  const spaced = theme
    .replace(/([A-Z])/g, ' $1')
    .replace(/(\d+)/g, ' $1')
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

interface ThemeCount {
  theme: string;
  count: number;
}

export function ThemesPage() {
  const [themes, setThemes] = useState<ThemeCount[] | null>(null);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    void fetch('/api/puzzles/meta')
      .then((r) => r.json())
      .then((d: { themes?: ThemeCount[]; puzzles?: number; failed?: number }) => {
        setThemes(d.themes ?? []);
        setTotal(d.puzzles ?? 0);
        setFailed(d.failed ?? 0);
      });
  }, []);

  const byName = new Map((themes ?? []).map((t) => [t.theme, t.count]));
  const known = new Set(GROUPS.flatMap((g) => g.themes));
  const leftovers = (themes ?? []).filter((t) => !known.has(t.theme));

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to training"
            onClick={() => navigate('puzzles')}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-base font-semibold">Puzzle themes</h1>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <ThemeCard
            className="w-full sm:w-auto"
            label="All themes"
            count={total}
            highlight
            onClick={() => navigate('puzzles')}
          />
          {failed > 0 && (
            <ThemeCard
              className="w-full sm:w-auto"
              label="Review failed puzzles"
              count={failed}
              icon={RotateCcw}
              onClick={() => navigate('puzzles', 'failed')}
            />
          )}
        </div>

        {themes === null ? (
          <p className="text-subtle text-sm">Loading…</p>
        ) : (
          <>
            {GROUPS.map((group) => {
              const present = group.themes.filter((t) => byName.has(t));
              if (present.length === 0) return null;
              return (
                <ThemeGroup key={group.title} title={group.title}>
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
              <ThemeGroup title="More">
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
        <span className="text-subtle block font-mono text-[0.625rem]">
          {compact.format(count)}
        </span>
      </span>
    </button>
  );
}
