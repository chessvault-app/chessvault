import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * Ship the licence texts inside every build.
 *
 * Publishing the source satisfies the network half of a copyleft obligation;
 * this is the other half. A copy that is CONVEYED — an AppImage installed, a
 * demo page loaded — has to carry the licence with it, and `licenses/` at the
 * repository root reaches nobody who never visits the repository.
 *
 * Stockfish's licence already arrives this way by accident: it sits under
 * `web/public/engine/`, which Vite copies wholesale. This does the same thing
 * on purpose, for the rest, without moving the texts out of the conventional
 * place a source tree keeps them.
 *
 * The page it generates is the notice itself: one list of everything the
 * app is built from — bundled assets, npm packages, and Electron's Chromium
 * components — each row opening to its own licence text. THIRD-PARTY.md is
 * the human summary and is deliberately NOT rendered here; a page that
 * repeats a document is a second copy to keep true.
 */

const repo = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = resolve(repo, 'licenses');

/**
 * This project's OWN licence, copied into the output as GPL-3.0.txt.
 *
 * It used to be missing, and the page's "under the GNU General Public
 * License v3" linked to GPL-3.0-Stockfish.txt instead — Stockfish's copy of
 * the same text, under a filename that says it belongs to a different
 * project. The words were identical and the attribution was wrong.
 */
const OWN_LICENSE = resolve(repo, 'LICENSE');

const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')) as {
  repository?: { url?: string };
  author?: string | { name?: string };
};

/**
 * Where the source is offered. AGPLv3 §13 turns this from a courtesy into a
 * term: the demo serves pirouetti's pieces to strangers over a network, and
 * they are owed a way to the source. One value, read from package.json, so
 * the app and the generated page cannot disagree.
 */
export const REPO_URL = pkg.repository?.url ?? '';

/**
 * Whose copyright. Read from package.json rather than written here, because
 * a name in a licence notice is an assertion about who holds the rights and
 * it should have exactly one source. The GPL expects one; the bare LICENSE
 * text carries only the FSF's line, which covers the licence document
 * itself and grants nothing on our behalf.
 */
export const COPYRIGHT =
  typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? 'the Chess Vault authors');

/**
 * Stated, not taken from the clock. A copyright year is the year of
 * publication, so deriving it from the build date would rewrite history
 * every January and claim a date the work was not first published in.
 * Widen to a range ("2026–2027") when the project spans years.
 */
export const COPYRIGHT_YEAR = '2026';

/**
 * Bundled work that is not an npm package, so no dependency walk can find
 * it: artwork vendored as base64 into the CSS, data compiled into the
 * databases, and the sounds. Each names the licence text shipped beside it
 * in this directory.
 */
const ASSETS: { name: string; version: string; license: string; url: string; file: string | null }[] = [
  { name: 'cburnett (piece set, app icon, favicon)', version: '—', license: 'GPL-2.0-or-later',
    url: 'https://github.com/lichess-org/lila/tree/master/public/piece/cburnett', file: 'GPL-2.0.txt' },
  { name: 'merida (piece set)', version: '—', license: 'GPL-2.0-or-later',
    url: 'https://github.com/lichess-org/lila/tree/master/public/piece/merida', file: 'GPL-2.0.txt' },
  { name: 'chessnut (piece set)', version: '—', license: 'Apache-2.0',
    url: 'https://github.com/lichess-org/lila/tree/master/public/piece/chessnut', file: 'Apache-2.0.txt' },
  { name: 'pirouetti (piece set)', version: '—', license: 'AGPL-3.0-or-later',
    url: 'https://github.com/lichess-org/lila/tree/master/public/piece/pirouetti', file: 'AGPL-3.0.txt' },
  { name: 'Stockfish (WASM engine)', version: '18', license: 'GPL-3.0-or-later',
    url: 'https://github.com/official-stockfish/Stockfish', file: 'GPL-3.0-Stockfish.txt' },
  { name: 'ECO opening names', version: '—', license: 'CC0-1.0',
    url: 'https://github.com/lichess-org/chess-openings', file: null },
  { name: 'Lichess puzzle database', version: '—', license: 'CC0-1.0',
    url: 'https://database.lichess.org/#puzzles', file: null },
  { name: 'Reference games (derived from the Lichess database)', version: '—', license: 'CC0-1.0',
    url: 'https://database.lichess.org/', file: null },
  { name: 'Move and capture sounds', version: '—', license: 'GPL-3.0-only (ours)',
    url: 'https://github.com/chessvault-app/chess-sounds-gen', file: null },
  { name: 'CellNet board-recognition weights', version: 'v1', license: 'GPL-3.0-only (ours)',
    url: REPO_URL, file: null },
];

