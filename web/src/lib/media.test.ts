import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WIDE_MQ } from './media';

/**
 * The `wide` variant is declared once in index.css and mirrored once in
 * media.ts, and the mirror selects whole render trees while the variant
 * selects what is drawn inside them. They parted once (the CSS lost a
 * branch, the JS kept it) and the phone pane switcher vanished at 1024px
 * portrait with nothing in its place. So the JS string is read off the CSS
 * here rather than trusted.
 */
describe('useWideLayout mirrors the CSS `wide` variant', () => {
  it('WIDE_MQ equals the media list inside @custom-variant wide', () => {
    const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
    const match = /@custom-variant\s+wide\s*\{\s*@media\s+([^{]+)\{/.exec(css);
    expect(match, 'index.css declares `wide` as a block-form @custom-variant with an @media inside').not.toBeNull();
    const fold = (s: string): string => s.replace(/\s+/g, ' ').trim();
    expect(fold(WIDE_MQ)).toBe(fold(match![1]!));
  });
});
