import { useMemo } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { t } from '@/lib/i18n';
import type { NodeCoverage } from './coverage';
import type { NodeGaps } from './gaps';
import { layoutMap, NODE_H, NODE_W } from './layout';
import type { OpeningMap, ResolvedMap } from './model';

/**
 * The map itself: one content-sized SVG inside a scrolling container, so
 * panning is the browser's scrolling and costs no code. Styling leans on
 * the semantic tokens as CSS variables (the eval graph's precedent) and
 * the whole thing stays hand-rolled — a node is a rect, an edge is a
 * bezier, and the layout was computed by a pure function already tested.
 */

/** SVG text cannot ellipsise; cut at what fits the box. */
const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function MapCanvas({
  map,
  resolved,
  coverage,
  gaps,
  labels,
  selectedId,
  onSelect,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  coverage?: ReadonlyMap<string, NodeCoverage>;
  /** Field comparison per node id — set only while a source is chosen. */
  gaps?: ReadonlyMap<string, NodeGaps>;
  /** Opening names per node id, where the position has one of its own. */
  labels?: ReadonlyMap<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const layout = useMemo(() => layoutMap(map.root), [map.root]);
  const at = useMemo(
    () => new Map(layout.nodes.map((n) => [n.id, n])),
    [layout],
  );

  // The selected node's line back to the root, edges included.
  const lineage = useMemo(() => {
    const ids = new Set<string>();
    let cursor = selectedId;
    while (cursor) {
      ids.add(cursor);
      cursor = resolved.nodes.get(cursor)?.parentId ?? null;
    }
    return ids;
  }, [selectedId, resolved]);

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="block"
      role="tree"
      aria-label={t('Opening map')}
    >
      {layout.edges.map(({ from, to }) => {
        const a = at.get(from)!;
        const b = at.get(to)!;
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const mx = (x1 + x2) / 2;
        const lit = lineage.has(from) && lineage.has(to);
        return (
          <path
            key={`${from}-${to}`}
            d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={lit ? 'var(--color-primary)' : 'var(--color-line)'}
            strokeWidth={lit ? 2 : 1.5}
          />
        );
      })}
      {layout.nodes.map(({ id, x, y }) => {
        const facts = resolved.nodes.get(id)!;
        const node = facts.mapNode;
        const isRoot = facts.parentId === null;
        const selected = id === selectedId;
        const invalid = !isRoot && facts.fen === null;
        const cov = coverage?.get(id);
        // A node no study covers is a plan, and draws as an outline.
        const planned = !isRoot && !invalid && coverage !== undefined && !cov?.covered;
        const move = isRoot ? t('Start') : `${moveNumberLabel(facts.ply)} ${node.san ?? ''}`;
        const caption = invalid
          ? t('Not a legal move here')
          : (node.name ?? labels?.get(id) ?? '');
        const detail =
          cov?.covered && cov.preparedPlies > 0
            ? t('{plies} plies · {lines} lines', {
                plies: cov.preparedPlies,
                lines: cov.lineCount,
              })
            : '';
        const noteTags = (node.tags ?? []).some((tag) => tag.kind === 'note');
        const gapCount = gaps?.get(id)?.gaps.length ?? 0;
        return (
          <g key={id} className="cursor-pointer" onClick={() => onSelect(id)}>
            {/* The finger's target: well past the visible box. */}
            <rect x={x - 8} y={y - 8} width={NODE_W + 16} height={NODE_H + 16} fill="transparent" />
            <rect
              x={x}
              y={y}
              width={NODE_W}
              height={NODE_H}
              rx={9}
              fill="var(--color-surface)"
              stroke={selected ? 'var(--color-primary)' : invalid ? 'var(--color-bad)' : 'var(--color-line)'}
              strokeWidth={selected ? 2 : 1.5}
              strokeDasharray={planned || invalid ? '4 3' : undefined}
            />
            <text
              x={x + 10}
              y={y + (caption || detail ? 17 : 24)}
              fontSize={12}
              fontWeight={600}
              fill={invalid ? 'var(--color-bad)' : planned ? 'var(--color-muted)' : 'var(--color-fg)'}
            >
              {clip(move, 18)}
            </text>
            {(caption || detail) && (
              <text x={x + 10} y={y + 31} fontSize={9.5} fill="var(--color-subtle)">
                {clip(caption || detail, 26)}
              </text>
            )}
            {noteTags && <circle cx={x + NODE_W - 10} cy={y + 10} r={3} fill="var(--color-primary)" />}
            {gapCount > 0 && (
              <>
                {/* Popular replies the map has nothing against — the count
                    sits half off the box, a warning tag rather than décor. */}
                <circle cx={x + NODE_W} cy={y + NODE_H - 4} r={8} fill="var(--color-warn)" />
                <text
                  x={x + NODE_W}
                  y={y + NODE_H - 1}
                  fontSize={9.5}
                  fontWeight={700}
                  textAnchor="middle"
                  fill="var(--color-warn-fg)"
                >
                  {gapCount}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