/**
 * Every production dependency, with its own licence text.
 *
 * MIT and ISC both require their notice "in all copies", and the fonts are
 * OFL, which has to travel with the font files. That is 130-odd notices,
 * which nobody can maintain by hand and which go stale the first time a
 * dependency is added — so they are read from node_modules at build time
 * instead. The copyright lines are the part that matters, and they come
 * from each package's own file rather than a template.
 *
 * The list is the production closure, which is a SUPERSET of what any one
 * build bundles: the web build does not include the desktop updater's
 * dependencies, and vice versa. Over-inclusion is harmless — an extra
 * notice costs a few lines — and under-inclusion is the failure that
 * matters, so no attempt is made to narrow it.
 *
 * Cross-checked 2026-08-11 against two outside tools. license-checker
 * (rseidelsohn) found 137 production packages and nothing this misses, with
 * no disagreement about any licence id. `npm sbom --omit dev` found 108 and
 * dropped `hono` — a declared production dependency and the server itself —
 * apparently because the dev-only @hono/node-server also requires it, so
 * pruning the dev tree took the shared node with it. Worth remembering
 * before replacing this with the official tool: it under-reported, and the
 * package it lost was not a small one.
 */
interface Dep {
  name: string;
  version: string;
  license: string;
  /** Where the source is, for the link on each row. */
  url: string;
  text: string | null;
}

/** `repository` comes in several shapes; all of them reduce to a URL. */
function sourceUrl(pkg: Record<string, unknown>, name: string): string {
  const repository = pkg.repository as { url?: string } | string | undefined;
  const raw = typeof repository === 'string' ? repository : (repository?.url ?? '');
  const cleaned = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git$/, '');
  if (cleaned.startsWith('http')) return cleaned;
  if (cleaned) return `https://github.com/${cleaned}`;
  const home = typeof pkg.homepage === 'string' ? pkg.homepage : '';
  return home || `https://www.npmjs.com/package/${name}`;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolve like Node does: the requiring package's own node_modules first,
 * then upward to the root. Looking only at the top level silently skipped
 * anything npm had to nest on a version conflict — which is a quiet
 * omission in exactly the file that exists to have no omissions.
 */
function packageDir(name: string, from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = resolve(dir, 'node_modules', ...name.split('/'));
    if (existsSync(resolve(candidate, 'package.json'))) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir || !dir.startsWith(repo.replace(/[\\/]$/, ''))) return null;
    dir = parent;
  }
}

/**
 * Peer and optional dependencies count too. Following only `dependencies`
 * missed @floating-ui/* and immer — reached through tiptap's and zustand's
 * peer sets, and both genuinely in the web bundle. Anything not actually
 * installed is skipped by packageDir, so unmet peers cost nothing.
 */
const edges = (pkg: Record<string, unknown> | null): string[] => [
  ...Object.keys((pkg?.dependencies as Record<string, string>) ?? {}),
  ...Object.keys((pkg?.optionalDependencies as Record<string, string>) ?? {}),
  ...Object.keys((pkg?.peerDependencies as Record<string, string>) ?? {}),
];

/**
 * devDependencies that nonetheless ship.
 *
 * Electron is declared dev because nothing imports it — but the desktop
 * installer IS Electron, and with it Chromium and Node. Being absent from
 * `dependencies` meant the runtime a desktop user is actually executing
 * appeared nowhere on the page listing what this app is made of.
 *
 * electron-builder puts LICENSE.electron.txt and the 20 MB
 * LICENSES.chromium.html at the root of the packaged app by itself, so the
 * installer already satisfies the obligation; this is about the page
 * telling the truth. Chromium's own file is far too large to inline, and
 * is referenced from THIRD-PARTY.md instead.
 */
const SHIPPED_DEV_DEPS = ['electron'];

