import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
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
 * The index page is GENERATED from THIRD-PARTY.md rather than written twice.
 * That file is the notice; a hand-kept copy of it would be the version that
 * goes stale.
 */

const repo = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = resolve(repo, 'licenses');
const NOTICE = resolve(repo, 'THIRD-PARTY.md');

const pkg = JSON.parse(readFileSync(resolve(repo, 'package.json'), 'utf8')) as {
  repository?: { url?: string };
};

/**
 * Where the source is offered. AGPLv3 §13 turns this from a courtesy into a
 * term: the demo serves pirouetti's pieces to strangers over a network, and
 * they are owed a way to the source. One value, read from package.json, so
 * the app and the generated page cannot disagree.
 */
export const REPO_URL = pkg.repository?.url ?? '';

const md = new MarkdownIt({ html: false, linkify: true });

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
 */
interface Dep {
  name: string;
  version: string;
  license: string;
  text: string | null;
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

function collect(): Dep[] {
  const root = readJson(resolve(repo, 'package.json'));
  const queue: { name: string; from: string }[] = edges(root).map((name) => ({
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

    out.push({ name, version: String(pkg.version ?? '?'), license, text });
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

function indexPage(files: string[]): string {
  const notice = md
    .render(readFileSync(NOTICE, 'utf8'))
    // The notice links `licenses/` as seen from the repository root. This
    // page IS that directory, so the prefix comes off — and a link to the
    // directory itself becomes a link to here, not an empty href.
    .replaceAll('href="licenses/"', 'href="."')
    .replaceAll('href="licenses/', 'href="');

  const list = files
    .map((name) => `      <li><a href="${name}">${name}</a></li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Licences — Chess Vault</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0 auto; padding: 2.5rem 1.25rem 5rem; max-width: 46rem;
        font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      }
      h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
      h2 { font-size: 1.15rem; margin: 2.25rem 0 .5rem; }
      h3 { font-size: 1rem; margin: 1.75rem 0 .5rem; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .875em; }
      table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; font-size: .9rem; }
      th, td { border: 1px solid rgba(128,128,128,.35); padding: .4rem .6rem; text-align: left; vertical-align: top; }
      ul.texts { padding-left: 1.2rem; }
      .lede { opacity: .75; }
    </style>
  </head>
  <body>
    <h1>Licences</h1>
    <p class="lede">
      The full text of every licence this app's bundled work is under. The
      source is at <a href="${REPO_URL}">${REPO_URL}</a>.
    </p>
    <ul class="texts">
${list}
      <li><a href="dependencies.txt">dependencies.txt</a> — every npm package
      this app depends on, with its own licence text and copyright line</li>
    </ul>
${notice}
  </body>
</html>
`;
}

export function licenses(): Plugin {
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
          res.end(indexPage(texts()));
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

      const deps = collect();
      writeFileSync(resolve(target, 'dependencies.txt'), dependencyNotice(deps));
      writeFileSync(resolve(target, 'index.html'), indexPage(files));
      console.log(`licenses: ${files.length} texts + ${deps.length} dependency notices`);
    },
  };
}

function texts(): string[] {
  return readdirSync(SOURCE)
    .filter((name) => name.endsWith('.txt') && statSync(resolve(SOURCE, name)).isFile())
    .sort();
}
