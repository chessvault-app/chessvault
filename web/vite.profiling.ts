/**
 * The profiling build: React's Performance Tracks in Chrome's Performance
 * panel, on a build that is otherwise the release.
 *
 * `CHESS_PROFILE=1 npm run build` (or `build:demo`) resolves
 * `react-dom/client` to `react-dom/profiling`, react-dom's own build that
 * keeps the instrumentation the production build strips: the Scheduler
 * track (blocking, transition, suspense and idle lanes, each render's
 * update, render, commit and effects phases, cascading updates flagged)
 * and, inside a `<Profiler>` or with the React DevTools extension on,
 * the Components track with per-component render and effect durations.
 * The app's own probes (rAF samplers, CDP screencasts, Event Timing)
 * say WHEN a frame was slow; these tracks say WHICH update, render or
 * effect it belonged to, which the probes could not.
 *
 * Off by default, like CHESS_LAG and CHESS_COMPILER=0, because the
 * profiling build is slower and larger than the release: it is a tool
 * for a measurement session, never what a user runs. Aliases are prefix
 * matches, so the key names the whole specifier.
 */
export function profilingAlias(): Record<string, string> {
  return process.env.CHESS_PROFILE === '1' ? { 'react-dom/client': 'react-dom/profiling' } : {};
}
