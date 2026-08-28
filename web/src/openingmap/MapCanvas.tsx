import { useEffect, useMemo, useRef, useState } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { useMediaQuery } from '@/lib/media';
import { t } from '@/lib/i18n';
import { openingFamily } from '@/repertoire/drill';
import { reachedMove, type NodeCoverage } from './coverage';
import type { NodeGaps } from './gaps';
import { createLiveSim, layoutGraph, layoutTree, PAD, type LiveSim } from './graph';
import { favouriteChild } from './mainline';
import { lineOnly, type OpeningMap, type ResolvedMap } from './model';

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

/** How long a finger must rest on a dot before it moves the dot rather
    than the map. Long enough not to fire while panning, short enough to
    feel deliberate rather than broken. */
const HOLD_MS = 350;
/** How far a finger may wander while holding before it counts as a pan
    instead. A press never lands on one pixel and never stays on it. */
const HOLD_SLOP = 10;
/**
 * How far past the dot's edge the held ring is drawn, in SCREEN pixels —
 * divided by the zoom so it is that far out at any scale.
 *
 * It was 7 world units, which is under the fingertip that is holding the
 * dot: an indicator you cannot see because your own hand is on top of it
 * indicates nothing. A finger covers roughly 40px across, so the ring has
 * to clear that to be read at all, and it is paired with a faint fill so
 * the part that does show reads as one shape rather than a stray arc.
 */
const HELD_RING = 26;

/**
 * One focused line wears the grammar's blue, NOT --color-primary: the
 * lineage back to the root is drawn in the foreground colour, and in any
 * theme whose primary is near-white — the neutral default's dark mode is
 * one — the two lines came out identical. Info is the one blue every
 * theme keeps (the tint multiplier skips it), and "where the field goes
 * next" is the informational statement that blue exists to make.
 */
const ACCENT = 'var(--color-info)';
/**
 * Above this many highlighted LINES, separate hues stop separating
 * anything and every line goes back to the accent. Counted in lines
 * drawn, not search hits: a family search matches most of a subtree, and
 * nearly all of those hits stand on one another's lines.
 *
 * Twelve, which is 30 degrees apart. It was eight, and searching "Ruy"
 * over six variations produced exactly eight lines — right on the edge,
 * where one more variation in a real repertoire would have tipped the
 * whole search back to a single accent and looked like the bug that
 * started this. A family is the unit people search by, so the ceiling
 * has to sit above the biggest family rather than at it.
 */
