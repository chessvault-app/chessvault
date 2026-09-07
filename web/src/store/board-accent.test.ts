import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOARD_ACCENT } from './prefs';

/**
 * BOARD_ACCENT mirrors each preset's dark square in index.css. The two are
 * written twice because one is CSS and one is a number the scheme knob
 * needs before any element exists; this holds them together the way
 * media.test.ts holds the layout query to its CSS twin.
 */
describe('BOARD_ACCENT', () => {
  const css = readFileSync(resolve(__dirname, '..', 'index.css'), 'utf-8');
  const darkOf = (id: string): { hue: number; chroma: number } | null => {
    const block = css.match(new RegExp(String.raw`\[data-board='${id}'\]\s*\{([^}]*)\}`));
    const m = block?.[1]?.match(/--board-dark:\s*oklch\([\d.]+%\s+([\d.]+)\s+([\d.]+)\)/);
    return m ? { chroma: Number(m[1]), hue: Number(m[2]) } : null;
  };
  for (const [id, accent] of Object.entries(BOARD_ACCENT)) {
    if (id === 'default') continue;
    it(`${id} seeds its own dark square`, () => {
      expect(darkOf(id)).toEqual({ hue: accent.hue, chroma: accent.chroma });
    });
  }
});
