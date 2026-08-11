/**
 * The `node:path` surface the vault routes use, in posix only.
 *
 * The demo's filesystem has one separator and no drive letters, so this can
 * be far simpler than the real thing — but `sep` must still be exported,
 * because the routes split listing paths on it to build ids.
 */

export const sep = '/';

export function resolve(...parts: string[]): string {
  const stack: string[] = [];
  for (const part of parts) {
    if (part.startsWith('/')) stack.length = 0;
    for (const segment of part.split(/[\\/]+/)) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') stack.pop();
      else stack.push(segment);
    }
  }
  return `/${stack.join('/')}`;
}

export const join = resolve;

export function dirname(path: string): string {
  const at = resolve(path).split('/');
  at.pop();
  return at.join('/') || '/';
}

export function basename(path: string, ext?: string): string {
  const name = resolve(path).split('/').pop() ?? '';
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

export default { sep, resolve, join, dirname, basename, extname };
