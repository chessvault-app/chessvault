//! Port of the phase reporter in `server/refgamesIndex.ts` — PHASES,
//! `phaseLog` and the lines they print. The exact line shape is the
//! contract: `server/refgames.ts` parses it with `PHASE_RE` and
//! `PROGRESS_RE` and must not be able to tell which implementation ran.
//!
//! ```text
//! positions: 12% replaying — 1,250,000 of 10,355,488 games…
//! positions: 66% summing per move…
//! ```

use std::time::{Duration, Instant};

use crate::util::commas;

/// (key, label, weight) — the TS PHASES table, in order. See the comment
/// there for where the weights come from (a measured gigabase build).
pub const PHASES: [(&str, &str, u32); 8] = [
    ("replay", "replaying", 50),
    ("plies-index", "indexing plies", 14),
    ("sums", "summing per move", 20),
    ("thin", "dropping thin positions", 4),
    ("sums-index", "indexing the sums", 2),
    ("keys-count", "inverting keys", 3),
    ("keys-fill", "inverting keys", 4),
    ("keys-write", "inverting keys", 3),
];

/// A second between `step` lines — the TS twin's throttle, for the same
/// reason: the callers count in fixed strides, which is right on a
/// gigabase and a dozen lines a millisecond apart on a small database.
const QUIET: Duration = Duration::from_secs(1);

pub struct Phases<'a> {
    log: &'a mut dyn FnMut(&str),
    phases: Vec<(&'static str, &'static str, u32)>,
    whole: u32,
    at: usize,
    before: u32,
    last_at: Instant,
}

impl<'a> Phases<'a> {
    /// `skip` drops phases this pass will not run — a pass that is not
    /// packing never inverts keys, and those weights must not be in its
    /// bar or it stalls at 90% and finishes.
    pub fn new(log: &'a mut dyn FnMut(&str), skip: &[&str]) -> Self {
        let phases: Vec<_> = PHASES
            .iter()
            .filter(|(key, _, _)| !skip.contains(key))
            .copied()
            .collect();
        let whole = phases.iter().map(|(_, _, w)| w).sum::<u32>().max(1);
        Self {
            log,
            phases,
            whole,
            at: 0,
            before: 0,
            last_at: Instant::now(),
        }
    }

    fn line(&mut self, within: f64, tail: &str) {
        let Some((_, label, weight)) = self.phases.get(self.at).copied() else {
            return;
        };
        self.last_at = Instant::now();
        // Capped below 100: the pass is not done until it returns.
        let pct = ((f64::from(self.before) + f64::from(weight) * within) / f64::from(self.whole)
            * 100.0)
            .round()
            .min(99.0) as u32;
        let text = format!("  positions: {pct}% {label}{tail}…");
        (self.log)(&text);
    }

    /// Start `key`, printing its line at once — a phase that reports
    /// nothing else at least says it began, and where in the pass it is.
    pub fn enter(&mut self, key: &str, note: Option<&str>) {
        let Some(found) = self.phases.iter().position(|(k, _, _)| *k == key) else {
            return;
        };
        self.at = found;
        self.before = self.phases[..found].iter().map(|(_, _, w)| w).sum();
        let tail = note.map(|n| format!(" — {n}")).unwrap_or_default();
        self.line(0.0, &tail);
    }

    /// Within the current phase: `done` of `total` `unit`s.
    pub fn step(&mut self, done: u64, total: u64, unit: &str) {
        if done != total && self.last_at.elapsed() < QUIET {
            return;
        }
        let tail = format!(" — {} of {} {unit}", commas(done), commas(total));
        self.line(
            if total > 0 {
                done as f64 / total as f64
            } else {
                0.0
            },
            &tail,
        );
    }

    /// The raw log, for the lines that are not progress (the key index's
    /// closing tally).
    pub fn log(&mut self, line: &str) {
        (self.log)(line);
    }
}
