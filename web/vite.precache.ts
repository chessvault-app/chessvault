import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The list the service worker warms its cache from (web/public/sw.js).
 *
 * Every route is its own chunk, fetched the first time it is opened, so
 * a home-screen launch with no network had the shell and nothing behind
 * any page not visited in this build. The worker cannot know the chunk
 * names, since they carry the build's hashes; this writes them beside
 * the build as `precache.json`, the page itself first.
 *
 * Read from the output folder once it is written, not from the bundle
 * object: rolldown hands generateBundle nine chunks it then drops as
 * empty (a piece set is CSS with no script), and a list naming a file
 * that is not there is a failed fetch on every install. Scripts and
 * styles only, 3.7 MB of the demo build: the font subsets are another
 * 100 files fetched by the glyphs a page uses, and the engine, the piece
 * images and the sounds are too large to pull down on every install of
 * every version.
 */
export function precache(): Plugin {
  let outDir = '';
  return {
    name: 'precache-list',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = ['/'];
      for (const name of readdirSync(join(outDir, 'assets'))) {
        if (/\.(js|css)$/.test(name)) files.push(`/assets/${name}`);
      }
      writeFileSync(join(outDir, 'precache.json'), JSON.stringify(files));
    },
  };
}
