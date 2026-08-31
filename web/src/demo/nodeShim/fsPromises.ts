import { readdirSync, statSync } from './fs.ts';

/**
 * `node:fs/promises`, as much of it as one route needs.
 *
 * `server/storage.ts` is the Settings card that says what each part of the
 * vault takes on disk, and it is the only module in the app that reaches
 * for the promise-shaped fs. Without this the demo answered /api/storage
 * with a 404 and the card simply did not appear — so the one screen that
 * explains what a vault is made of was missing from the app most people
 * meet first.
 *
 * The synchronous shim beside this does the work; these only put its
 * answers behind a promise. Everything else fs/promises has is absent on
 * purpose, the way the Buffer shim is: a route reaching for something not
 * here should fail where it is written rather than be handed a quietly
 * wrong answer.
 */

export async function readdir(
  path: string,
  options?: { withFileTypes?: boolean },
): Promise<ReturnType<typeof readdirSync>> {
  return readdirSync(path, options);
}

export async function stat(path: string): Promise<ReturnType<typeof statSync>> {
  return statSync(path);
}

export default { readdir, stat };
