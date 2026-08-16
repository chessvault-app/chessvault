import { AlertTriangle, Check, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { FieldMove } from '@/repertoire/field';
import { Field } from '@/ui/Field';
import { SkeletonRows, useSlowLoad } from '@/ui/Skeleton';
import type { NodeCoverage } from './coverage';
import { GAP_SHARE, type NodeGaps } from './gaps';
import type { MapNode, ResolvedNode } from './model';
import { fieldMovesFor } from './useGaps';

/**
 * The panel's statistics table: every continuation the field plays at
 * the selected node, with its share of games and the W/D/L split as a
 * stacked bar — the explorer's vocabulary, read-only and annotated
 * with the map's own facts. A charted row jumps to its node, an unmet
 * one charts in a tap, and a popular unmet one wears the warn triangle
 * the canvas badge counts.
 */

const SHOWN = 8;

export function FieldStats({
  facts,
  node,
  coverage,
  gaps,
  source,
  ratings,
  side,
  onAdd,
  onSelectChild,
}: {
  facts: ResolvedNode;
  node: MapNode;
  coverage: NodeCoverage | undefined;
  /** Set on opponent-to-move nodes while a source is on. */
  gaps: NodeGaps | undefined;
  source: string;
  ratings: string;
  side: 'white' | 'black';
  onAdd: (san: string) => void;
  onSelectChild: (id: string) => void;
}) {
  const [field, setField] = useState<FieldMove[] | null>(null);

  /**
   * `field` is null both before the answer arrives and when there is no
   * answer, and the two used to render the same: nothing at all. So the
   * panel opened without its statistics and grew them a moment later,
   * which reads as the panel being broken and then fixing itself. The
   * wait is real — one request per node, answered per position — so it
   * gets the treatment every other wait in this app gets: the shape of
   * what is coming, held back long enough that a fast answer never
   * flashes a skeleton.
   */
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!source || !facts.fen) {
      setField(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    void fieldMovesFor(source, ratings, facts.fen, side)
      .then((moves) => {
        if (live) setField(moves);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [source, ratings, side, facts.fen]);
  const pending = useSlowLoad(loading && field === null);

  const games = useMemo(() => (field ?? []).reduce((sum, m) => sum + m.total, 0), [field]);
  const rows = useMemo(
    () => (field ?? []).filter((m) => m.total > 0).sort((a, b) => b.total - a.total),
    [field],
  );

  if (!source) return null;
  if (pending) {
    return (
      <Field label="Against the field">
        <SkeletonRows rows={4} />
      </Field>
    );
  }
  if (games === 0) return null;

  const charted = new Map<string, string>();
  for (const child of node.children) if (child.san) charted.set(child.san, child.id);
  const prepared = new Set(coverage?.preparedMoves ?? []);
  const flagged = new Set((gaps?.gaps ?? []).map((g) => g.san));

  return (
    <Field
      label="Against the field"
      hint={
        gaps ? (
          <span className="text-subtle text-[0.6875rem]">
            {t('{pct}% of games met', { pct: Math.round(gaps.metShare * 100) })}
          </span>
        ) : (
          <span className="text-subtle text-[0.6875rem]">
            {t('{n} games', { n: games })}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-1">
        {rows.slice(0, SHOWN).map((move) => {
          const childId = charted.get(move.san);
          const share = move.total / games;
          const w = move.w ?? 0;
          const d = move.d ?? 0;
          const b = move.b ?? 0;
          const scored = w + d + b > 0;
          const isGap = flagged.has(move.san);
          return (
            <div
              key={move.san}
              // The border is on every row, and invisible on most: drawn
              // only where there is a gap, its 1px moved that row's
              // contents in by one against its neighbours.
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-1',
                isGap ? 'border-warn/40' : 'border-transparent',
              )}
            >
              {/* The slot is always there, empty or not: drawn only on
                  the rows that have a gap, it pushed those rows' moves
                  and bars right by its own width, so the column zigzagged
                  down the panel. */}
              <span className="w-3.5 shrink-0">
                {isGap && <AlertTriangle className="text-warn size-3.5" />}
              </span>
              <button
                type="button"
                className={
                  childId
                    ? 'text-fg hover:text-primary w-12 shrink-0 text-left text-xs font-semibold'
                    : 'text-fg w-12 shrink-0 cursor-default text-left text-xs font-semibold'
                }
                onClick={() => childId && onSelectChild(childId)}
                title={childId ? t('Show on the map') : undefined}
              >
                {move.san}
              </button>
              {/* The result split, White's wins leftmost — the explorer's
                  own reading order. */}
              {scored ? (
                <span
                  className="border-line flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border"
                  title={`+${Math.round((w / (w + d + b)) * 100)}% =${Math.round(
                    (d / (w + d + b)) * 100,
                  )}% -${Math.round((b / (w + d + b)) * 100)}%`}
                >
                  <span style={{ width: `${(w / (w + d + b)) * 100}%`, background: 'var(--color-eval-white)' }} />
                  <span style={{ width: `${(d / (w + d + b)) * 100}%`, background: 'var(--color-line-strong)' }} />
                  <span style={{ width: `${(b / (w + d + b)) * 100}%`, background: 'var(--color-eval-black)' }} />
                </span>
              ) : (
                <span className="min-w-0 flex-1" />
              )}
              {/* Everything after the bar in one box of one width, so
                  every bar starts and ends on the same two lines. Left
                  to size themselves, the marks a row happens to carry
                  came out of the bar beside them — bars of different
                  lengths in a column of bars, which reads as bars
                  measuring different things. */}
              <span className="flex w-[4.5rem] shrink-0 items-center justify-end gap-1.5">
                <span className="text-muted text-xs">
                  {share >= 0.005 ? `${Math.round(share * 100)}%` : '<1%'}
                </span>
                {/* A dot, not the word "prepared": the word was as wide
                    as the percentage and the marks together, and it is
                    the one thing here that can be said with a colour —
                    the good green this app spends on exactly this. It
                    keeps its name for the pointer and the screen
                    reader. */}
                {prepared.has(move.san) && (
                  <span
                    className="bg-good size-1.5 shrink-0 rounded-full"
                    title={t('A linked study prepares it')}
                    aria-label={t('A linked study prepares it')}
                  />
                )}
                {childId ? (
                  <Check className="text-primary size-3.5 shrink-0" aria-label={t('On the map')} />
                ) : (
                  <button
                    type="button"
                    title={t('Chart it on the map')}
                    onClick={() => onAdd(move.san)}
                    className="text-subtle hover:text-fg shrink-0"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {rows.length > SHOWN && (
          <p className="text-subtle px-2 text-xs">
            {t('and {n} rarer moves', { n: rows.length - SHOWN })}
          </p>
        )}
        {gaps && gaps.gaps.length === 0 && (
          <p className="text-muted px-2 text-xs leading-relaxed">
            {t('Every reply over {pct}% runs into your preparation.', {
              pct: Math.round(GAP_SHARE * 100),
            })}
          </p>
        )}
      </div>
    </Field>
  );
}
