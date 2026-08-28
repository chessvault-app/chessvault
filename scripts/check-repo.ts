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
 *
 * 7. Move text and Elo wear the right face. index.css gives mono to what
 *    the eye scans as a column and --font-moves to SAN, "prose, not
 *    data" — and both roles drifted anyway, in the shape a grep can see:
 *    a move list set in font-mono (the details panel's ply strip read as
 *    a terminal beside a move tree that did not), an Elo left in the
 *    sans default (the same rating in two faces on one screen). The
 *    check reads the className enclosing each render, so it sees the
 *    class that actually governs rather than the file it sits in.
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

/**
 * The two font roles, at the point where they are actually decided.
 *
 * A class governs the element it sits on, so grepping a line in
 * isolation says nothing: `{game.whiteElo}` is correct or wrong entirely
 * according to a className that is often on the line above it. Both
 * patterns below are therefore resolved against the nearest className
 * opening at or before the render — `enclosingClass` — which is the same
 * thing the cascade does, minus the cases where the class lives on a
 * grandparent. Those it cannot see, and it says so by staying quiet.
 */
const SAN_RENDER = /figurine\(|numberedSan\(|\{[^{}]*\b\w+\.san\b[^{}]*\}/g;
const ELO_RENDER = /\{[^{}]*\b(?:elo|\w+\.(?:white|black)Elo)\b[^{}]*\}/;

/**
 * Where the element opened at `tagStart` closes, as an offset into `text`.
 *
 * Needed because the drift's real shape is a CONTAINER: the details
 * panel's ply strip put font-mono on a div and the SAN twenty-six lines
 * below it, which no fixed lookback window from the render would ever
 * see. Counts nesting rather than stopping at the first `</`, so a
 * child closing inside the element does not end it.
 */
function elementEnd(text: string, tagStart: number): number {
  const open = text.indexOf('>', tagStart);
  if (open === -1) return text.length;
  if (text[open - 1] === '/') return open; // self-closing: no children
  const tags = /<\/?[A-Za-z][^>]*?\/?>/g;
  tags.lastIndex = open + 1;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = tags.exec(text))) {
    if (m[0].startsWith('</')) {
      if (depth === 0) return m.index;
      depth -= 1;
    } else if (!m[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return text.length;
}

/**
 * The className string governing line `i`, or null if none is in reach.
 *
 * "Nearest className above" is not good enough on its own: the move-tree
 * chip prints its ply number in a font-mono span and the SAN after it, so
 * the nearest class above the SAN belongs to a sibling that has already
 * closed. A candidate is therefore rejected when anything closes between
 * its tag and the render, and the search keeps walking back.
 */
function enclosingClass(lines: string[], i: number): string | null {
  // Twelve lines covers every multi-line cn() in this codebase; beyond
  // that the class is on some ancestor and this check does not guess.
  const from = Math.max(0, i - 12);
  const window = lines.slice(from, i + 1).join('\n');
  const renderAt = window.lastIndexOf('\n') + 1;
  let search = window.length;
  while (search > 0) {
    const at = window.lastIndexOf('className=', search - 1);
    if (at === -1) return null;
    search = at;
    const rest = window.slice(at);
    const end = rest.indexOf('>');
    const cls = end === -1 ? rest : rest.slice(0, end);
    // Everything between this opening tag and the render line. A `</` or
    // a self-closing `/>` in there means this element is a sibling.
    const between = end === -1 ? '' : window.slice(at + end, renderAt);
    if (!/<\/|\/>/.test(between)) return cls;
  }
  return null;
}

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

  if (/^web\/src\/.*\.tsx$/.test(file)) {
    // SAN, from the mono element inwards: every element whose own class
    // says font-mono, then anything it renders as move text.
    const lineAt = (offset: number): number => text.slice(0, offset).split('\n').length;
    const classes = /className=(?:\{[^}]*\}|"[^"]*")/g;
    let cm: RegExpExecArray | null;
    while ((cm = classes.exec(text))) {
      if (!/\bfont-mono\b/.test(cm[0]) || /\bfont-moves\b/.test(cm[0])) continue;
      const tagStart = text.lastIndexOf('<', cm.index);
      if (tagStart === -1) continue;
      const span = text.slice(cm.index, elementEnd(text, tagStart));
      SAN_RENDER.lastIndex = 0;
      const hit = SAN_RENDER.exec(span);
      if (hit) {
        findings.push({
          file,
          line: lineAt(cm.index + hit.index),
          text: hit[0].slice(0, 120),
          why: 'move text set in font-mono — SAN is prose, use font-moves (see index.css "Three roles")',
        });
      }
    }

    lines.forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
      // `{player(summary.white, summary.whiteElo, 'white')}` hands the
      // number to a helper that renders it somewhere else, under its own
      // class; only the plain interpolation is judged here.
      if (ELO_RENDER.test(line) && !/\{[^{}]*\(/.test(line)) {
        const cls = enclosingClass(lines, i);
        if (cls && !/\bfont-mono\b/.test(cls)) {
          findings.push({
            file,
            line: i + 1,
            text: code.slice(0, 120),
            why: 'an Elo not in font-mono — a rating is a column, and the explorer already sets it in mono',
          });
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
const CRATE_LOCK = 'native/Cargo.lock';
const CRATE_NOTICE = 'licenses/rust-crates.txt';
if (existsSync(CRATE_LOCK) && existsSync(CRATE_NOTICE)) {
  const wanted = lockCrates(readFileSync(CRATE_LOCK, 'utf-8')).map((c) => `${c.name} ${c.version}`);
  // Normalised, because the blank-line split below is what ends the crate
  // manifest — and .gitattributes does not pin licenses/ to LF, so a
  // Windows checkout hands this file back with CRLF and '\n\n' matches
  // nothing. The whole notice then reads as one enormous crate list and
  // every line of it is reported missing from Cargo.lock. CI runs on
  // Linux, so the check was green there and cried wolf on Windows only.
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
