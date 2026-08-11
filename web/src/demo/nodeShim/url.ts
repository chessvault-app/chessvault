/**
 * `node:url`, only enough of it for `server/paths.ts` to resolve where it
 * thinks it lives. In the browser that answer is arbitrary — every path the
 * demo touches is inside the in-memory filesystem — so it only has to be
 * consistent.
 */
export function fileURLToPath(_url: string | URL): string {
  return '/app/server/paths.ts';
}

export function pathToFileURL(path: string): URL {
  return new URL(`file://${path}`);
}

export default { fileURLToPath, pathToFileURL };
