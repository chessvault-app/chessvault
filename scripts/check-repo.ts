/**
 * The CLAUDE.md rules a machine can actually check.
 *
 * All of these are on the release checklist, which means they were being
 * done by reading — and a checklist item that depends on remembering is
 * the kind that catches drift at publishing time instead of while it is
 * one line. These are tripwires, not proofs: they catch the shapes the
 * mistakes actually take, and they are deliberately quiet about
 * everything else, because a hygiene check that cries wolf gets skipped.
 *
 * 1. Nothing personal in a tracked file. No absolute home paths, no
 *    credentials. Deployment targets belong in scripts/deploy.env, which
 *    is gitignored; a config names a file, never where it sits on a disk.
 *
 * 2. Nothing user-facing exposes a puzzle rating. Difficulty is a word
 *    (web/src/puzzles/bands.ts) — a rating is how the trainer PICKS a
 *    puzzle, not a verdict to hand back to whoever solved it. Ratings
 *    that describe a game's players, or a database's population, are a
 *    different thing and are left alone.
 *
 * 3. The lockfile agrees with package.json about the version. A hand
 *    bump of package.json leaves package-lock.json's two version fields
 *    behind, and the next `npm install` then dirties the tree with that
 *    exact diff — which is how 0.4.9 shipped with a lockfile still
 *    saying 0.4.8.
 *
 * 4. The Rust crates' licence notice matches native/Cargo.lock. The
 *    installer conveys the native core, so its crates' notices travel
 *    with it; unlike the npm walk this file is generated ahead of time
 *    and committed, so it is the one part of the inventory that CAN go
 *    stale. One `cargo add` would do it.
 *
 * 5. No retired colour name is back. The old vocabulary (text-subtle,
 *    bg-surface, border-line…) is gone from the app, and CLAUDE.md says
 *    it must not return — but the class greps could not see it hiding
 *    in a var(), which is how --color-subtle survived a theme migration
 *    and painted the opening map's captions black. An undefined var in
 *    an SVG fill is black, not an error.
 *
 * 6. Every string the manual "quotes" still exists in the app. The manual
 *    (web/landing/manual.html) names controls by their verbatim UI
 *    strings, in curly double quotes — a couple of hundred of them, each
 *    one a sentence that silently starts lying the day the label is
 *    reworded. A quote must appear in the app's source (web/src, the
 *    desktop chooser), with {placeholders} standing for whatever the code
 *    interpolates and a trailing … marking a deliberate truncation. The
 *    first run of this check caught fourteen misquotes.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { lockCrates } from './collect-crate-licenses.ts';

interface Finding {
  file: string;
  line: number;
  text: string;
  why: string;
}

/**
 * Credentials and absolute paths.
 *
 * The token patterns require a realistic length: test fixtures legitimately
 * hold token-SHAPED strings ('lip_abcdef123456'), and discriminating on
 * shape beats excluding whole files, which is how a real one sneaks in.
 */
const LEAKS: { pattern: RegExp; why: string }[] = [
  { pattern: /C:\\Users\\/i, why: "an absolute Windows home path — name the file, not one machine's copy of it" },
  { pattern: /\/(?:home|Users)\/[a-z][a-z0-9_-]*\//i, why: "an absolute home path — name the file, not one machine's copy of it" },
  { pattern: /lip_[A-Za-z0-9]{20,}/, why: 'what looks like a real Lichess token' },
  { pattern: /(?:ghp|gho|github_pat)_[A-Za-z0-9]{20,}/, why: 'what looks like a real GitHub token' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY/, why: 'a private key' },
];

/**
 * A puzzle rating reaching the screen.
 *
 * The one legitimate path is through bandOf(), which turns the number into
 * a difficulty word — so an interpolation carrying `.rating` is a finding
 * only when bandOf is nowhere in it. Assigning the rating to a variable
 * first would slip past this; it is a tripwire for the obvious regression
 * ({puzzle.rating} in a panel), not a proof that none exists.
 */
const RATING_IN_JSX = /\{[^{}]*\.rating\b[^{}]*\}/g;

/**
 * The retired colour vocabulary (CLAUDE.md: "Old names … are gone and
 * must not return"), in the two shapes it actually returns in: a class
 * token, and a CSS variable reference — the latter is how one survived
 * the class greps and painted the opening map's captions black, because
 * an undefined var() in an SVG fill is black, not an error.
 */
const RETIRED_COLORS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /(?:^|[\s'"`])(?:text-fg|text-subtle|text-bad|bg-surface(?:-\d)?|border-line)(?=$|[\s'"`])/,
    why: 'a retired colour class — speak the registry\'s vocabulary (see CLAUDE.md "Class names")',
  },
  {
    pattern: /var\(--color-(?:fg|subtle|surface(?:-\d)?|line|bad)\)/,
    why: 'a retired colour token behind var() — undefined, so SVG fills paint black',
  },
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf-8' })
  .split('\0')
  .filter(Boolean);

const findings: Finding[] = [];

for (const file of tracked) {
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
  } catch {
    continue; // unreadable or gone from the working tree
  }
  // Binary-ish: a NUL byte in the first chunk. Skipped rather than scanned
  // as if it were text.
  if (text.slice(0, 4096).includes('\0')) continue;

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { pattern, why } of LEAKS) {
      if (pattern.test(line)) {
        findings.push({ file, line: i + 1, text: line.trim().slice(0, 120), why });
      }
    }
  });

  if (/^web\/src\/.*\.tsx$/.test(file)) {
    lines.forEach((line, i) => {
      for (const hit of line.match(RATING_IN_JSX) ?? []) {
        if (hit.includes('bandOf')) continue;
        findings.push({
          file,
          line: i + 1,
          text: hit.slice(0, 120),
          why: 'a rating rendered without bandOf() — difficulty is a word, see puzzles/bands.ts',
        });
      }
    });
  }

  if (/^web\/src\/.*\.tsx?$/.test(file)) {
    lines.forEach((line, i) => {
      for (const { pattern, why } of RETIRED_COLORS) {
        if (pattern.test(line)) {
          findings.push({ file, line: i + 1, text: line.trim().slice(0, 120), why });
        }
      }
    });
  }
}