const HUES = 12;

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
  matches,
  selectedId,
  focus,
  arrangement = 'constellation',
  only = null,
  align = 0,
  onSelect,
}: {
  map: OpeningMap;
  resolved: ResolvedMap;
  /**
   * How the same nodes are arranged: the force-relaxed constellation, or
   * a tidy tree of the same dots.
   */
  arrangement?: 'constellation' | 'tree';
  /**
   * Draw only the line to this node, and what follows it. Tree only: the
   * constellation is a picture of the whole shape, and a constellation of
   * one line is a row of dots.
   */
  only?: string | null;
  /** Bumped to ask for a re-fit; see the fitting effect below. */
  align?: number;
  coverage?: ReadonlyMap<string, NodeCoverage>;
  /** Field comparison per node id — set only while a source is chosen. */
  gaps?: ReadonlyMap<string, NodeGaps>;
  /** How often each node's move gets played at its parent, 0..1. */
  shares?: ReadonlyMap<string, number>;
  /** Opening names per node id, where the position has one of its own. */
  labels?: ReadonlyMap<string, string>;
  /**
   * The search's hits, or null when nothing is being searched for. A hit
   * keeps its full presence and everything else falls back, so the answer
   * is read as a shape in the constellation — where the Najdorfs sit —
   * rather than as a list that takes you somewhere and loses the map.
   */
  matches?: ReadonlySet<string> | null;
  selectedId: string | null;
  /**
   * What the lit line runs down from: every search hit, or the selection
   * alone, or nothing. Decided by the view rather than here because the
   * field sweep is asked to answer these positions FIRST — a line drawn
   * from one node and fetched for another would be the slowest thing on
   * the map instead of the fastest.
   */
  focus: readonly string[];
  /** A node id, or null for the ground — a press on dead space clears. */
  onSelect: (id: string | null) => void;
}) {
  /**
   * A tree wants its depth along the axis with room to spare: sideways on
   * a desktop window, downward on a phone held upright. The app's own
   * `stacked` rule decides which one this is, so the map agrees with every
   * other page about what a narrow screen is.
   */
  const stacked = useMediaQuery(
    '(max-width: 63.9375rem) and ((orientation: portrait) or (max-width: 43.9375rem))',
  );
  const root = useMemo(
    () => (arrangement === 'tree' && only ? lineOnly(map.root, only) : map.root),
    [map.root, arrangement, only],
  );
  const graph = useMemo(
    () => (arrangement === 'tree' ? layoutTree(root, { vertical: stacked }) : layoutGraph(root)),
    [root, arrangement, stacked],
  );
  const at = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const host = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  /**
   * The viewport twice over: state for React, a ref for the gestures.
   *
   * A pan used to setView per pointermove, and the viewport transform
   * sits on the one <g> holding the whole scene — so the commonest
   * gesture of all re-rendered and reconciled every dot and thread per
   * frame, which is exactly the cost the animation loop below was built
   * to remove. A pan now writes this ref and the <g>'s transform
   * attribute directly, and React hears about it once, on release. Zoom
   * stays on state because it legitimately changes per-node values (inv,
   * labelOpacity) — but it READS the ref, so a wheel or a pinch lands on
   * top of the pans React was never told about.
   */
  const viewRef = useRef(view);
  /** The scene's <g>, for the pan path's direct transform writes. */
  const scene = useRef<SVGGElement | null>(null);
  /** Every viewport change goes through here, so ref and state agree. */
  const commitView = (v: View): void => {
    viewRef.current = v;
    setView(v);
  };

  // The moving parts, addressed directly: the animation loop below writes
  // positions straight onto these elements, so a frame of motion costs
  // attribute writes rather than a React render of the whole scene.
  const nodeEls = useRef(new Map<string, SVGGElement>());
  const haloEls = useRef(new Map<string, SVGCircleElement>());
  const edgeEls = useRef(new Map<string, { el: SVGLineElement; from: string; to: string }>());
  /** Where every dot is DRAWN right now, animation included — what a
      gesture must read, or a picked-up dot would jump to its home. */
  const currentPos = useRef(new Map<string, { x: number; y: number }>());

  // The load overture: dots scatter at RANDOM and fall into place — real
  // repulsion keeps the tumble organic while a strengthening anchor pull
  // lands every dot exactly on the deterministic layout. The journey is
  // different on every load; the destination never is, because the map's
  // shape is a thing people remember. Skipped for reduced motion.
  //
  // The overture belongs to ARRIVING (a fresh mount, a colour switch);
  // an edit only nudges the layout, so charting a move glides the dots
  // from where they were to where they go — replaying the scatter on
  // every added node yanked the picture out from under the person
  // building it. New nodes grow out of their parent's old place.
  //
  // This effect only STAGES the bodies; the animation loop advances them.
  const overture = useRef<{
    bodies: { id: string; x: number; y: number }[];
    t: number;
    total: number;
  } | null>(null);
  const settledRef = useRef<{ mapId: string; pos: Map<string, { x: number; y: number }> } | null>(
    null,
  );
  useEffect(() => {
    const before = settledRef.current;
    const finals = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    settledRef.current = { mapId: map.id, pos: finals };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || graph.nodes.length < 2) {
      overture.current = null;
      return;
    }
    const arriving = !before || before.mapId !== map.id;
    const spread = Math.max(graph.maxX - graph.minX, graph.maxY - graph.minY) * 0.45;
    const cx = (graph.minX + graph.maxX) / 2;
    const cy = (graph.minY + graph.maxY) / 2;
    const bodies = graph.nodes.map((n) => {
      if (!arriving) {
        // Glide: start where the node last stood, or where its parent
        // stood for a node that did not exist a moment ago.
        const prev =
          before!.pos.get(n.id) ?? before!.pos.get(resolved.nodes.get(n.id)?.parentId ?? '');
        return { id: n.id, x: prev?.x ?? n.x, y: prev?.y ?? n.y };
      }
      const angle = Math.random() * 2 * Math.PI;
      const radius = spread * Math.sqrt(Math.random());
      return { id: n.id, x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
    });
    overture.current = { bodies, t: 0, total: arriving ? 13 : 9 };
    return () => {
      overture.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.root]);

  /**
   * The settled map still breathes: every dot wanders a few units around
   * its home on slow layered sines, phases hashed from the id so nothing
   * moves in sync. Edges and labels read the same positions, so the whole
   * constellation floats rather than the dots slipping off their threads.
   * Off for reduced motion; paused by the browser with the tab.
   */
  const phases = useMemo(() => {
    const out = new Map<string, { a: number; w1: number; w2: number; p1: number; p2: number }>();
    for (const node of graph.nodes) {
      let h = 2166136261;
      for (const ch of node.id) h = (h ^ ch.charCodeAt(0)) * 16777619;
      h = Math.abs(h);
      out.set(node.id, {
        // Visible at a glance: a handful of world units on a 4–8 second
        // stroll. The first cut of this was 1–2 screen pixels over
        // 9–25 s — measurably moving, perceptibly frozen.
        a: 5 + (h % 5) * 1.1,
        w1: 0.8 + ((h >> 3) % 7) * 0.09,
        w2: 1.1 + ((h >> 6) % 5) * 0.12,
        p1: (h % 628) / 100,
        p2: ((h >> 4) % 628) / 100,
      });
    }
    return out;
  }, [graph]);

  // Where the constellation currently stands after somebody has pulled on
  // it, screen-session only: the map's STORED shape is always the
  // deterministic layout, and a drag is the reader arranging their desk.
  const [live, setLive] = useState<ReadonlyMap<string, { x: number; y: number }> | null>(null);
  /** The loop reads the base through a ref, so it sees what the last
      render committed without being torn down per render. */
  const liveRef = useRef(live);
  liveRef.current = live;
  const sim = useRef<LiveSim | null>(null);
  useEffect(() => {
    // The ref too, synchronously: the fit effect below runs in this same
    // commit and reads liveRef — left to the setLive re-render, a switch
    // of arrangement would fit the OLD desk instead of the new layout.
    liveRef.current = null;
    setLive(null);
    sim.current = null;
    // An arrangement is a different desk. The tree cannot honour dragged
    // positions (drags are off there), and drawing it at them was the
    // switcher visibly doing nothing after any drag had committed.
  }, [map.id, arrangement]);
  /** The BASE position — what React renders the scene at. */
  const posOf = (id: string): { x: number; y: number } => live?.get(id) ?? at.get(id)!;
  /** The DRAWN position — base plus whatever the loop has done this
      frame. Gestures start from the picture on screen, not the base. */
  const posNow = (id: string): { x: number; y: number } => currentPos.current.get(id) ?? posOf(id);

  /**
   * The one animation loop, and the reason the map can afford to move at
   * any size now.
   *
   * The overture, the idle drift and the drag physics all used to move
   * dots by setting React state per frame, so every frame reconciled the
   * whole scene — roughly eight SVG elements per dot, over three thousand
   * on a big map, sixty times a second. That is why maps above 160 nodes
   * were frozen solid (the old CALM_ABOVE cap): the cost was React
   * reconciliation, not the motion itself. React now renders the scene
   * ONCE at base positions and this loop writes the moving parts straight
   * onto the DOM — one transform per dot, endpoints per thread — so a
   * frame is plain attribute writes. A render that lands mid-motion
   * (an answer arriving, a selection) briefly paints the base and the
   * next frame writes over it.
   *
   * One loop owns all three motions so they cannot fight over a dot:
   * the overture while it lasts, then the drag simulation while the web
   * is being pulled, else the idle drift. Off entirely for reduced
   * motion — the drag's reduced behaviour moves one dot through React
   * state, which is exactly as much motion as that setting asks for.
   */
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    // Set on the frame that has nothing left to animate, so the loop can
    // stop instead of running forever over a picture that is not moving.
    let still = false;
    // Read once, here: the ref holds the same Map for the component's life
    // (it is never reassigned), and the cleanup below must clear THAT Map
    // rather than whatever the ref happens to point at when it runs.
    const pos = currentPos.current;
    const step = (now: number): void => {
      frame = requestAnimationFrame(step);
      const time = now / 1000;
      pos.clear();
      const o = overture.current;
      if (o) {
        o.t += 1;
        const progress = Math.min(1, o.t / o.total);
        const ease = progress * progress * (3 - 2 * progress);
        // Repulsion fades as the anchors take over — chaos first, order
        // last.
        const k = 70 * (1 - ease);
        const bodies = o.bodies;
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
        const pull = 0.16 + 0.55 * ease * ease;
        for (const body of bodies) {
          const home = at.get(body.id)!;
          body.x += (home.x - body.x) * pull;
          body.y += (home.y - body.y) * pull;
          pos.set(body.id, { x: body.x, y: body.y });
        }
        if (o.t >= o.total) overture.current = null;
      } else if (sim.current) {
        const moving = sim.current.step();
        for (const [id, p] of sim.current.positions()) pos.set(id, p);
        if (!moving) {
          // Coasted to a stop: commit where everything landed as the new
          // base, once, and hand the dots back to the drift.
          setLive(sim.current.positions());
          sim.current = null;
        }
      } else if (arrangement === 'tree') {
        /**
         * A tree does not breathe.
         *
         * The constellation drifts because it is a picture of a shape,
         * and a shape reads the same whichever few units a dot happens to
         * be at. A tree is a statement about ORDER: the eye runs down the
         * line from a parent to its children, and rows that wander make a
         * straight line wander with them — the one property the
         * arrangement exists to show.
         *
         * This is also the last frame. Nothing here moves, so the loop
         * stops rather than repainting a still picture sixty times a
         * second; it starts again from the top whenever the graph
         * changes, which is what switching back does.
         */
        for (const node of graph.nodes) {
          const base = liveRef.current?.get(node.id) ?? at.get(node.id)!;
          pos.set(node.id, { x: base.x, y: base.y });
        }
        still = true;
      } else {
        for (const node of graph.nodes) {
          const base = liveRef.current?.get(node.id) ?? at.get(node.id)!;
          const p = phases.get(node.id)!;
          pos.set(node.id, {
            x: base.x + p.a * Math.sin(time * p.w1 + p.p1) + p.a * 0.5 * Math.sin(time * p.w2 + p.p2),
            y: base.y + p.a * Math.cos(time * p.w2 + p.p1) + p.a * 0.5 * Math.sin(time * p.w1 + p.p2),
          });
        }
      }
      for (const [id, el] of nodeEls.current) {
        const p = pos.get(id);
        if (p) el.setAttribute('transform', `translate(${p.x} ${p.y})`);
      }
      for (const [id, el] of haloEls.current) {
        const p = pos.get(id);
        if (p) {
          el.setAttribute('cx', String(p.x));
          el.setAttribute('cy', String(p.y));
        }
      }
      for (const { el, from, to } of edgeEls.current.values()) {
        const a = pos.get(from);
        const b = pos.get(to);
        if (!a || !b) continue;
        el.setAttribute('x1', String(a.x));
        el.setAttribute('y1', String(a.y));
        el.setAttribute('x2', String(b.x));
        el.setAttribute('y2', String(b.y));
      }
      if (still) cancelAnimationFrame(frame);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      pos.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, phases]);

  /**
   * A drag pulls the web instead of sliding one bead: the held dot goes
   * where the finger goes, its neighbours follow on their springs, and
   * crowding pushes back. The loop above keeps stepping it after the
   * release so the constellation coasts to a stop rather than freezing
   * mid-swing.
   *
   * Reduced motion gets the old behaviour — the held dot moves and
   * nothing else. A physics simulation is exactly the kind of motion that
   * setting is asking us not to run.
   */
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const grab = (id: string, at0: { x: number; y: number }): void => {
    // A tree is an arrangement with an answer, so there is nothing for a
    // drag to settle into: towing a dot would leave the picture wrong
    // until the next relayout rather than finding a new resting place the
    // way the constellation does. The map still pans and zooms.
    if (arrangement === 'tree' || calm()) return;
    const from = new Map(graph.nodes.map((n) => [n.id, posNow(n.id)]));
    from.set(id, at0);
    const running = createLiveSim(graph.nodes, graph.edges, from);
    running.pin(id, at0);
    // The loop picks it up on its next frame.
    sim.current = running;
  };
  const haul = (id: string, to: { x: number; y: number }): void => {
    if (sim.current) {
      sim.current.pin(id, to);
      return;
    }
    // Reduced motion: move the one dot, leave the rest exactly where
    // they are.
    setLive((prev) => {
      const next = new Map(prev ?? graph.nodes.map((n) => [n.id, posNow(n.id)]));
      next.set(id, to);
      return next;
    });
  };
  const letGo = (id: string): void => {
    sim.current?.pin(id, null);
  };

  /**
   * How far out the map can be pulled.
   *
   * 0.2 was a constant, and a constant cannot know how big the map is. A
   * wide tree on a phone fits at a scale well under it, so the pinch that
   * would have shown the whole thing stopped short of it — and the FIT
   * does not clamp at all, so Align could leave the map at a scale the
   * fingers were not allowed to reach back to.
   *
   * Half the scale that fits, or 0.2, whichever is smaller: a map that
   * comfortably fits keeps the floor it had, and a big one can always be
   * pulled back past all of it. The 0.02 is only there so a degenerate
   * box cannot hand out an infinite one.
   */
  const zoomFloor = (): number => {
    const box = host.current?.getBoundingClientRect();
    const w = graph.maxX - graph.minX;
    const h = graph.maxY - graph.minY;
    if (!box || box.width === 0 || w <= 0 || h <= 0) return 0.2;
    return Math.max(0.02, Math.min(0.2, 0.5 * Math.min(box.width / w, box.height / h)));
  };

  const nodeDrag = useRef<{
    id: string;
    pointerId: number;
    fromX: number;
    fromY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  /** A drag that moved must not select on the trailing click. */
  const suppressClick = useRef(false);

  /**
   * Fit the picture on first light, and again whenever it becomes a
   * different picture: a new node count, the other arrangement, or the
   * Align button asking.
   *
   * Not on every edit — a fit while you are working yanks the viewport
   * out from under you, which is why a single new node only nudges. But
   * switching arrangements moves every dot at once, and the pan and zoom
   * you had were answers to where things used to be: staying put left the
   * tree half off-screen with the middle of nowhere centred.
   */
  const nodeCount = graph.nodes.length;
  useEffect(() => {
    const box = host.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    /**
     * Fit the picture that is actually on screen, not the layout's idea
     * of it. After a drag the dots stand where the reader put them —
     * still coasting in the sim, or committed into `live` — and fitting
     * the deterministic bounds framed where they USED to be: Align
     * centred the middle of nowhere. The idle drift is a few units and
     * the overture's scatter never coexists with a same-graph refit, so
     * the two drag sources are the only ones worth reading.
     */
    const desk = sim.current?.positions() ?? liveRef.current;
    let minX = graph.minX;
    let minY = graph.minY;
    let maxX = graph.maxX;
    let maxY = graph.maxY;
    if (desk) {
      minX = Infinity;
      minY = Infinity;
      maxX = -Infinity;
      maxY = -Infinity;
      for (const n of graph.nodes) {
        const p = desk.get(n.id) ?? n;
        minX = Math.min(minX, p.x - n.r - PAD);
        minY = Math.min(minY, p.y - n.r - PAD);
        maxX = Math.max(maxX, p.x + n.r + PAD);
        maxY = Math.max(maxY, p.y + n.r + PAD);
      }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const k = Math.min(2, 0.92 * Math.min(box.width / w, box.height / h));
    commitView({
      x: box.width / 2 - ((minX + maxX) / 2) * k,
      y: box.height / 2 - ((minY + maxY) / 2) * k,
      k,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount, map.id, arrangement, align]);

  /**
   * Every pointer on the surface, wherever it landed — including on a
   * dot.
   *
   * A node press used to stop propagation, so a finger that came down on
   * a dot was invisible here. On a desktop that is harmless; on a phone
   * it made zooming nearly impossible, because a pinch only counted if
   * BOTH fingers found bare canvas and a dense map has almost none. The
   * dots are the whole picture, so "don't touch the dots" is not an
   * instruction anybody can follow.
   *
   * One pointer on a dot still drags the dot. A second pointer is never
   * a drag — it is the other half of a pinch, and what is being zoomed
   * is the map, not whatever happens to be under the fingers — so it
   * cancels the drag in progress and both fingers go to the pinch.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);

  /**
   * Which dot is currently held BY A FINGER, as STATE rather than a ref,
   * because the whole point is to draw it. A hold that arms silently is a
   * hold you cannot learn: the finger has to be told the map let go of
   * the dot and handed it over.
   *
   * A mouse is never told, because a mouse never had to ask. The ring is
   * as wide as it is to clear a fingertip (see HELD_RING), and drawn
   * around a dot nothing is covering it is a halo the size of a coin
   * following the cursor — an answer to a question a pointer device does
   * not have. On a mouse the dot moving IS the feedback: it goes where
   * the pointer goes, from the first pixel, with nothing on top of it.
   */
  const [held, setHeld] = useState<string | null>(null);

  /**
   * A finger resting on a dot, not yet long enough to have claimed it,
   * and where it came down.
   *
   * The origin is the important half. Cancelling the hold on ANY movement
   * sounds right and is not: a finger on glass jitters a pixel or two the
   * whole time it is down, so the hold was being thrown away almost every
   * time and dots could not be picked up at all. It takes real travel to
   * mean "I am panning" — `HOLD_SLOP` of it.
   */
  const holdTimer = useRef(0);
  const holdFrom = useRef<{ x: number; y: number } | null>(null);
  const cancelHold = (): void => {
    holdFrom.current = null;
    if (!holdTimer.current) return;
    clearTimeout(holdTimer.current);
    holdTimer.current = 0;
  };
  useEffect(() => cancelHold, []);

  const dropNode = (): void => {
    cancelHold();
    setHeld(null);
    const drag = nodeDrag.current;
    if (!drag) return;
    letGo(drag.id);
    nodeDrag.current = null;
    // The gesture turned out to be a pinch. Whatever click trails off
    // the end of it did not mean "select this dot".
    suppressClick.current = true;
  };

  /** Is some OTHER finger already down? Asked without counting this one,
      because the surface and the dot both handle the same event and
      whichever runs second would otherwise see the first one's book-
      keeping and think a second finger had arrived. */
  const alreadyHeld = (self: number): boolean =>
    [...pointers.current.keys()].some((id) => id !== self);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (alreadyHeld(e.pointerId)) dropNode();
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
      // A lone finger holding a dot moves the dot; the node's own
      // handler is doing that, and the map must not slide as well.
      if (nodeDrag.current) {
        pointers.current.set(e.pointerId, now);
        moved.current = true;
        return;
      }
      // A pan: the ref and the attribute, never setState — see viewRef.
      // React paints this transform again on release.
      const v = viewRef.current;
      const next = { ...v, x: v.x + now.x - before.x, y: v.y + now.y - before.y };
      viewRef.current = next;
      scene.current?.setAttribute('transform', `translate(${next.x} ${next.y}) scale(${next.k})`);
    } else {
      // Pinch: scale by the distance ratio, anchored on the midpoint.
      const anchor = others[0]![1];
      const d0 = Math.hypot(before.x - anchor.x, before.y - anchor.y) || 1;
      const d1 = Math.hypot(now.x - anchor.x, now.y - anchor.y) || 1;
      const box = host.current!.getBoundingClientRect();
      const mx = (now.x + anchor.x) / 2 - box.left;
      const my = (now.y + anchor.y) / 2 - box.top;
      const v = viewRef.current;
      const k = Math.min(3, Math.max(zoomFloor(), (v.k * d1) / d0));
      const scale = k / v.k;
      commitView({ k, x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale });
    }
    pointers.current.set(e.pointerId, now);
    moved.current = true;
  };
  const onPointerUp = (e: React.PointerEvent): void => {
    pointers.current.delete(e.pointerId);
    // Land React on wherever the pan left the ref, once. A gesture that
    // never panned left the ref holding the object state already holds,
    // so this costs no render then.
    setView(viewRef.current);
  };
  const onWheel = (e: React.WheelEvent): void => {
    const box = host.current!.getBoundingClientRect();
    const mx = e.clientX - box.left;
    const my = e.clientY - box.top;
    const v = viewRef.current;
    const k = Math.min(3, Math.max(zoomFloor(), v.k * Math.exp(-e.deltaY * 0.0016)));
    const scale = k / v.k;
    commitView({ k, x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale });
  };

  // Opening families as nebulae: each node belongs to the family of its
  // nearest catalogue-named ancestor — the catalogue, not configuration,
  // is what says where the Ruy ends and the Italian begins — and wears
  // it as a faint tinted halo BEHIND everything. The force layout keeps
  // subtrees together, so same-family halos merge into soft regions
  // while every existing mark (fills, satellites, badges, threads)
  // stays untouched on top. Hue is hashed from the family name: stable
  // across sessions, no palette to maintain.
  const familyHue = useMemo(() => {
    const hash = (text: string): number => {
      let h = 2166136261;
      for (const ch of text) h = (h ^ ch.charCodeAt(0)) * 16777619;
      return Math.abs(h);
    };
    // The catalogue's names carry the hierarchy the colours need:
    // "Family: Second Tier, sideline detail". The family sets the hue,
    // the second tier shifts it within a band — every Sicilian stays
    // visibly kin while the Najdorf, the Sveshnikov and the Kan become
    // sub-nebulae of their own — and the comma-tail is detail, so a
    // sideline keeps its second tier's exact shade.
    const out = new Map<string, number>();
    const tierOf = new Map<string, { family: string; second: string } | null>();
    const nameOf = (id: string): { family: string; second: string } | null => {
      const raw = labels?.get(id);
      if (!raw) return null;
      const label = raw.replace(/^[A-E]\d{2}\s+/, '');
      const family = openingFamily(label);
      if (!family) return null;
      const second = (label.split(':')[1] ?? '').split(',')[0]!.trim();
      return { family, second };
    };
    const resolve = (id: string): { family: string; second: string } | null => {
      if (tierOf.has(id)) return tierOf.get(id)!;
      const own = nameOf(id);
      const facts = resolved.nodes.get(id);
      const tier = own ?? (facts?.parentId ? resolve(facts.parentId) : null);
      tierOf.set(id, tier);
      return tier;
    };
    for (const id of resolved.nodes.keys()) {
      const tier = resolve(id);
      if (!tier) continue;
      const base = hash(tier.family) % 360;
      const shift = tier.second ? (hash(tier.second) % 73) - 36 : 0;
      out.set(id, (base + shift + 360) % 360);
    }
    return out;
  }, [resolved, labels]);

  // Frequency scales the DRAWN dot, never the layout: a move played in
  // most games grows, a rarity shrinks, and sizes breathe as field data
  // lands without the physics reshuffling the picture. The start node
  // stands apart: it is the primary star, and whatever the field
  // inflates, the sun outshines it.
  const drawnR = useMemo(() => {
    const out = new Map<string, number>();
    for (const node of graph.nodes) {
      const share = shares?.get(node.id);
      out.set(
        node.id,
        share === undefined ? node.r : Math.max(4, node.r * (0.72 + 0.9 * Math.sqrt(share))),
      );
    }
    let biggest = 0;
    for (const [id, r] of out) if (id !== map.root.id) biggest = Math.max(biggest, r);
    out.set(map.root.id, Math.max(out.get(map.root.id) ?? 0, biggest * 1.25));
    return out;
  }, [graph, shares, map.root.id]);

  // Labels and badges keep their SCREEN size — dividing by the zoom is
  // what makes them readable at any distance — and the labels fade out
  // as the view pulls back, the graph-view convention: far out you read
  // the shape, close in you read the names.
  const inv = 1 / view.k;
  // Soft at the fitted overview of a BIG map (k ≈ 0.4, where 70 labels
  // collide), fully readable one wheel-notch in, gone only far out.
  const labelOpacity = Math.max(0, Math.min(1, (view.k - 0.3) / 0.24));

  /**
   * The mainline — an answer to something you asked, not a permanent
   * feature of the picture.
   *
   * It began as "the edge to the most-played child, at every node", which
   * sounds like it marks the main path and in a repertoire marks nearly
   * everything: most nodes have exactly ONE child, an only child is
   * trivially the most-played one, and the rule fires on every link in
   * every chain. Measured on a 63-node map: 54 of 63 edges. Drawing a
   * single spine from the root fixed the flooding but still answered a
   * question nobody had asked, and only ever the same one.
   *
   * So the accent follows the FOCUS. Select a node and you get the line
   * the field walks on from there — its most-played continuation, all the
   * way down. Search, and every hit gets the same treatment at once, so
   * "where do my Najdorf lines actually go" is one query. Focus on
   * nothing and the map is calm: no selection, no search, no accent.
   *
   * Needs field data either way; with no source there is no "most played"
   * to claim and the map stays neutral, which is the honest picture.
   *
   * Several lines get several colours, so two of them running through the
   * same region can be told apart — the question a multi-hit search asks
   * is usually "where do these go" in the plural, and one accent for all
   * of them answers it as a single tangle. A lone line keeps the accent
   * itself, so selecting a node means what it always meant.
   *
   * One colour per LINE, decided after the walking, not one per hit
   * decided before it. Those two counts are nothing like each other on a
   * real repertoire: searching "Ruy" on a map with six Ruy variations
   * matches 18 nodes, because the catalogue says "Ruy Lopez" on nearly
   * every square of that subtree — but most of those hits sit ON another
   * hit's line and draw nothing of their own. Colouring per hit meant 18
   * went over `HUES`, so everything fell back to the accent and the
   * Berlin came out the same colour as the mainline. It also left gaps in
   * the wheel, since every hit that drew nothing still ate an index.
   */
  const mainline = useMemo(() => {
    const edges = new Map<string, string>();
    const nodes = new Map<string, string>();
    if (!shares) return { edges, nodes };

    const favourite = (id: string): string | null =>
      favouriteChild(resolved.nodes.get(id)?.mapNode.children ?? [], (child) => shares.get(child) ?? 0);

    // Walk first. A hit already standing on an earlier hit's line is not
    // a line of its own — it is a place on one — so it starts nothing and
    // costs nothing. `focus` arrives in the tree's own pre-order, so
    // the earlier hit is always the ancestor: the line that contains the
    // other, which is the one that should own the shared stretch.
    const claimed = new Set<string>();
    const lines: { nodes: string[]; edges: string[] }[] = [];
    for (const start of focus) {
      if (claimed.has(start)) continue;
      const line = { nodes: [] as string[], edges: [] as string[] };
      let cursor: string | null = start;
      // A cycle cannot happen in a tree, but the guard costs nothing and
      // this loop must never be what hangs the page.
      while (cursor && !claimed.has(cursor)) {
        claimed.add(cursor);
        line.nodes.push(cursor);
        const next: string | null = favourite(cursor);
        if (!next) break;
        // Kept even when `next` is already taken: the edge is where this
        // line runs into the other, and drawing it is what shows them
        // meeting rather than stopping short of each other.
        line.edges.push(`${cursor}-${next}`);
        cursor = next;
      }
      lines.push(line);
    }

    // Then colour, spaced around the wheel from the accent's own quarter
    // so any two lines are as far apart as the count allows.
    const many = lines.length > 1 && lines.length <= HUES;
    lines.forEach((line, at) => {
      const paint = many
        ? `hsl(${Math.round((210 + (at * 360) / lines.length) % 360)} 70% 58%)`
        : ACCENT;
      for (const id of line.nodes) nodes.set(id, paint);
      for (const key of line.edges) edges.set(key, paint);
    });
    return { edges, nodes };
  }, [resolved, shares, focus]);

  /**
   * How present a dot is while a search is running. Faded rather than
   * hidden: the misses are the constellation the hits have to be located
   * WITHIN, so removing them would answer the question by destroying its
   * context. Deep enough a fade that the hits pop at a glance.
   *
   * A hit's mainline stays lit with it. It is drawn BECAUSE of the hits,
   * so dimming it as a non-match would have faded out the very thing the
   * search just asked to be shown.
   */
  const dimOf = (id: string): number =>
    !matches ? 1 : matches.has(id) || mainline.nodes.has(id) ? 1 : 0.12;

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
      className="h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing [-webkit-touch-callout:none]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onClick={() => {
        // The ground was pressed and never dragged: clear the selection.
        // Node presses stop propagation, so they never land here.
        if (!moved.current) onSelect(null);
      }}
    >
      <svg width="100%" height="100%" className="block" role="tree" aria-label={t('Opening map')}>
        <g ref={scene} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.nodes.map(({ id }) => {
            const hue = familyHue.get(id);
            if (hue === undefined) return null;
            const { x, y } = posOf(id);
            const r = drawnR.get(id)!;
            return (
              <circle
                key={`halo-${id}`}
                ref={(el) => {
                  if (el) haloEls.current.set(id, el);
                  else haloEls.current.delete(id);
                }}
                cx={x}
                cy={y}
                r={r * 2.6}
                fill={`hsl(${hue} 65% 55%)`}
                opacity={0.13 * dimOf(id)}
              />
            );
          })}
          {graph.edges.map(({ from, to }) => {
            const a = posOf(from);
            const b = posOf(to);
            const lit = lineage.has(from) && lineage.has(to);
            const key = `${from}-${to}`;
            const main = mainline.edges.get(key);
            return (
              <line
                key={key}
                ref={(el) => {
                  if (el) edgeEls.current.set(key, { el, from, to });
                  else edgeEls.current.delete(key);
                }}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                // Colour AND weight, which is the house rule: a signal
                // carried by hue alone is a signal somebody cannot see.
                // Where you came FROM answers in bright foreground, where
                // the field goes NEXT in its line's own colour, and
                // everything else is a hairline in the border tone.
                stroke={lit ? 'var(--color-foreground)' : (main ?? 'var(--color-border)')}
                strokeOpacity={lit || main ? 1 : 0.85}
                strokeWidth={(lit ? 2.4 : main ? 2.6 : 1.1) / view.k}
                strokeLinecap="round"
                opacity={Math.min(dimOf(from), dimOf(to))}
              />
            );
          })}
          {graph.nodes.map(({ id }) => {
            const { x, y } = posOf(id);
            const r = drawnR.get(id)!;
            const facts = resolved.nodes.get(id)!;
            const node = facts.mapNode;
            const isRoot = facts.parentId === null;
            const onMain = mainline.nodes.get(id);
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
                ref={(el) => {
                  if (el) nodeEls.current.set(id, el);
                  else nodeEls.current.delete(id);
                }}
                // Everything the dot wears is drawn around (0,0) and the
                // group carries the position, so the animation loop moves
                // the whole dot — marks, arcs, labels — with one write.
                transform={`translate(${x} ${y})`}
                className="cursor-pointer"
                opacity={dimOf(id)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (suppressClick.current) {
                    suppressClick.current = false;
                    return;
                  }
                  onSelect(id);
                }}
                onPointerDown={(e) => {
                  // Deliberately NOT stopping propagation: the surface
                  // has to count this finger, or a pinch that starts on
                  // a dot is a pinch that never happens. A second finger
                  // is the pinch's, never a drag's.
                  if (alreadyHeld(e.pointerId)) return;
                  moved.current = false;
                  try {
                    (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  } catch {
                    // A capture that fails only costs pointerup routing.
                  }
                  const from = posNow(id);
                  const pointerId = e.pointerId;
                  const fromX = e.clientX;
                  const fromY = e.clientY;
                  const touch = e.pointerType === 'touch';
                  const begin = (): void => {
                    nodeDrag.current = {
                      id,
                      pointerId,
                      fromX,
                      fromY,
                      origX: from.x,
                      origY: from.y,
                      moved: false,
                    };
                    // The ring, and the tick where the hardware offers
                    // one: a hold that arrives under the finger needs no
                    // explaining. Android honours the vibration; iOS
                    // Safari does not, which is why the ring is the part
                    // that has to carry it. Both are the finger's — see
                    // `held` for why a mouse gets neither.
                    if (touch) {
                      setHeld(id);
                      navigator.vibrate?.(12);
                    }
                  };
                  // A mouse claims the dot at once; a finger has to mean
                  // it. On a map worth exploring there is barely any bare
                  // canvas, so a finger that grabbed whatever it landed on
                  // meant the map could not be moved at all — every drag
                  // rearranged a dot instead of panning. Hold to move a
                  // dot, otherwise the surface takes the gesture. This is
                  // what every map app does with its pins, for this
                  // reason.
                  if (touch) {
                    holdFrom.current = { x: fromX, y: fromY };
                    holdTimer.current = window.setTimeout(begin, HOLD_MS);
                  } else {
                    begin();
                  }
                }}
                onPointerMove={(e) => {
                  const drag = nodeDrag.current;
                  // Travelling before the hold lands is a pan, so let go
                  // of the dot and let the surface have it. Jitter is not
                  // travel: see holdFrom.
                  if (!drag && holdFrom.current) {
                    const wander = Math.hypot(
                      e.clientX - holdFrom.current.x,
                      e.clientY - holdFrom.current.y,
                    );
                    if (wander > HOLD_SLOP) cancelHold();
                  }
                  if (!drag || drag.id !== id || drag.pointerId !== e.pointerId) return;
                  const dx = e.clientX - drag.fromX;
                  const dy = e.clientY - drag.fromY;
                  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
                  // The web wakes on the first real movement, not on the
                  // press: a tap to select must not set the map swinging.
                  if (!drag.moved) grab(id, { x: drag.origX, y: drag.origY });
                  drag.moved = true;
                  // The ref, not state: mid-gesture the state can be a
                  // pan behind the picture on screen.
                  const k = viewRef.current.k;
                  haul(id, { x: drag.origX + dx / k, y: drag.origY + dy / k });
                }}
                onPointerUp={(e) => {
                  try {
                    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
                  } catch {
                    // Never captured — nothing to release.
                  }
                  // Let go of the dot but leave the loop running: what is
                  // still swinging coasts to a stop on its own.
                  cancelHold();
                  setHeld(null);
                  letGo(id);
                  suppressClick.current = nodeDrag.current?.moved ?? false;
                  nodeDrag.current = null;
                }}
                onPointerCancel={() => {
                  cancelHold();
                  setHeld(null);
                  letGo(id);
                  nodeDrag.current = null;
                }}
              >
                <circle cx={0} cy={0} r={r + 10} fill="transparent" />
                <circle
                  cx={0}
                  cy={0}
                  r={r}
                  // The field is neutral so the mainline can be seen. A
                  // covered dot off the mainline is the border tone —
                  // present, legible, and not competing; only the dots a
                  // highlighted line runs through are coloured, in that
                  // line's own colour.
                  fill={
                    invalid
                      ? 'var(--color-destructive)'
                      : isRoot
                        ? 'var(--color-foreground)'
                        : planned
                          // The RUNG, not a --color-* utility: the ladder's
                          // extra rungs are variables only (index.css), and
                          // an undefined var in an SVG fill paints black.
                          ? 'var(--surface-3)'
                          : (onMain ?? 'var(--color-border)')
                  }
                  fillOpacity={planned ? 0.6 : onMain ? 1 : 0.92}
                  stroke={
                    selected
                      ? 'var(--color-foreground)'
                      : planned
                        ? 'var(--color-muted-foreground)'
                        : 'transparent'
                  }
                  strokeWidth={selected ? 2 : 1.2}
                  strokeDasharray={planned && !selected ? '3 3' : undefined}
                />
                {/* Held: a finger has picked the dot up and it moves with
                    the finger now. A ring outside everything else the dot
                    wears, in the foreground colour so it reads on any
                    fill, and outside the depth arc so it never looks
                    like progress. Touch only — `held` is never set for a
                    mouse, which needs no telling. */}
                {held === id && (
                  <>
                    <circle
                      cx={0}
                      cy={0}
                      r={r + HELD_RING / view.k}
                      fill="var(--color-foreground)"
                      opacity={0.1}
                    />
                    <circle
                      cx={0}
                      cy={0}
                      r={r + HELD_RING / view.k}
                      fill="none"
                      stroke="var(--color-foreground)"
                      strokeWidth={2.5 / view.k}
                      strokeDasharray={`${5 / view.k} ${4 / view.k}`}
                      opacity={0.95}
                    />
                  </>
                )}

                {/* Depth progress as an arc around the dot: how far the
                    preparation runs toward the intended move. */}
                {target !== undefined && reach !== undefined && (
                  <circle
                    cx={0}
                    cy={0}
                    r={r + 3}
                    fill="none"
                    stroke={reach < target ? 'var(--color-warn)' : 'var(--color-good)'}
                    strokeWidth={1.6}
                    strokeDasharray={`${ring * Math.min(1, reach / Math.max(1, target))} ${ring}`}
                    transform="rotate(-90)"
                  />
                )}
                {/* The per-dot detail marks, and they fade on the same
                    curve as the labels do. They used to hold full
                    strength at every zoom, which meant pulling back to
                    read the SHAPE of a map handed you a field of amber
                    counters instead — loudest of all being the gap
                    badge, which is a number, and a number is something
                    you can only read close up anyway. Far out you read
                    the shape; close in you read the marks. */}
                {/* Not rendered at all when they would be invisible.
                    Fully faded marks and labels still cost React a node
                    each to reconcile, and there are five or six of them
                    per dot — on a 398-node map that is well over a
                    thousand elements doing nothing, on exactly the
                    pulled-back view where the whole map is on screen and
                    every answer that lands re-renders it. */}
                {labelOpacity > 0 && (
                <g opacity={labelOpacity}>
                  {(cov?.reviewCount ?? 0) > 0 && (
                    <circle cx={-r * 0.8} cy={-r * 0.8} r={3 * inv} fill="var(--color-warn)" />
                  )}
                  {(cov?.gapCount ?? 0) > 0 && (
                    <circle cx={-r * 0.8} cy={r * 0.8} r={3 * inv} fill="var(--color-destructive)" />
                  )}
                  {/* Muted, not primary: a note is a fact about a dot,
                      and the accent now means one thing only. */}
                  {noteTags && (
                    <circle
                      cx={r * 0.8}
                      cy={-r * 0.8}
                      r={3 * inv}
                      fill="var(--color-muted-foreground)"
                    />
                  )}
                  {gapCount > 0 && (
                    <>
                      <circle cx={r + 7 * inv} cy={0} r={7.5 * inv} fill="var(--color-warn)" />
                      <text
                        x={r + 7 * inv}
                        y={3 * inv}
                        fontSize={9.5 * inv}
                        fontWeight={700}
                        textAnchor="middle"
                        fill="var(--color-warn-foreground)"
                      >
                        {gapCount}
                      </text>
                    </>
                  )}
                </g>
                )}
                {(labelOpacity > 0 || matches?.has(id)) && (
                <text
                  x={0}
                  y={r + 12 * inv}
                  className="font-moves"
                  fontSize={10.5 * inv}
                  fontWeight={600}
                  textAnchor="middle"
                  // A hit names itself however far out the view is: the
                  // whole point of the search is reading which dots these
                  // are, and at a fitted overview the labels are gone.
                  opacity={matches?.has(id) ? 1 : labelOpacity}
                  fill={invalid ? 'var(--color-destructive)' : 'var(--color-foreground)'}
                >
                  {clip(move, 16)}
                </text>
                )}
                {caption && (labelOpacity > 0 || matches?.has(id)) && (
                  <text
                    x={0}
                    y={r + 22 * inv}
                    fontSize={8 * inv}
                    textAnchor="middle"
                    opacity={matches?.has(id) ? 1 : labelOpacity}
                    // The registry's word for secondary text — the retired
                    // `--color-subtle` this carried was undefined since the
                    // theme migration, and an undefined var in an SVG fill
                    // paints black: invisible captions on a dark map.
                    fill="var(--color-muted-foreground)"
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