/**
 * Chromium's own components, from the file Electron ships.
 *
 * 773 entries and 19 MB of text, which is the bulk of what a desktop
 * install actually contains — and none of it is visible to any npm tool,
 * because none of it is an npm package. Only ~320 of those licence texts
 * are distinct, so they are stored once and referenced, which is what makes
 * shipping the list possible at all.
 *
 * Desktop only. The web and demo builds contain no Chromium, so listing it
 * there would be a false claim about what the visitor received.
 */
const CHROMIUM_HTML = resolve(repo, 'node_modules/electron/dist/LICENSES.chromium.html');

interface Chromium {
  names: [name: string, url: string, text: number][];
  texts: string[];
}

const unescapeHtml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

function chromium(): Chromium | null {
  if (!existsSync(CHROMIUM_HTML)) {
    // Loudly, because the failure is invisible in the output: the page
    // still builds, still looks complete, and quietly omits 773 of the
    // things a desktop install contains. Electron's dist is downloaded by
    // its install script, so a pruned or script-blocked install loses it.
    console.warn(
      `licenses: WARNING — ${CHROMIUM_HTML} is missing, so Chromium's components are NOT listed.
` +
        "           Run `node node_modules/electron/install.js` and build again.",
    );
    return null;
  }
  const html = readFileSync(CHROMIUM_HTML, 'utf8');
  const texts: string[] = [];
  const seen = new Map<string, number>();
  const names: Chromium['names'] = [];

  for (const block of html.split('<div class="product">').slice(1)) {
    const name = /<span class="title">([^<]+)<\/span>/.exec(block)?.[1]?.trim();
    if (!name) continue;
    const url = /<span class="homepage"><a href="([^"]+)"/.exec(block)?.[1] ?? '';
    const body = /<pre[^>]*>([\s\S]*?)<\/pre>/.exec(block)?.[1] ?? '';
    const text = unescapeHtml(body).trim();

    let at = seen.get(text);
    if (at === undefined) {
      at = texts.length;
      texts.push(text);
      seen.set(text, at);
    }
    names.push([unescapeHtml(name), unescapeHtml(url), at]);
  }
  return { names, texts };
}

