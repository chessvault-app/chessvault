import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Ad-hoc sign the macOS app before the dmg is built.
 *
 * `mac.identity: null` tells electron-builder to skip signing, which is
 * the honest setting — there is no Apple Developer ID here, and a $99/yr
 * certificate is not a thing a personal vault should need. But it leaves
 * an Apple Silicon build with NO signature at all, and arm64 macOS will
 * not load unsigned code: the download quarantines the app, Gatekeeper
 * refuses it, and the message it shows is "Chess Vault is damaged and
 * can't be opened", which is a lie about a perfectly good download and
 * sends people to the Trash with it.
 *
 * An ad-hoc signature (`codesign -s -`) costs nothing and no account. It
 * does not make the app trusted — the first open is still right-click →
 * Open, or one `xattr -dr com.apple.quarantine`, both of which are in
 * desktop/README.md — but it turns "damaged, throw it away" into "from
 * an unidentified developer", which is a question the reader can answer.
 *
 * Not a substitute for notarisation. If this ever gets a Developer ID,
 * set `mac.identity` and delete this file.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep is deprecated for real signing and exactly right for this:
  // every nested helper and framework needs the same ad-hoc signature,
  // and there is no identity for the modern per-component flow to use.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`ad-hoc signed ${app}`);
}
