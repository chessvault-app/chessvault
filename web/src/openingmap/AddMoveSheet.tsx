import { Check, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { t } from '@/lib/i18n';
import type { FieldMove } from '@/repertoire/field';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { MiniBoard } from '@/ui/MiniBoard';
import { Sheet } from '@/ui/Sheet';
import type { NodeCoverage } from './coverage';
import { normalizeSan, type MapNode, type ResolvedNode } from './model';
import { fieldMovesFor } from './useGaps';

/**
 * Growing the map by tapping, the explorer's vocabulary: every move the
 * field actually plays here, ordered by how often, with what the studies
 * prepare and what the map already charts marked on the rows. Typing a
 * SAN stays available underneath for the move nobody has played yet —
 * the whole point of preparing it — in a field at the foot of this
 * sheet rather than in a window over it. It used to close this sheet and
 * open a prompt: two windows, in sequence, to answer one question that
 * the window you were already in had room for.
 */

interface Row {
  san: string;
  /** Share of games, when a field source is on. */
  share: number | null;
  prepared: boolean;
  /** The charted child standing on this move, if any. */
  childId: string | null;
}

export function AddMoveSheet({
  facts,
  coverage,
  source,
  ratings,
  side,
  onAdd,
  onSelectChild,
  onClose,
}: {
  facts: ResolvedNode;
  coverage: NodeCoverage | undefined;
  source: string;
  ratings: string;
  /** The map's colour — whose games count when the field is your own. */
  side: 'white' | 'black';
  onAdd: (san: string) => void;
  onSelectChild: (id: string) => void;
  onClose: () => void;
}) {
  const [field, setField] = useState<FieldMove[] | null>(source ? null : []);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source || !facts.fen) {
      setField([]);
      return;
    }
    let live = true;
    void fieldMovesFor(source, ratings, facts.fen, side).then((moves) => {
      if (live) setField(moves);
    });
    return () => {
      live = false;
    };
  }, [source, ratings, side, facts.fen]);

  const rows = useMemo<Row[]>(() => {
    const children = new Map<string, string>();
    for (const child of facts.mapNode.children as MapNode[]) {
      if (child.san) children.set(child.san, child.id);
    }
    const prepared = new Set(coverage?.preparedMoves ?? []);
    const games = (field ?? []).reduce((sum, m) => sum + m.total, 0);
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const move of field ?? []) {
      if (move.total === 0) continue;
      seen.add(move.san);
      out.push({
        san: move.san,
        share: games > 0 ? move.total / games : null,
        prepared: prepared.has(move.san),
        childId: children.get(move.san) ?? null,
      });
    }
    // What the studies prepare and the map charts belongs on the list
    // even when the field never plays it — that is YOUR move.
    for (const san of prepared) {
      if (!seen.has(san)) {
        seen.add(san);
        out.push({ san, share: null, prepared: true, childId: children.get(san) ?? null });
      }
    }
    for (const [san, id] of children) {
      if (!seen.has(san)) out.push({ san, share: null, prepared: false, childId: id });
    }
    return out;
  }, [field, coverage, facts.mapNode.children]);

  const label = moveNumberLabel(facts.ply + 1);

  /**
   * The typed move, judged here rather than by the caller: this sheet is
   * the one that knows the position, so it can answer "not a legal move
   * here" in place instead of handing the question to a window that has
   * to be opened to ask it.
   *
   * A move already on the map selects it, exactly as its row would — a
   * SAN somebody typed means the same thing as the row they missed.
   */
  const submit = (): void => {
    const raw = typed.trim();
    if (!raw || !facts.fen) return;
    const san = normalizeSan(facts.fen, raw);
    if (!san) {
      setError(t('Not a legal move in this position'));
      return;
    }
    const child = (facts.mapNode.children as MapNode[]).find((c) => c.san === san);
    if (child) onSelectChild(child.id);
    else onAdd(san);
    onClose();
  };

  return (
    // `fill`: this is a PAGE of the details sheet it opens over — browse
    // what the field plays and pick one — so it takes that sheet's
    // height rather than shrinking to its own list and reading as a
    // second, smaller window stacked on the first.
    <Sheet label={t('Add a move')} onClose={onClose} fill>
      <div className="flex items-center gap-3">
        {facts.fen && (
          <MiniBoard
            fen={facts.fen}
            size={56}
            className="border-line shrink-0 overflow-hidden rounded-md border"
          />
        )}
        <p className="text-muted text-xs leading-relaxed">
          {source
            ? t('Every reply the field plays here — tap one to chart it.')
            : t('What the studies prepare here — pick a field source to see statistics.')}
        </p>
      </div>
      {/* Grows into the sheet, which is as tall as the one it opened
          over — capped only from `sm`, where a sheet is a window in the
          middle of a screen rather than a page filling one. */}
      <div className="flex min-h-0 grow flex-col gap-0.5 overflow-y-auto sm:max-h-72">
        {field === null ? null : rows.length === 0 ? (
          <p className="text-muted px-1 py-3 text-center text-xs">
            {t('Nothing to offer — type the move instead.')}
          </p>
        ) : (
          rows.map((row) => (
            <button
              key={row.san}
              type="button"
              onClick={() => {
                if (row.childId) onSelectChild(row.childId);
                else onAdd(row.san);
                onClose();
              }}
              className="hover:bg-surface-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left"
            >
              <span className="text-fg w-16 shrink-0 text-sm font-semibold">
                {label} {row.san}
              </span>
              {row.share !== null && (
                <span className="bg-surface-inset relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                  <span
                    className="bg-primary/60 absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
                  />
                </span>
              )}
              {row.share !== null && (
                <span className="text-muted w-10 shrink-0 text-right text-xs">
                  {Math.round(row.share * 100)}%
                </span>
              )}
              {row.prepared && (
                <span className="text-good shrink-0 text-xs" title={t('A linked study prepares it')}>
                  {t('prepared')}
                </span>
              )}
              {row.childId ? (
                <Check className="text-primary size-3.5 shrink-0" aria-label={t('On the map')} />
              ) : (
                <Plus className="text-subtle size-3.5 shrink-0" />
              )}
            </button>
          ))
        )}
      </div>
      {/* The move nobody has played yet. A field and a verb, at the foot
          of the list it is the exception to — the list answers "what is
          played here", this answers "and what about this". Enter submits
          it, because a one-field form that needs a press of a button to
          be a form is a form that argues with the keyboard it opened. */}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          inputSize="md"
          className="flex-1"
          value={typed}
          placeholder={t('Type a move…')}
          aria-label={t('Type a move…')}
          onChange={(e) => {
            setTyped(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="primary" size="sm" disabled={typed.trim() === ''}>
          <Plus className="size-3.5" /> {t('Add')}
        </Button>
      </form>
      {error && <p className="text-bad px-1 text-xs">{error}</p>}
    </Sheet>
  );
}