function collect(): Dep[] {
  const root = readJson(resolve(repo, 'package.json'));
  const queue: { name: string; from: string }[] = [
    ...edges(root),
    ...SHIPPED_DEV_DEPS,
  ].map((name) => ({
    name,
    from: repo,
  }));
  const seen = new Set<string>();
  const out: Dep[] = [];

  while (queue.length) {
    const { name, from } = queue.shift()!;
    const dir = packageDir(name, from);
    // Keyed by resolved directory, so the same name nested at two versions
    // is reported twice rather than one of them being lost.
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);

    const pkg = readJson(resolve(dir, 'package.json'));
    if (!pkg) continue;

    const declared = pkg.license;
    const license =
      typeof declared === 'string'
        ? declared
        : ((declared as { type?: string } | undefined)?.type ?? 'see package');

    let text: string | null = null;
    try {
      const file = readdirSync(dir).find((f) => /^(LICEN[CS]E|COPYING)/i.test(f));
      if (file) text = readFileSync(resolve(dir, file), 'utf8').trim();
    } catch {
      // Unreadable is the same as absent here: the SPDX id below still names
      // the terms, and the shipped canonical texts cover the wording.
    }

    out.push({
      name,
      version: String(pkg.version ?? '?'),
      license,
      url: sourceUrl(pkg, name),
      text,
    });
    queue.push(...edges(pkg).map((dep) => ({ name: dep, from: dir })));
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function dependencyNotice(deps: Dep[]): string {
  const head = [
    'Third-party dependencies',
    '========================',
    '',
    'Generated at build time from node_modules — see web/vite.licenses.ts.',
    'This is the production dependency closure, which is a superset of what',
    'any single build bundles.',
    '',
    `${deps.length} packages.`,
    '',
  ];

  const counts = new Map<string, number>();
  for (const d of deps) counts.set(d.license, (counts.get(d.license) ?? 0) + 1);
  for (const [license, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    head.push(`  ${String(n).padStart(4)}  ${license}`);
  }
  head.push('');

  const body = deps.map((d) => {
    const bar = '-'.repeat(76);
    return [
      bar,
      `${d.name} ${d.version}  (${d.license})`,
      bar,
      '',
      d.text ??
        `No licence file is included in this package. It declares ${d.license}; ` +
          'the full text of that licence is alongside this file.',
      '',
    ].join('\n');
  });

  return [...head, ...body].join('\n');
}

/**
 * One list of everything, each row openable to its own licence text.
 *
 * A single 325 kB notice satisfies the obligation and answers no actual
 * question — nobody scrolls it to find out what one package is under.
 * Everything except Chromium is inlined, so a licence stays readable with
 * no network and with JavaScript off: <details> opens by itself, and the
 * filter is the only scripted part.
 */
const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Row {
  name: string;
  version: string;
  license: string;
  url: string;
  /** Inlined licence text, or null when it is fetched on demand. */
  text: string | null;
  group: string;
}

function rowHtml(r: Row, index: number, lazy: boolean): string {
  const body = lazy
    ? '<pre data-lazy="' + index + '">…</pre>'
    : `<pre>${escapeHtml(r.text ?? `No licence file ships with this component. It is under ${r.license}.`)}</pre>`;
  return `      <details class="dep" data-name="${escapeHtml(r.name.toLowerCase())}" data-license="${escapeHtml(r.license)}" data-group="${escapeHtml(r.group)}">
        <summary><span class="nm">${escapeHtml(r.name)}</span>${
          r.version && r.version !== '—' ? `<span class="ver">${escapeHtml(r.version)}</span>` : ''
        }<span class="lic">${escapeHtml(r.license)}</span></summary>
        ${r.url ? `<p class="src"><a href="${escapeHtml(r.url)}" rel="noreferrer">${escapeHtml(r.url)}</a></p>` : ''}
        ${body}
      </details>`;
}

function indexPage(_files: string[], deps: Dep[], chrome: Chromium | null): string {
  const rows: Row[] = [
    ...ASSETS.map((a) => ({
      name: a.name,
      version: a.version,
      license: a.license,
      url: a.url,
      text: a.file ? readFileSync(resolve(SOURCE, a.file), 'utf8').trim() : null,
      group: 'Bundled assets',
    })),
    ...deps.map((d) => ({
      name: d.name,
      version: d.version,
      license: d.license,
      url: d.url,
      text: d.text,
      group: 'Packages',
    })),
  ];

  // Chromium's texts are fetched on first open: 19 MB inlined would make a
  // settings page nobody could load, and only the desktop app contains it.
  const chromeRows = (chrome?.names ?? []).map(([name, url, at]) => ({
    name,
    version: '—',
    license: 'see text',
    url,
    text: null,
    group: 'Chromium (desktop app)',
    at,
  }));

  const counts = new Map<string, number>();
  for (const r of [...rows, ...chromeRows]) counts.set(r.group, (counts.get(r.group) ?? 0) + 1);

  const chips = [...counts]
    .map(
      ([group, n]) =>
        `<button type="button" class="chip" data-group="${escapeHtml(group)}">${escapeHtml(group)} <span class="n">${n}</span></button>`,
    )
    .join('\n      ');

  const list = [
    ...rows.map((r, i) => rowHtml(r, i, false)),
    ...chromeRows.map((r) => rowHtml(r, r.at, true)),
  ].join('\n');

  const total = rows.length + chromeRows.length;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Licences — Chess Vault</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0 auto; padding: 2.5rem 1.25rem 5rem; max-width: 48rem;
        font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      }
      h1 { font-size: 1.6rem; margin: 0 0 .3rem; }
      .lede { opacity: .75; margin: 0 0 .4rem; }
      .copyright { font-size: .9rem; opacity: .85; margin: 0 0 1.4rem; }
      .controls { display: flex; flex-wrap: wrap; gap: .4rem; margin: 1rem 0 .3rem; }
      /* The filter owns its line and the group chips own theirs. Sharing
         one wrapping row put the chips on a second line anyway on a phone,
         but only sometimes — a row that reflows as you resize reads as
         broken rather than as responsive. */
      .controls.chips { margin: .4rem 0 .3rem; }
      .field { position: relative; display: flex; flex: 1 1 100%; min-width: 0; }
      #q {
        flex: 1 1 auto; min-width: 0; font: inherit; font-size: .95rem;
        padding: .45rem 2rem .45rem .7rem; border-radius: .5rem;
        border: 1px solid rgba(128,128,128,.45); background: transparent; color: inherit;
      }
      /* WebKit draws its own clear button in a search field, in its own
         place and its own size. One button, ours, in both engines. */
      #q::-webkit-search-cancel-button { display: none; }
      #clear {
        position: absolute; right: .35rem; top: 50%; transform: translateY(-50%);
        width: 1.4rem; height: 1.4rem; display: grid; place-items: center;
        border: 0; border-radius: 999px; background: rgba(128,128,128,.18);
        color: inherit; font: inherit; font-size: 1rem; line-height: 1; cursor: pointer;
      }
      #clear:hover { background: rgba(128,128,128,.32); }
      #clear[hidden] { display: none; }
      .chip {
        font: inherit; font-size: .8rem; padding: .3rem .6rem; border-radius: 999px;
        border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit;
        cursor: pointer;
      }
      .chip:hover { background: rgba(128,128,128,.15); }
      .chip[aria-pressed="true"] { background: rgba(128,128,128,.28); font-weight: 600; }
      .chip .n { opacity: .6; }
      #count { font-size: .85rem; opacity: .7; margin: .2rem 0 .8rem; }

      .dep { border-top: 1px solid rgba(128,128,128,.25); }
      .dep[hidden] { display: none; }
      /* One line, and the NAME is what gives way. Wrapping put the licence
         tag on a line of its own under a long package name, which on a
         phone was most of them. */
      .dep > summary {
        cursor: pointer; padding: .5rem .2rem; display: flex; gap: .6rem;
        align-items: baseline; flex-wrap: nowrap;
      }
      .dep .nm {
        font-weight: 600; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
      }
      .dep .ver { font-size: .8rem; opacity: .6; font-family: ui-monospace, monospace; flex: none; }
      .dep .lic { font-size: .75rem; opacity: .8; margin-left: auto; flex: none;
                  white-space: nowrap;
                  border: 1px solid rgba(128,128,128,.35); border-radius: 999px; padding: .05rem .5rem; }
      .dep .src { margin: .1rem .2rem .5rem; font-size: .8rem; word-break: break-all; }
      .dep pre {
        margin: 0 0 1rem; padding: .9rem 1rem; border-radius: .5rem;
        background: rgba(128,128,128,.12); overflow-x: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: .78rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word;
      }
    </style>
  </head>
  <body>
    <h1>Licences</h1>
    <p class="lede">Everything this app is built from, and the terms it is under.</p>
    <p class="copyright">
      Chess Vault © ${COPYRIGHT_YEAR} ${escapeHtml(COPYRIGHT)}, under the
      <a href="GPL-3.0.txt">GNU General Public License v3</a>.
      Source: <a href="${REPO_URL}" rel="noreferrer">${REPO_URL}</a>
    </p>

    <div class="controls">
      <span class="field">
        <input
          id="q"
          type="search"
          placeholder="Filter ${total} entries by name or licence…"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          enterkeyhint="done"
          data-1p-ignore
          data-form-type="other"
        />
        <button type="button" id="clear" aria-label="Clear search" hidden>&times;</button>
      </span>
    </div>
    <div class="controls chips">
      <button type="button" class="chip" data-group="">all <span class="n">${total}</span></button>
      ${chips}
    </div>
    <p id="count" aria-live="polite"></p>