// The lockfile's version fields against package.json's. npm keeps the
// version in two places in the lock (the root field and the "" package
// entry), and `npm version`/a hand edit updates neither.
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf-8')).version as string;
const lock = JSON.parse(readFileSync('package-lock.json', 'utf-8'));
for (const [where, got] of [
  ['version', lock.version],
  ['packages[""].version', lock.packages?.['']?.version],
] as const) {
  if (got !== pkgVersion) {
    findings.push({
      file: 'package-lock.json',
      line: 1,
      text: `${where} = ${got}`,
      why: `lockfile version disagrees with package.json (${pkgVersion}) — run npm install and commit the lockfile`,
    });
  }
}

// The crate notice against the lockfile it is generated from. Names and
// versions only, read out of the notice's own "Crates covered:" manifest,
// so this needs neither cargo nor the registry — it runs anywhere.
//
// The manifest is the block up to the first blank line, which means the
// newlines have to be normalised before it is split. The file is committed
// LF, but a Windows checkout with core.autocrlf=true hands it back CRLF,
// and then the blank line never matches: the whole rest of the file reads
// as the manifest, and every separator rule, "--- LICENSE-APACHE ---"
// header and line of licence text counts as a crate no longer in the
// lockfile. That is 7178 phantom crates against a real 48.
const CRATE_LOCK = 'native/Cargo.lock';
const CRATE_NOTICE = 'licenses/rust-crates.txt';
if (existsSync(CRATE_LOCK) && existsSync(CRATE_NOTICE)) {
  const wanted = lockCrates(readFileSync(CRATE_LOCK, 'utf-8')).map((c) => `${c.name} ${c.version}`);
  const notice = readFileSync(CRATE_NOTICE, 'utf-8').replace(/\r\n/g, '\n');
  const listed = notice
    .split('Crates covered:')[1]
    ?.split('\n\n')[0]
    ?.split('\n')
    .map((l) => l.trim())
    .filter(Boolean) ?? [];
  const missing = wanted.filter((c) => !listed.includes(c));
  const extra = listed.filter((c) => !wanted.includes(c));
  for (const [crates, why] of [
    [missing, 'in native/Cargo.lock but not in the licence notice'],
    [extra, 'in the licence notice but no longer in native/Cargo.lock'],
  ] as const) {
    if (crates.length > 0) {
      findings.push({
        file: CRATE_NOTICE,
        line: 1,
        text: crates.slice(0, 4).join(', ') + (crates.length > 4 ? `, +${crates.length - 4} more` : ''),
        why: `${crates.length} crate(s) ${why} — run npx tsx scripts/collect-crate-licenses.ts`,
      });
    }
  }
}

// The manual's quoted strings against the app's own. Curly double quotes
// are the manual's marker for "this is what the screen says", so they are
// what is held to account; guillemets carry the Korean and straight quotes
// carry paraphrase, and neither is checked. The haystack is
// whitespace-collapsed so JSX line wrapping does not hide a match, and
// typographic apostrophes are folded because the two sides disagree
// about them.
const MANUAL = 'web/landing/manual.html';
if (existsSync(MANUAL)) {
  const collapse = (s: string): string =>
    s.replace(/&amp;/g, '&').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  let hay = '';
  for (const file of tracked) {
    if (!/^(?:web\/src\/.*\.(?:ts|tsx|json)|desktop\/.*\.(?:html|mjs))$/.test(file)) continue;
    try {
      hay += readFileSync(file, 'utf-8') + '\n';
    } catch {
      continue;
    }
  }
  hay = collapse(hay);
  const manualText = readFileSync(MANUAL, 'utf-8');
  const seen = new Set<string>();
  for (const match of manualText.matchAll(/“([^”]+)”/g)) {
    const quote = collapse(match[1]!);
    if (seen.has(quote)) continue;
    seen.add(quote);
    // A trailing ellipsis is a deliberate truncation: match the prefix.
    // A {placeholder} stands for whatever the code interpolates there —
    // a template literal's expression, a t() parameter.
    const probe = quote
      .replace(/\s*…$/, '')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{[^{}]*\\\}/g, '.{1,80}?');
    if (!new RegExp(probe).test(hay)) {
      findings.push({
        file: MANUAL,
        line: manualText.slice(0, match.index).split('\n').length,
        text: quote.slice(0, 120),
        why: 'a “quoted” manual string with no match in the app source — the UI moved, or the quote is wrong',
      });
    }
  }
}

if (findings.length === 0) {
  console.log(`repo check: ${tracked.length} tracked files, nothing to report`);
  process.exit(0);
}

for (const f of findings) {
  console.error(`${f.file}:${f.line}: ${f.why}\n    ${f.text}`);
}
console.error(`\nrepo check: ${findings.length} problem(s) — see CLAUDE.md`);
process.exit(1);
