/**
 * A spring as a CSS easing.
 *
 *   npx tsx scripts/spring-easing.ts [stiffness] [damping ratio] [mass]
 *
 * Prints the `linear()` easing that traces a damped spring from 0 to 1,
 * and the time it takes to settle within a pixel of the end, which is
 * the duration to give the transition. The app's motion tokens
 * (`--pane-turn`, `--pane-turn-ease` in web/src/index.css) are what this
 * printed; re-run it to move them, and quote the numbers in the record.
 *
 * Why a spring, and why sampled into CSS rather than run in JS: the
 * pane turn, the tab bar's pill and the title's collapse are the app's
 * three state motions, and each was a 200ms cubic-bezier that starts from
 * rest and takes the same time whatever the distance. A spring's curve
 * arrives fast and eases to a stop with no fixed length; sampling it
 * into `linear()` gives the rest-to-rest shape at zero runtime cost and
 * drops straight into the tokens the three already read. What CSS cannot
 * do is take the finger's velocity; that would be a JS spring in the
 * swipe hook, and a separate step.
 *
 * The defaults are a stiff, critically-damped-but-one spring: stiffness
 * 380 and damping ratio 0.92 on unit mass settle in ~330ms with no
 * visible overshoot, which is a tool's spring (Apple's system default is
 * ratio ~0.83 and does rebound a little; Material's "standard" scheme is
 * close to critical, its "expressive" scheme well under it). Do not go
 * under 0.85 here: a bouncing move list is the register the design
 * record rejects.
 */

const stiffness = Number(process.argv[2] ?? 380);
const ratio = Number(process.argv[3] ?? 0.92);
const mass = Number(process.argv[4] ?? 1);

const omega = Math.sqrt(stiffness / mass);
const damping = 2 * ratio * Math.sqrt(stiffness * mass);

/** Position of a spring released from 0 towards 1 at rest, at time t (s). */
function position(t: number): number {
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const s1 = -omega * (zeta - Math.sqrt(zeta * zeta - 1));
  const s2 = -omega * (zeta + Math.sqrt(zeta * zeta - 1));
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

// Settled: within 0.1% of the end (a pixel on a 1000px move) and staying there.
let settle = 0;
for (let t = 0; t < 5; t += 0.001) {
  if (Math.abs(1 - position(t)) > 0.001) settle = t;
}
settle += 0.001;

const STEPS = 24;
const samples: string[] = [];
for (let i = 0; i <= STEPS; i++) {
  const t = (settle * i) / STEPS;
  const p = position(t);
  samples.push(i === 0 || i === STEPS ? `${i === 0 ? 0 : 1}` : `${p.toFixed(4)} ${((100 * i) / STEPS).toFixed(1)}%`);
}

const peak = Math.max(...Array.from({ length: 1000 }, (_, i) => position((settle * i) / 1000)));
console.log(`stiffness ${stiffness}, damping ratio ${ratio}, mass ${mass}`);
console.log(`settle: ${Math.round(settle * 1000)}ms, overshoot: ${((peak - 1) * 100).toFixed(2)}%`);
console.log(`--pane-turn: ${Math.round(settle * 1000)}ms;`);
console.log(`--pane-turn-ease: linear(${samples.join(', ')});`);
