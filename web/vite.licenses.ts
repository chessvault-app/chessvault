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
      writeFileSync(resolve(target, 'index.html'), indexPage(files));
    },
  };
}

function texts(): string[] {
  return readdirSync(SOURCE)
    .filter((name) => name.endsWith('.txt') && statSync(resolve(SOURCE, name)).isFile())
    .sort();
}
