import { BarChart3, BookMarked, Database, LayoutGrid, Puzzle, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '@/lib/router';
import { useMediaQuery } from '@/lib/media';
import { Button } from '@/ui/Button';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { t } from '@/lib/i18n';
import { DashboardPage } from './DashboardPage';
import { difficultyWord } from './bands';
import { fetchSolvedToday } from './today';

/**
 * The phone's puzzle page: a launcher, and nothing else.
 *
 * The Puzzles tab used to land on the dashboard, which is stats and a
 * two-hundred-row attempt log — the page you consult occasionally,
 * opened every single time you reach for training. Its three shortcuts
 * (Train, Books, Themes) had been bolted to the TOP of it, which on a
 * phone held in one hand is the one part of the screen a thumb cannot
 * get to.
 *
 * So this is the hub the dashboard was being asked to be. Everything it
 * offers sits on the bottom edge, above the tab bar, with the empty
 * space put where nothing needs to be pressed. The dashboard goes back
 * to being a dashboard, one tile away.
 *
 * Nothing here waits on the network to be usable: every destination is a
 * plain link, and the difficulty word is read from the same localStorage
 * key the trainer writes. Only two things arrive late — the review count
 * and today's tally — and both are placed ABOVE the primary button, so
 * a slow answer grows the block upward and no target ever moves out from
 * under a thumb already travelling towards it.
 */
export function HubPage() {
  // A launcher would be a second copy of the sidebar on a desktop, which
  // lists Dashboard, Books and Themes under Puzzles already. So above the
  // phone width this route simply IS the dashboard — rendered rather than
  // redirected, because a redirect leaves an entry in the history that
  // Back would only bounce off again.
  //
  // The two halves are separate components on purpose: a resize across
  // the breakpoint must not change how many hooks this one ran.
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  return phone ? <Hub /> : <DashboardPage />;
}

interface Meta {
  ready: boolean;
  failed?: number;
}

function Hub() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [solvedToday, setSolvedToday] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/puzzles/meta');
        if (res.ok) setMeta((await res.json()) as Meta);
      } catch {
        // Every button still works; only the review row and the tally
        // are missing, and both are decoration on a page of links.
      }
    })();
    void fetchSolvedToday().then((n) => {
      if (n !== null) setSolvedToday(n);
    });
  }, []);

  // Assume the database is there until told otherwise: it is, for anyone
  // who has ever trained, and making everybody wait to find that out
  // would delay the one button this page exists for. A fresh vault sees
  // the label correct itself, and the destination is right either way —
  // #/puzzles shows the setup gate when there is nothing to train on.
  const ready = meta?.ready !== false;
  const failed = meta?.failed ?? 0;
  // Read at render, not in state: the trainer writes this key and coming
  // back here re-mounts, so there is nothing to keep in step.
  const word = difficultyWord();

  return (
    // The scrolling family with its column pinned low: `min-h-full` and
    // the block's own `mt-auto` put everything on the bottom edge, while
    // the outer shell still scrolls if a short screen ever runs out of
    // room — a target hidden under the tab bar would be worse than a
    // page that moves. `pb-4` replaces the shell's usual 2rem + safe
    // area: the tab bar below carries the inset itself, and dead space
    // under the buttons is the opposite of what this page is for.
    <PageShell width="medium" className="min-h-full pb-4">
      <PageHeader title={t('Puzzles')} />

      <div className="mt-auto flex flex-col gap-2">
        {solvedToday !== null && solvedToday > 0 && (
          <p className="text-subtle px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
            {t('Solved today: {n}', { n: solvedToday })}
          </p>
        )}

        {/* Above Train, not below it: this row appears when an answer
            comes back, and anything that appears BELOW would shove the
            primary button up mid-reach. The same treatment the dashboard
            gives it — the one training action that is owed rather than
            chosen. */}
        {failed > 0 && (
          <Button
            variant="secondary"
            className="w-full justify-center"
            onClick={() => navigate('puzzles', 'failed')}
          >
            <RotateCcw className="size-4" />
            {t('Review failed puzzles')} · {failed}
          </Button>
        )}

        <Button
          variant="primary"
          className="h-14 w-full justify-center gap-2.5 rounded-xl text-base"
          onClick={() => navigate('puzzles')}
        >
          {ready ? (
            <>
              <Puzzle className="size-5" />
              {t('Train')}
              {/* The difficulty as a word — what pressing this will
                  actually do. Never the rating behind it, and nothing at
                  all when it is Any: that is the setting you get without
                  choosing, and "Train · Any" qualifies the button with
                  the absence of a qualifier. */}
              {word !== 'Any' && (
                <span className="text-sm font-normal opacity-75">{t(word)}</span>
              )}
            </>
          ) : (
            <>
              <Database className="size-5" />
              {t('Set up the puzzle database')}
            </>
          )}
        </Button>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['Themes', LayoutGrid, () => navigate('puzzles', 'themes')],
              ['Books', BookMarked, () => navigate('puzzles', 'books')],
              ['Dashboard', BarChart3, () => navigate('puzzles', 'dashboard')],
            ] as const
          ).map(([label, Icon, go]) => (
            <button
              key={label}
              type="button"
              onClick={go}
              className="bg-surface border-line hover:bg-surface-2 flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs font-medium transition-colors"
            >
              <Icon className="text-primary size-5" />
              {t(label)}
            </button>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
