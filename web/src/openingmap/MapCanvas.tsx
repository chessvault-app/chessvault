import { useEffect, useMemo, useRef, useState } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { t } from '@/lib/i18n';
import { reachedMove, type NodeCoverage } from './coverage';
import type { NodeGaps } from './gaps';
import { layoutGraph } from './graph';
import type { OpeningMap, ResolvedMap } from './model';

/**
 * The map as a graph view — dots, springs and labels, the way the
 * vault's Obsidian ancestry draws a constellation of notes. The layout
 * is a deterministic force relaxation (graph.ts); this component only
 * renders it and owns the viewport: wheel zoom to the cursor, drag to
 * pan, two pointers to pinch. Everything is one SVG group under one
 * transform, so the viewport is three numbers and no scrolling machinery.
 */

/** SVG text cannot ellipsise; cut at what fits under a dot. */
const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

interface View {
  x: number;
  y: number;
  k: number;
}

export function MapCanvas({
  map,
  resolved,
  coverage,
  gaps,
  shares,
  labels,
  selectedId,
  onSelect,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  coverage?: ReadonlyMap<string, NodeCoverage>;
  /** Field comparison per node id — set only while a source is chosen. */
  gaps?: ReadonlyMap<string, NodeGaps>;
  /** How often each node's move gets played at its parent, 0..1. */
  shares?: ReadonlyMap<string, number>;
  /** Opening names per node id, where the position has one of its own. */
  labels?: ReadonlyMap<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const graph = useMemo(() => layoutGraph(map.root), [map.root]);
  const at = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const host = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });

  // The load overture: dots scatter at RANDOM and fall into place — real
  // repulsion keeps the tumble organic while a strengthening anchor pull
  // lands every dot exactly on the deterministic layout. The journey is
  // different on every load; the destination never is, because the map's
  // shape is a thing people remember. Skipped for reduced motion.
  const [anim, setAnim] = useState<ReadonlyMap<string, { x: number; y: number }> | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || graph.nodes.length < 2) {
      setAnim(null);
      return;
    }
    const spread = Math.max(graph.maxX - graph.minX, graph.maxY - graph.minY) * 0.6;
    const cx = (graph.minX + graph.maxX) / 2;
    const cy = (graph.minY + graph.maxY) / 2;
    const bodies = graph.nodes.map((n) => {
      const angle = Math.random() * 2 * Math.PI;
      const radius = spread * Math.sqrt(Math.random());
      return { id: n.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
    const TOTAL = 21;
    let t = 0;
    let frame = 0;
    const tick = (): void => {
      t += 1;
      const progress = Math.min(1, t / TOTAL);
      const ease = progress * progress * (3 - 2 * progress);
      // Repulsion fades as the anchors take over — chaos first, order last.
      const k = 70 * (1 - ease);
      if (k > 1) {
        for (let a = 0; a < bodies.length; a += 1) {
          for (let b = a + 1; b < bodies.length; b += 1) {
            let dx = bodies[a]!.x - bodies[b]!.x;
            let dy = bodies[a]!.y - bodies[b]!.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              dx = 1;
              dy = 0.5;
              d2 = 1.25;
            }
            const push = Math.min(12, (k * k) / d2);
            const d = Math.sqrt(d2);
            bodies[a]!.x += (dx / d) * push;
            bodies[a]!.y += (dy / d) * push;
            bodies[b]!.x -= (dx / d) * push;
            bodies[b]!.y -= (dy / d) * push;
          }
        }
      }
      const pull = 0.09 + 0.5 * ease * ease;
      for (const body of bodies) {
        const home = at.get(body.id)!;
        body.x += (home.x - body.x) * pull;
        body.y += (home.y - body.y) * pull;
      }
      if (t >= TOTAL) {
        setAnim(null);
        return;
      }
      setAnim(new Map(bodies.map((b) => [b.id, { x: b.x, y: b.y }])));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setAnim(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.root]);

  // Where a node was dragged to, screen-session only: the map's stored
  // shape stays the deterministic layout, a drag is the reader arranging
  // their desk. Pinned wins over both the animation and the layout.
  const [pins, setPins] = useState<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  useEffect(() => setPins(new Map()), [map.id]);
  const posOf = (id: string): { x: number; y: number } =>
    pins.get(id) ?? anim?.get(id) ?? at.get(id)!;

  const nodeDrag = useRef<{
    id: string;
    pointerId: number;
    fromX: number;
    fromY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  // Fit the constellation on first light and when the map's node count
  // changes shape enough to matter (a new node nudges, so refit only on
  // count — a fit on every edit would yank the viewport while working).
  const nodeCount = graph.nodes.length;
  useEffect(() => {
    const box = host.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const w = graph.maxX - graph.minX;
    const h = graph.maxY - graph.minY;
    const k = Math.min(2, 0.92 * Math.min(box.width / w, box.height / h));
    setView({
      x: box.width / 2 - ((graph.minX + graph.maxX) / 2) * k,
      y: box.height / 2 - ((graph.minY + graph.maxY) / 2) * k,
      k,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount, map.id]);

  // Pointers on the ground: one drags, two pinch. Node clicks stop
  // propagation, so reaching here means the ground was grabbed.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);

  const onPointerDown = (e: React.PointerEvent): void => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
  };
  const onPointerMove = (e: React.PointerEvent): void => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    const now = { x: e.clientX, y: e.clientY };
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId);
    if (others.length === 0) {
      setView((v) => ({ ...v, x: v.x + now.x - before.x, y: v.y + now.y - before.y }));
    } else {
      // Pinch: scale by the distance ratio, anchored on the midpoint.
      const anchor = others[0]![1];
      const d0 = Math.hypot(before.x - anchor.x, before.y - anchor.y) || 1;
      const d1 = Math.hypot(now.x - anchor.x, now.y - anchor.y) || 1;
      const box = host.current!.getBoundingClientRect();
      const mx = (now.x + anchor.x) / 2 - box.left;
      const my = (now.y + anchor.y) / 2 - box.top;
      setView((v) => {
        const k = Math.min(3, Math.max(0.2, (v.k * d1) / d0));
        const scale = k / v.k;
        return { k, x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale };
      });
    }
    pointers.current.set(e.pointerId, now);
    moved.current = true;
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
  };
  const onWheel = (e: React.WheelEvent): void => {
    const box = host.current!.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    setView((v) => {
      const k = Math.min(3, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.0016)));
      const scale = k / v.k;
      return { k, x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale };
    });
  };

  // Labels and badges keep their SCREEN size — dividing by the zoom is
  // what makes them readable at any distance — and the labels fade out
  // as the view pulls back, the graph-view convention: far out you read
  // the shape, close in you read the names.
  const inv = 1 / view.k;
  // Fully readable by the time the whole map fits a laptop panel
  // (k ≈ 0.35 on a mid-size map); gone only when truly far out.
  const labelOpacity = Math.max(0, Math.min(1, (view.k - 0.15) / 0.2));

  // The mainlines: at every node, the edge to its most-played child.
  // Following them from the root traces THE mainline; every sideline
  // carries its own local one deeper in. Data-driven only — with no
  // field source there is no "most played" to claim.
  const mainline = useMemo(() => {
    const out = new Set<string>();
    if (!shares) return out;
    for (const [id, facts] of resolved.nodes) {
      let best: string | null = null;
      let bestShare = 0;
      for (const child of facts.mapNode.children) {
        const share = shares.get(child.id) ?? 0;
        if (share > bestShare) {
          bestShare = share;
          best = child.id;
        }
      }
      if (best) out.add(`${id}-${best}`);
    }
    return out;
  }, [resolved, shares]);

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
    <div
      ref={host}
      className="h-full w-full cursor-grab touch-none overflow-hidden active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <svg width="100%" height="100%" className="block" role="tree" aria-label={t('Opening map')}>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map(({ from, to }) => {
            const a = posOf(from);
            const b = posOf(to);
            const lit = lineage.has(from) && lineage.has(to);
            const main = mainline.has(`${from}-${to}`);
            return (
              <line
                key={`${from}-${to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  lit ? 'var(--color-primary)' : main ? 'var(--color-line-strong)' : 'var(--color-line)'
                }
                strokeWidth={(lit ? 2 : main ? 2.4 : 1.2) / view.k}
              />
            );
          })}
          {graph.nodes.map(({ id, r: structural }) => {
            const { x, y } = posOf(id);
            // Frequency scales the DRAWN dot, never the layout: a move
            // played in most games grows, a rarity shrinks, and sizes
            // breathe as field data lands without the physics
            // reshuffling the picture.
            const share = shares?.get(id);
            const r =
              share === undefined
                ? structural
                : Math.max(4, structural * (0.72 + 0.9 * Math.sqrt(share)));
            const facts = resolved.nodes.get(id)!;
            const node = facts.mapNode;
            const isRoot = facts.parentId === null;
            const selected = id === selectedId;
            const invalid = !isRoot && facts.fen === null;
            const cov = coverage?.get(id);
            // A node no study covers is a plan, and draws hollow.
            const planned = !isRoot && !invalid && coverage !== undefined && !cov?.covered;
            const move = isRoot ? t('Start') : `${moveNumberLabel(facts.ply)} ${node.san ?? ''}`;
            const caption = invalid
              ? t('Not a legal move here')
              : (node.name ?? labels?.get(id) ?? '');
            const gapCount = gaps?.get(id)?.gaps.length ?? 0;
            const noteTags = (node.tags ?? []).some((tag) => tag.kind === 'note');
            const target = node.depth;
            const reach =
              target !== undefined && cov ? reachedMove(facts.ply, cov.preparedPlies) : undefined;
            const ring = 2 * Math.PI * (r + 3);
            return (
              <g
                key={id}
                className="cursor-pointer"
                onClick={() => {
                  if (!moved.current && !nodeDrag.current?.moved) onSelect(id);
                  nodeDrag.current = null;
                }}
                onPointerDown={(e) => {
                  // A node grab is a drag, not a pan: capture the pointer
                  // here and the ground never hears about it.
                  e.stopPropagation();
                  moved.current = false;
                  try {
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  } catch {
                    // A capture that fails only costs pointerup routing.
                  }
                  const from = posOf(id);
                  nodeDrag.current = {
                    id,
                    pointerId: e.pointerId,
                    fromX: e.clientX,
                    fromY: e.clientY,
                    origX: from.x,
                    origY: from.y,
                    moved: false,
                  };
                }}
                onPointerMove={(e) => {
                  const drag = nodeDrag.current;
                  if (!drag || drag.id !== id || drag.pointerId !== e.pointerId) return;
                  const dx = e.clientX - drag.fromX;
                  const dy = e.clientY - drag.fromY;
                  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
                  drag.moved = true;
                  setPins((prev) => {
                    const next = new Map(prev);
                    next.set(id, { x: drag.origX + dx / view.k, y: drag.origY + dy / view.k });
                    return next;
                  });
                }}
                onPointerUp={(e) => {
                  try {
                    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                  } catch {
                    // Never captured — nothing to release.
                  }
                }}
                onPointerCancel={() => {
                  nodeDrag.current = null;
                }}
              >
                <circle cx={x} cy={y} r={r + 10} fill="transparent" />
                <circle
                  cx={x}
                  cy={y}
                  r={r}
                  fill={
                    invalid
                      ? 'var(--color-bad)'
                      : isRoot
                        ? 'var(--color-fg)'
                        : planned
                          ? 'var(--color-surface-3)'
                          : 'var(--color-primary)'
                  }
                  fillOpacity={planned ? 0.6 : 0.9}
                  stroke={
                    selected
                      ? 'var(--color-fg)'
                      : planned
                        ? 'var(--color-muted)'
                        : 'transparent'
                  }
                  strokeWidth={selected ? 2 : 1.2}
                  strokeDasharray={planned && !selected ? '3 3' : undefined}
                />
                {/* Depth progress as an arc around the dot: how far the
                    preparation runs toward the intended move. */}
                {target !== undefined && reach !== undefined && (
                  <circle
                    cx={x}
                    cy={y}
                    r={r + 3}
                    fill="none"
                    stroke={reach < target ? 'var(--color-warn)' : 'var(--color-good)'}
                    strokeWidth={1.6}
                    strokeDasharray={`${ring * Math.min(1, reach / Math.max(1, target))} ${ring}`}
                    transform={`rotate(-90 ${x} ${y})`}
                  />
                )}
                {(cov?.reviewCount ?? 0) > 0 && (
                  <circle cx={x - r * 0.8} cy={y - r * 0.8} r={3 * inv} fill="var(--color-warn)" />
                )}
                {(cov?.gapCount ?? 0) > 0 && (
                  <circle cx={x - r * 0.8} cy={y + r * 0.8} r={3 * inv} fill="var(--color-bad)" />
                )}
                {noteTags && (
                  <circle cx={x + r * 0.8} cy={y - r * 0.8} r={3 * inv} fill="var(--color-primary)" />
                )}
                {gapCount > 0 && (
                  <>
                    <circle cx={x + r + 7 * inv} cy={y} r={7.5 * inv} fill="var(--color-warn)" />
                    <text
                      x={x + r + 7 * inv}
                      y={y + 3 * inv}
                      fontSize={9.5 * inv}
                      fontWeight={700}
                      textAnchor="middle"
                      fill="var(--color-warn-fg)"
                    >
                      {gapCount}
                    </text>
                  </>
                )}
                <text
                  x={x}
                  y={y + r + 12 * inv}
                  fontSize={10.5 * inv}
                  fontWeight={600}
                  textAnchor="middle"
                  opacity={labelOpacity}
                  fill={invalid ? 'var(--color-bad)' : 'var(--color-fg)'}
                >
                  {clip(move, 16)}
                </text>
                {caption && (
                  <text
                    x={x}
                    y={y + r + 22 * inv}
                    fontSize={8 * inv}
                    textAnchor="middle"
                    opacity={labelOpacity}
                    fill="var(--color-subtle)"
                  >
                    {clip(caption, 26)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
