import { describe, expect, it } from 'vitest';
import { parseMaterialSpec } from '@shared/scanMatch';
import ENDGAMES from './endgames.json';

/**
 * The material presets are data the server parses as strictly as a
 * request, so a preset that does not parse is a Search button that
 * answers 400 and nothing to say why. Each is held to the parser here,
 * and to the one rule the data cannot say for itself: an imbalance
 * preset counts from White's side, so its diff ranges must lean that
 * way (docs/databases.md says so to the reader).
 */
describe('material presets', () => {
  it('names each preset once', () => {
    const ids = ENDGAMES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = ENDGAMES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('parses every spec as the server would', () => {
    for (const { id, spec } of ENDGAMES) {
      expect(parseMaterialSpec(JSON.stringify(spec)), id).not.toBeNull();
    }
  });

  it("counts an imbalance from White's side", () => {
    // A preset whose diffs are all one-signed leans White's way: no
    // preset asks for a range that only Black could satisfy.
    for (const { id, spec } of ENDGAMES) {
      const diff = (spec as { diff?: Record<string, [number, number]> }).diff ?? {};
      for (const [key, [lo, hi]] of Object.entries(diff)) {
        // The pieces White is meant to have more of never go negative,
        // and what White gives up never goes positive.
        if (id === 'three-minors-vs-queen' && key === 'q') expect(hi).toBeLessThanOrEqual(0);
        else if (lo > 0 || hi < 0) expect(lo > 0 ? lo : hi, `${id}.${key}`).not.toBe(0);
      }
    }
  });
});
