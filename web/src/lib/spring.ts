/**
 * The app's one spring, as a CSS easing.
 *
 * Every state motion (the pane turn, the tab bar's pill, the title's
 * collapse) settles on this damped spring, sampled into a `linear()`
 * easing: the rest-to-rest trace is the `--pane-turn` pair of tokens in
 * index.css, printed by scripts/spring-easing.ts and held to this file
 * by a test. The swipe hook calls it with the finger's speed, so a pane
 * let go fast keeps that speed into the settle instead of restarting
 * from rest, which is the one thing a fixed CSS curve cannot do.
 *
 * Stiffness 380 and damping ratio 0.92 on unit mass: settles in ~337ms
 * from rest with no visible overshoot (a tool's spring; Apple's default
 * is ~0.83 and rebounds). Not under 0.85: a bouncing move list is the
 * register the design record rejects. A flick does overshoot a little,
 * which is what a flick should do, and `MAX_V0` keeps that under a
 * hundredth of the trip.
 */
export const SPRING = { stiffness: 380, ratio: 0.92 } as const;

/**
 * The fastest release the trace will take, in trips per second. A flick
 * (0.5px/ms, hooks/use-pane-swipe) over the last quarter of a 360px
 * column is about 5/s; a hard one 10/s. Measured overshoot: 0.08% at
 * 10/s, 0.73% at 20/s, where it stops growing and the settle stops
 * shortening (294ms at 10/s, 387ms at 20/s, the rebound's return), so
 * beyond 20 the curve is the same curve.
 */
export const MAX_V0 = 20;

/** Position at time t (s) of a spring released from 0 towards 1 with
    velocity v0 (in trips per second). */
export function springAt(t: number, v0 = 0, { stiffness, ratio }: { stiffness: number; ratio: number } = SPRING): number {
  const omega = Math.sqrt(stiffness);
  const zeta = ratio;
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega - v0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-omega * t) * (1 + (omega - v0) * t);
  const s1 = -omega * (zeta - Math.sqrt(zeta * zeta - 1));
  const s2 = -omega * (zeta + Math.sqrt(zeta * zeta - 1));
  const a = (v0 + s2) / (s1 - s2);
  return 1 + a * Math.exp(s1 * t) + (-1 - a) * Math.exp(s2 * t);
}

export interface SpringTrace {
  /** How long until the spring stays within a thousandth of the end. */
  ms: number;
  /** The `linear()` easing that traces it over that time. */
  easing: string;
  /** The same trace run backwards: slow off the mark, arriving at the
      spring's own peak speed. An exit (a sheet dismissed, a page popped)
      takes this one, because a thing leaving on a decelerating curve
      lingers at the edge; both platforms' guidance ends an exit at full
      speed. One physics, two directions. */
  exit: string;
  /** How far past the end it goes, as a share of the trip. */
  overshoot: number;
}

const STEPS = 24;
const traces = new Map<number, SpringTrace>();

/**
 * The trace for a release at `v0` trips per second (0 is rest, and the
 * tokens). Rounded to a tenth and cached: a swipe asks once per release,
 * and the curve at 7.13/s is the curve at 7.1/s.
 */
export function springTrace(v0 = 0, spring: { stiffness: number; ratio: number } = SPRING): SpringTrace {
  const key = Math.round(Math.max(-MAX_V0, Math.min(MAX_V0, v0)) * 10) / 10;
  const cached = spring === SPRING ? traces.get(key) : undefined;
  if (cached) return cached;
  // Settled: within 0.1% of the end (a pixel on a 1000px move) and staying
  // there. Scanned at a millisecond, to five seconds.
  let settle = 0;
  let peak = 1;
  for (let ms = 0; ms < 5000; ms++) {
    const p = springAt(ms / 1000, key, spring);
    if (Math.abs(1 - p) > 0.001) settle = ms;
    if (p > peak) peak = p;
  }
  settle += 1;
  const sample = (at: (i: number) => number): string => {
    const samples: string[] = [];
    for (let i = 0; i <= STEPS; i++) {
      const p = at(i);
      samples.push(i === 0 ? '0' : i === STEPS ? '1' : `${p.toFixed(4)} ${((100 * i) / STEPS).toFixed(1)}%`);
    }
    return `linear(${samples.join(', ')})`;
  };
  const at = (share: number): number => springAt((settle / 1000) * share, key, spring);
  const trace = {
    ms: settle,
    easing: sample((i) => at(i / STEPS)),
    exit: sample((i) => 1 - at(1 - i / STEPS)),
    overshoot: peak - 1,
  };
  if (spring === SPRING) traces.set(key, trace);
  return trace;
}
