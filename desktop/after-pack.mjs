import { execFileSync } from 'node:child_process';
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two things the packager will not do on its own, in the order they have
 * to happen: put the server's dependency where the server can find it,
 * then sign what is now inside the app.
 */
export default async function afterPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir);

  /**
   * better-sqlite3, which extraResources silently refuses to carry.
   *
   * `release/server/node_modules/better-sqlite3` is where build-server.mjs
   * puts it and where Node looks for it from `server/index.mjs`. It never
   * arrived: app-builder-lib's copy filter opens with a hard rule —
   *
   *     if (relative === "node_modules") return false;
   *
   * — so a directory named exactly that, at the root of an extraResources
   * source, is dropped whatever `filter` says. No warning; the app simply
   * shipped without its database driver and died on launch with "Cannot
   * find package 'better-sqlite3'", which is a packaging bug wearing a
   * runtime error's clothes.
   *
   * Copied here instead, where the rule does not apply, rather than by
   * moving the server a directory deeper to fool the check: the layout
   * that main.mjs, build-server.mjs and the README all describe stays the
   * layout that ships.
   */
  const from = join(context.packager.info.projectDir, 'release', 'server', 'node_modules');
  const to = join(resources, 'server', 'node_modules');
  if (!existsSync(from)) {
    throw new Error(`afterPack: ${from} is missing — run desktop/build-server.mjs first`);
  }
  cpSync(from, to, { recursive: true, dereference: true });
  if (!existsSync(join(to, 'better-sqlite3', 'package.json'))) {
    throw new Error(`afterPack: better-sqlite3 did not land in ${to}`);
  }
  console.log(`server dependencies copied into ${to}`);

  /**
   * Ad-hoc signing, on macOS, AFTER that copy so the signature covers it.
   *
   * `mac.identity: null` skips signing, which is honest — there is no
   * Apple Developer ID here. But it leaves an Apple Silicon build with no
   * signature at all, and arm64 macOS will not load unsigned code: the
   * download is quarantined, Gatekeeper refuses it, and the message is
   * "Chess Vault is damaged and can't be opened" — a lie about a good
   * download that sends people to the Trash with it.
   *
   * An ad-hoc signature costs nothing and needs no account. It does not
   * make the app trusted: the first open is still right-click → Open, or
   * one `xattr -dr com.apple.quarantine`, both of which desktop/README.md
   * now explains. It turns "damaged, throw it away" into "from an
   * unidentified developer", which is a question a reader can answer.
   */
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${app}`);
}
