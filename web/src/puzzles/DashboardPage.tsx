import { ArrowLeft, Check, RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';

/**
 * Training overview: counters, results by difficulty band, and the recent
 * attempt log — all derived from vault/puzzles/history.jsonl. Counted
 * attempts only in the aggregates; review (practice) attempts show in the
 * log with a tag but don't skew the numbers.
 */

interface HistoryEntry {
  id: string;
  win: boolean;
  counted?: boolean;
  puzzleRating: number;
  at: string;
}

interface MetaUser {
  attempts: number;
  wins: number;
  streak: number;
}

const BANDS = [
  { label: 'Easy', min: 0, max: 1399 },
  { label: 'Medium', min: 1400, max: 1799 },
  { label: 'Hard', min: 1800, max: 2199 },
  { label: 'Expert', min: 2200, max: 9999 },
] as const;

export function DashboardPage() {
  const [user, setUser] = useState<MetaUser | null>(null);
  const [failed, setFailed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    void fetch('/api/puzzles/meta')
      .then((r) => r.json())
      .then((d: { user: MetaUser; failed?: number }) => {
        setUser(d.user);
        setFailed(d.failed ?? 0);
      });
    void fetch('/api/puzzles/history?limit=500')
      .then((r) => r.json())
      .then((d: { attempts: HistoryEntry[] }) => setHistory(d.attempts));
  }, []);

  const counted = (history ?? []).filter((h) => h.counted !== false);
  const winRate = user && user.attempts > 0 ? Math.round((100 * user.wins) / user.attempts) : null;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to training"
            onClick={() => navigate('puzzles')}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg text-base font-semibold">Puzzle dashboard</h1>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Solved" value={user ? String(user.wins) : '…'} />
          <StatCard label="Attempts" value={user ? String(user.attempts) : '…'} />
          <StatCard label="Win rate" value={winRate === null ? '—' : `${winRate}%`} />
          <StatCard
            label="To review"
            value={String(failed)}
            action={
              failed > 0 ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Review failed puzzles"
                  onClick={() => navigate('puzzles', 'failed')}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              ) : undefined
            }
          />
        </div>

        <Panel flush className="mb-4">
          <PanelHeader title="By difficulty" />
          <div className="grid gap-2.5 p-3">
            {BANDS.map((band) => {
              const inBand = counted.filter(
                (h) => h.puzzleRating >= band.min && h.puzzleRating <= band.max,
              );
              const wins = inBand.filter((h) => h.win).length;
              const losses = inBand.length - wins;
              return (
                <div key={band.label} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3">
                  <span className="text-muted text-xs">{band.label}</span>
                  <div className="bg-surface-inset flex h-2 overflow-hidden rounded-full">
                    {inBand.length > 0 && (
                      <>
                        <div
                          className="bg-nag-good h-full"
                          style={{ width: `${(100 * wins) / inBand.length}%` }}
                        />
                        <div
                          className="bg-nag-blunder h-full"
                          style={{ width: `${(100 * losses) / inBand.length}%` }}
                        />
                      </>
                    )}
                  </div>
                  <span className="text-subtle w-16 text-right font-mono text-[0.6875rem] tabular-nums">
                    {inBand.length > 0 ? `${wins}/${inBand.length}` : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel flush>
          <PanelHeader title="Recent attempts" />
          {history === null ? (
            <p className="text-subtle px-3 py-3 text-xs">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-subtle px-3 py-3 text-xs">
              No attempts yet — go solve something.
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {history.slice(0, 50).map((h, i) => (
                <li
                  key={`${h.id}-${i}`}
                  className="border-line flex items-center gap-2.5 border-b px-3 py-1.5 text-xs last:border-b-0"
                >
                  {h.win ? (
                    <Check className="text-good size-3.5 shrink-0" aria-label="solved" />
                  ) : (
                    <X className="text-bad size-3.5 shrink-0" aria-label="failed" />
                  )}
                  <span className="text-fg font-mono">#{h.id}</span>
                  <span className="text-subtle font-mono tabular-nums">{h.puzzleRating}</span>
                  {h.counted === false && (
                    <span className="bg-surface-2 text-subtle rounded px-1.5 py-0.5 text-[0.625rem]">
                      review
                    </span>
                  )}
                  <span className="text-subtle ml-auto tabular-nums" title={h.at}>
                    {when(h.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-surface border-line flex items-center justify-between rounded-xl border px-3 py-2.5">
      <div>
        <div className="text-subtle text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
          {label}
        </div>
        <div className="text-fg font-mono text-xl font-bold tabular-nums">{value}</div>
      </div>
      {action}
    </div>
  );
}

/** "14:03" today, "Aug 6" earlier this year, "2025-11-02" before that. */
function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString();
}
