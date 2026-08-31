/**
 * Diagram images the page already holds, keyed by book and file.
 *
 * A book's evidence images are `<img src>`, and an image src is a resource
 * load rather than a fetch — so the static demo, whose whole backend is a
 * patched `window.fetch`, could serve every route about a puzzle and not
 * the picture of the page it came from. The evidence pane opened on a
 * broken image.
 *
 * So the demo hands its images over as object URLs at boot and
 * `diagramUrl` looks here first. Empty in every other build: the demo
 * module is the only thing that writes to it, and that module is folded
 * out of a normal build entirely (`__DEMO__` in web/vite.config.ts), so
 * this is one Map lookup that always misses and a Map that stays empty.
 */
const local = new Map<string, string>();

const keyOf = (slug: string, file: string): string => `${slug}/${file}`;

/** Called by the demo backend with an object URL for the bytes it holds. */
export function registerDiagram(slug: string, file: string, url: string): void {
  local.set(keyOf(slug, file), url);
}

export function localDiagram(slug: string, file: string): string | null {
  return local.get(keyOf(slug, file)) ?? null;
}
