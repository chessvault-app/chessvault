/**
 * Assemble the published site: the landing page at the root, the demo app
 * under /app/.
 *
 * Kept separate from the Vite build because the landing page has no build
 * step at all — it is one self-contained HTML file. A page that greets
 * strangers should not be able to break because a bundler config changed.
 *
 *   npx tsx scripts/build-landing.ts     (after vite build --config web/vite.demo.config.ts)
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const APP_BUILD = resolve(REPO_ROOT, 'dist-demo');
const SITE = resolve(REPO_ROOT, 'dist-site');

if (!existsSync(resolve(APP_BUILD, 'index.html'))) {
  console.error('no demo build at dist-demo — run the vite demo build first');
  process.exit(1);
}

// A directory being served cannot be deleted on Windows, and the raw error
// is an unreadable EBUSY with a \?\ path. This has cost two debugging
// rounds already — both times spent looking for a stale build rather than a
// local http-server still holding the folder open.
try {
  rmSync(SITE, { recursive: true, force: true });
} catch (error) {
  console.error(
    `could not clear ${SITE} — something is holding it open.
` +
      'A local static server (npx http-server dist-site) will do this on Windows. ' +
      'Stop it and run again.',
  );
  throw error;
}
mkdirSync(SITE, { recursive: true });

// The app, one level down. Its base is relative, so it does not care.
cpSync(APP_BUILD, resolve(SITE, 'app'), { recursive: true });

copyFileSync(resolve(REPO_ROOT, 'web/landing/index.html'), resolve(SITE, 'index.html'));
copyFileSync(resolve(REPO_ROOT, 'web/landing/docs.html'), resolve(SITE, 'docs.html'));

// The docs used to live at /manual.html, and that address is in whatever
// links to it — a comment, a bookmark, a chat. The stub is generated rather
// than kept in web/landing/ because it is a fact about what this site USED
// to serve, not a page anyone edits: source holds two pages, the deploy
// holds three.
writeFileSync(
  resolve(SITE, 'manual.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chess Vault — docs</title>
    <link rel="canonical" href="https://chessvault-app.github.io/docs.html" />
    <meta http-equiv="refresh" content="0; url=docs.html" />
    <meta name="robots" content="noindex" />
  </head>
  <body>
    <p>The manual is now <a href="docs.html">the docs</a>.</p>
  </body>
</html>
`,
);

// Screenshots are shared with the README rather than duplicated.
const shots = resolve(SITE, 'shots');
mkdirSync(shots, { recursive: true });
for (const name of readdirSync(resolve(REPO_ROOT, 'docs/screenshots'))) {
  if (name.endsWith('.png')) {
    copyFileSync(resolve(REPO_ROOT, 'docs/screenshots', name), resolve(shots, name));
  }
}

// Jekyll would otherwise swallow anything starting with an underscore.
copyFileSync(resolve(REPO_ROOT, 'web/landing/index.html'), resolve(SITE, '404.html'));

const size = (dir: string): number => {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    total += entry.isDirectory() ? size(full) : statSync(full).size;
  }
  return total;
};

console.log(`site: ${SITE} (${(size(SITE) / 1024 / 1024).toFixed(1)} MB)`);
console.log('  /            landing page');
console.log('  /docs.html   the docs');
console.log('  /manual.html redirect to /docs.html');
console.log('  /app/        the demo');
console.log('  /shots/      screenshots');
