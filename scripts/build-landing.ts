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

// Pretendard, for the two pages at the root.
//
// They had a system stack, so their Latin was whatever the OS offered and
// their KOREAN — which is half of both pages — fell to Noto Sans KR or
// Apple SD Gothic Neo. The app draws both scripts in Pretendard, and the
// landing page's own stylesheet says the design is the app's; the one
// thing it was not matching was the typeface.
//
// Copied from node_modules at build time rather than committed, which is
// how the app gets the same files, and served from this origin rather
// than a CDN. The subset CSS is taken verbatim — it carries the OFL
// notice in its header, and its src urls are already relative to itself,
// so the pair of copies below lands the woff2 exactly where it looks.
//
// The dynamic subset, not the 2 MB single file: 92 chunks of which an
// English reader fetches one. The pages still render with the fonts
// absent — the system stack stays behind Pretendard in both — so opening
// web/landing/index.html straight off disk is unchanged.
const FONT_SRC = resolve(REPO_ROOT, 'node_modules/pretendard/dist/web/variable');
const fonts = resolve(SITE, 'fonts');
mkdirSync(fonts, { recursive: true });
copyFileSync(
  resolve(FONT_SRC, 'pretendardvariable-dynamic-subset.css'),
  resolve(fonts, 'pretendard.css'),
);
cpSync(resolve(FONT_SRC, 'woff2-dynamic-subset'), resolve(fonts, 'woff2-dynamic-subset'), {
  recursive: true,
});
// And the licence, beside the font it covers.
//
// The subset CSS opens by saying the OFL is "copied below". It is not —
// the header carries the copyright and a URL, and the file continues
// straight into @font-face. That is fine inside the app, whose generated
// licences page carries the full text; it was not fine here, where these
// pages serve the font from the site root and nothing at that level said
// what it was licensed under. The OFL asks to travel with the font, so it
// travels in the same directory.
copyFileSync(
  resolve(REPO_ROOT, 'node_modules/pretendard/dist/LICENSE.txt'),
  resolve(fonts, 'LICENSE.txt'),
);

// Screenshots are shared with the README rather than duplicated.
const shots = resolve(SITE, 'shots');
mkdirSync(shots, { recursive: true });
// .gif as well as .png, and that is a fix rather than a widening: the
// manual's Books page has shown a broken image since it was written,
// because it points at shots/book-to-board.gif and this loop only ever
// copied PNGs. Nothing failed — the build succeeded, the file simply was
// not there, and a 404 renders as an empty box. The recorded
// book-to-board interaction is one of the few things PRODUCT.md lists as
// evidence on hand, so it is worth carrying.
const SHOT_TYPES = ['.png', '.gif'];
for (const name of readdirSync(resolve(REPO_ROOT, 'docs/screenshots'))) {
  if (SHOT_TYPES.some((ext) => name.endsWith(ext))) {
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
console.log('  /fonts/      Pretendard, for the two pages at the root');
