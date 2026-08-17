import { Check, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { FieldMove } from '@/repertoire/field';
import { Button } from '@/ui/Button';
import { ClearableInput } from '@/ui/Input';
import { MiniBoard } from '@/ui/MiniBoard';
import { Sheet } from '@/ui/Sheet';
import type { NodeCoverage } from './coverage';
import { LIST, MoveCell, MoveResult, ROW, RowTail } from './FieldRow';
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
  /** The result split, for the same bar the panel's table draws. */
  split: Pick<FieldMove, 'w' | 'd' | 'b'> | null;
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
        split: move,
        prepared: prepared.has(move.san),
        childId: children.get(move.san) ?? null,
      });
    }
    // What the studies prepare and the map charts belongs on the list
    // even when the field never plays it — that is YOUR move.
    for (const san of prepared) {
      if (!seen.has(san)) {
        seen.add(san);
        out.push({ san, share: null, split: null, prepared: true, childId: children.get(san) ?? null });
      }
    }
    for (const [san, id] of children) {
      if (!seen.has(san)) out.push({ san, share: null, split: null, prepared: false, childId: id });
    }
    return out;
  }, [field, coverage, facts.mapNode.children]);

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
      {/* No row gap, because the rows are striped: a stripe with air
          around it is a row of pills, and what makes a zebra readable is
          that the bands meet. The panel's table is the same. */}
      <div className={cn(LIST, 'min-h-0 grow content-start overflow-y-auto sm:max-h-72')}>
        {field === null ? null : rows.length === 0 ? (
          <p className="text-muted col-span-3 px-2 py-4 text-center text-xs">
            {t('Nothing to offer — type the move instead.')}
          </p>
        ) : (
          rows.map((row, at) => (
            <button
              key={row.san}
              type="button"
              onClick={() => {
                if (row.childId) onSelectChild(row.childId);
                else onAdd(row.san);
                onClose();
              }}
              // `group` for the same reason the panel's move button has
              // one: a charted move lights as a link from anywhere on
              // the row.
              className={cn(
                ROW,
                'hover:bg-surface-2 group rounded-lg px-2 py-1.5 text-left',
                at % 2 === 1 && 'bg-surface-2/50',
              )}
            >
              {/* The panel's own row, part for part — see FieldRow. A
                  charted move is a link here too: pressing it goes to
                  that node instead of charting anything. */}
              <MoveCell
                ply={facts.ply + 1}
                san={row.san}
                prepared={row.prepared}
                linked={row.childId !== null}
              />
              <MoveResult move={row.split} />
              <RowTail share={row.share}>
                {/* A tick where the move is already on the map, and
                    nothing where it is not. The plus that used to sit
                    there was decoration: the whole row charts the move,
                    so a mark saying "this one adds" on every row said it
                    of the row you press to jump to a node as well. */}
                {row.childId && (
                  <Check className="text-primary size-3.5 shrink-0" aria-label={t('On the map')} />
                )}
              </RowTail>
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
        className={cn(
          'border-line bg-surface sticky z-10 mt-auto flex items-center gap-2 border-t',
          '-mx-3 px-3 pt-2',
          // Pinned to the foot of the sheet, over its padding, the way
          // the panel's action row is — and for a sharper reason: the
          // keyboard this field opens takes half the screen, the sheet
          // gives way to the band that is left, and a field sitting at
          // the end of a list of forty replies is then somewhere above
          // the fold. It is the thing being typed into; it does not
          // scroll. The phone keeps the safe area as padding rather than
          // bleeding across it.
          'max-sm:bottom-[calc(-1.25rem-var(--safe-b))] max-sm:-mb-[calc(1.25rem+var(--safe-b))]',
          'max-sm:pb-[calc(0.5rem+var(--safe-b))]',
          'sm:bottom-[-0.75rem] sm:-mb-3 sm:pb-2',
        )}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <ClearableInput
          inputSize="md"
          className="flex-1"
          value={typed}
          placeholder={t('Type a move…')}
          aria-label={t('Type a move…')}
          // The list is what this sheet is for; this box is what it
          // falls back to. Without the marker it is the window's only
          // input, and a phone opened the sheet with the keyboard
          // already over the rows — see dialogFocus.
          data-fallback-field
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
