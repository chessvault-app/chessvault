import { Grid3x3, MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { parseFen } from 'chessops/fen';
import { addSan, createTree, moveNumberLabel } from '@shared/tree';
import { hashSetup } from '@shared/zobrist';
import { api } from '@/lib/api';
import { navigate } from '@/lib/router';
import { t } from '@/lib/i18n';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';
import { Skeleton } from '@/ui/Skeleton';
import { collectPreparedFens, collectStudyTags } from './coverage';
import type { OpeningMap, ResolvedMap } from './model';
import { scopedEntries } from './useCoverage';

/**
 * Which of your games left the map's prepared ground, and where.
 *
 * The prepared set — charted nodes plus everything the tagged studies
 * hold — is hashed with the book scheme and handed to the games index,
 * which walks each recent game of the map's colour and names the first
 * move that stepped outside. Grouped by the position it happened in,
 * because that is the actionable unit: five games leaving at the same
 * node is one hole, not five incidents.
 */

interface Deviation {
  file: string;
  idx: number;
  white: string;
  black: string;
  result: string;
  date: string | null;
  ply: number;
  sans: string[];
  key: string;
  userDeviated: boolean;
}

const line = (sans: string[]): string =>
  sans.map((san, at) => (at % 2 === 0 ? `${at / 2 + 1}. ${san}` : san)).join(' ');

export function DeviationsSheet({
  map,
  resolved,
  onShowNode,
  onClose,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  onShowNode: (id: string) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; all: Deviation[] }>(
    { loading: true, error: null, all: [] },
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      const chapters = scopedEntries(collectStudyTags(map)).map((e) => e.chapter);
      const keys = [...collectPreparedFens(resolved, chapters)].flatMap((fen) => {
        const setup = parseFen(fen);
        return setup.isErr ? [] : [hashSetup(setup.value).toString(16)];
      });
      try {
        const body = await api<{ deviations: Deviation[] }>('/api/mygames/deviations', {
          method: 'POST',
          json: { keys, side: map.color, limit: 300 },
        });
        if (live) setState({ loading: false, error: null, all: body.deviations });
      } catch {
        if (live) {
          setState({ loading: false, error: t('The games index is not answering.'), all: [] });
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [map, resolved]);

  // The map node standing on each position, for the jump back.
  const nodeByKey = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, facts] of resolved.nodes) {
      if (!facts.fen) continue;
      const setup = parseFen(facts.fen);
      if (!setup.isErr) out.set(hashSetup(setup.value).toString(16), id);
    }
    return out;
  }, [resolved]);

  const groups = useMemo(() => {
    const byKey = new Map<string, Deviation[]>();
    for (const d of state.all) {
      const arr = byKey.get(d.key) ?? [];
      arr.push(d);
      byKey.set(d.key, arr);
    }
    return [...byKey.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [state.all]);

  const analyse = (d: Deviation): void => {
    let tree = createTree();
    let tip = tree.rootId;
    for (const san of d.sans) {
      const added = addSan(tree, tip, san);
      if (!added) break;
      tree = added.tree;
      tip = added.nodeId;
    }
    useAnalysis.setState({
      tree,
      cursorId: tip,
      orientation: map.color,
      gameHeaders: null,
      handoff: true,
    });
    navigate('analysis');
  };

  return (
    <Sheet label={t('Games that left the book')} onClose={onClose}>
      {state.loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : state.error ? (
        <p className="text-muted text-xs leading-relaxed">{state.error}</p>
      ) : state.all.length === 0 ? (
        <p className="text-muted text-xs leading-relaxed">
          {t('None of your recent games left the prepared ground — or none reached it.')}
        </p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
          <p className="text-muted text-xs">
            {t('{n} recent games left the book, at {m} positions.', {
              n: state.all.length,
              m: groups.length,
            })}
          </p>
          {groups.map(([key, entries]) => {
            const first = entries[0]!;
            const at = first.ply;
            const nodeId = nodeByKey.get(key);
            const yours = entries.filter((d) => d.userDeviated).length;
            // The moves that left, tallied.
            const moves = new Map<string, number>();
            for (const d of entries) {
              const san = d.sans[d.ply]!;
              moves.set(san, (moves.get(san) ?? 0) + 1);
            }
            return (
              <div key={key} className="border-line flex flex-col gap-1.5 rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <p className="text-fg min-w-0 flex-1 truncate text-xs font-semibold">
                    {at === 0 ? t('Start position') : line(first.sans.slice(0, at))}
                  </p>
                  {nodeId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onShowNode(nodeId);
                        onClose();
                      }}
                    >
                      <MapPin className="size-3.5" /> {t('Show on the map')}
                    </Button>
                  )}
                </div>
                <p className="text-muted text-xs">
                  {[...moves.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(
                      ([san, n]) =>
                        `${moveNumberLabel(at + 1)} ${san} ×${n}`,
                    )
                    .join(' · ')}
                  {yours > 0 && (
                    <span className="text-warn"> · {t('{n} by you', { n: yours })}</span>
                  )}
                </p>
                <div className="flex flex-col gap-1">
                  {entries.slice(0, 3).map((d) => (
                    <div key={`${d.file}#${d.idx}`} className="flex items-center gap-2">
                      <span className="text-fg min-w-0 flex-1 truncate text-xs">
                        {d.white} – {d.black}
                      </span>
                      <span className="text-subtle shrink-0 text-xs">
                        {d.result}
                        {d.date ? ` · ${d.date}` : ''}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('Analyse to the deviation')}
                        onClick={() => analyse(d)}
                      >
                        <Grid3x3 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                  {entries.length > 3 && (
                    <p className="text-subtle text-xs">
                      {t('and {n} more', { n: entries.length - 3 })}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
