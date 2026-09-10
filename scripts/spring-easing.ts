/**
 * The app's spring as a CSS easing.
 *
 *   npx tsx scripts/spring-easing.ts [velocity]
 *
 * Prints the `linear()` easing that traces the spring in web/src/lib/
 * spring.ts from 0 to 1, and how long it takes to settle within a
 * thousandth of the end, which is the duration to give the transition.
 * With no argument that is the rest-to-rest trace, which is what the
 * app's motion tokens (`--pane-turn`, `--pane-turn-ease` and the exit's
 * `--pane-turn-ease-out` in web/src/index.css) hold; a test
 * (lib/spring.test.ts) holds them to it,
 * so moving the spring means changing SPRING there, re-running this, and
 * pasting what it printed. With a velocity, in trips per second, it
 * prints the trace the swipe hook uses for a release at that speed.
 *
 * Why the numbers are what they are is in spring.ts.
 */
import { SPRING, springTrace } from '../web/src/lib/spring.ts';

const v0 = Number(process.argv[2] ?? 0);
const trace = springTrace(v0);
console.log(`stiffness ${SPRING.stiffness}, damping ratio ${SPRING.ratio}, release ${v0}/s`);
console.log(`settle: ${trace.ms}ms, overshoot: ${(trace.overshoot * 100).toFixed(2)}%`);
console.log(`--pane-turn: ${trace.ms}ms;`);
console.log(`--pane-turn-ease: ${trace.easing};`);
console.log(`--pane-turn-ease-out: ${trace.exit};`);