${list}

    <script>
      (function () {
        var q = document.getElementById('q');
        var count = document.getElementById('count');
        var deps = Array.prototype.slice.call(document.querySelectorAll('.dep'));
        var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
        var group = '';

        function apply() {
          var term = q.value.trim().toLowerCase();
          var shown = 0;
          deps.forEach(function (d) {
            var ok =
              (!group || d.dataset.group === group) &&
              (!term ||
                d.dataset.name.indexOf(term) !== -1 ||
                d.dataset.license.toLowerCase().indexOf(term) !== -1);
            d.hidden = !ok;
            if (!ok) d.open = false;
            if (ok) shown++;
          });
          count.textContent = shown === deps.length ? '' : shown + ' of ' + deps.length;
          chips.forEach(function (c) {
            c.setAttribute('aria-pressed', String(c.dataset.group === group));
          });
        }
        var clear = document.getElementById('clear');
        function syncClear() { clear.hidden = q.value === ''; }
        q.addEventListener('input', function () { syncClear(); apply(); });
        clear.addEventListener('mousedown', function (e) { e.preventDefault(); });
        clear.addEventListener('click', function () {
          q.value = '';
          syncClear();
          apply();
          q.focus();
        });
        syncClear();
        chips.forEach(function (c) {
          c.addEventListener('click', function () {
            group = c.dataset.group === group ? '' : c.dataset.group;
            apply();
          });
        });
        apply();

        // Chromium's texts live in one file, fetched the first time any of
        // its rows is opened. Inlining 19 MB would make this page unusable
        // to serve a list almost nobody expands.
        var chromiumTexts = null;
        var pending = null;
        function fill(pre) {
          var at = Number(pre.dataset.lazy);
          pre.textContent = (chromiumTexts && chromiumTexts[at]) || 'Licence text unavailable.';
        }
        document.addEventListener('toggle', function (e) {
          var d = e.target;
          if (!d.open || !d.classList || !d.classList.contains('dep')) return;
          var pre = d.querySelector('pre[data-lazy]');
          if (!pre || pre.dataset.filled) return;
          pre.dataset.filled = '1';
          if (chromiumTexts) return fill(pre);
          pre.textContent = 'Loading…';
          pending = pending || fetch('chromium.json').then(function (r) { return r.json(); });
          pending.then(function (data) { chromiumTexts = data; fill(pre); })
                 .catch(function () { pre.textContent = 'Could not load the licence text.'; });
        }, true);
      })();
    </script>
  </body>
</html>
`;
}
/**
 * @param withChromium list Electron's Chromium components too. False for the
 * web and demo builds, which contain no Chromium — claiming otherwise would
 * describe something the visitor never received.
 */
export function licenses(withChromium = true): Plugin {
  let outDir = '';
  return {
    name: 'chess-vault:licenses',

    // One source of truth for the repository URL, injected the same way
    // `__DEMO__` is.
    config: () => ({ define: { __REPO_URL__: JSON.stringify(REPO_URL) } }),

    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },

    // Dev serves the same paths as a build, so the Settings link is not a
    // dead end until someone happens to run `vite build`.
    configureServer(server) {
      server.middlewares.use('/licenses', (req, res, next) => {
        const name = basename(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
        if (!name || name === 'index.html') {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(indexPage(texts(), collect(), withChromium ? chromium() : null));
          return;
        }
        if (name === 'dependencies.txt') {
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(dependencyNotice(collect()));
          return;
        }
        if (name === 'chromium.json') {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(chromium()?.texts ?? []));
          return;
        }
        if (name === 'GPL-3.0.txt') {
          res.setHeader('content-type', 'text/plain; charset=utf-8');
          res.end(readFileSync(OWN_LICENSE));
          return;
        }
        const file = resolve(SOURCE, name);
        if (!texts().includes(name) || !existsSync(file)) return next();
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },

    writeBundle() {
      const files = texts();
      const target = resolve(outDir, 'licenses');
      mkdirSync(target, { recursive: true });
      for (const name of files) copyFileSync(resolve(SOURCE, name), resolve(target, name));
      copyFileSync(OWN_LICENSE, resolve(target, 'GPL-3.0.txt'));

      const deps = collect();
      const chrome = withChromium ? chromium() : null;
      writeFileSync(resolve(target, 'dependencies.txt'), dependencyNotice(deps));
      if (chrome) {
        writeFileSync(resolve(target, 'chromium.json'), JSON.stringify(chrome.texts));
      }
      writeFileSync(resolve(target, 'index.html'), indexPage(files, deps, chrome));
      console.log(
        `licenses: ${ASSETS.length} assets + ${deps.length} packages` +
          (chrome ? ` + ${chrome.names.length} Chromium components` : ''),
      );
    },
  };
}

function texts(): string[] {
  return readdirSync(SOURCE)
    .filter((name) => name.endsWith('.txt') && statSync(resolve(SOURCE, name)).isFile())
    .sort();
}
