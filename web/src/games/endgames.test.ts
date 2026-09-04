import { describe, expect, it } from 'vitest';
import { isSymmetricMaterial, parseMaterialSpec } from '@shared/scanMatch';
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

  it('knows which presets are symmetric, so only an imbalance shows a side', () => {
    // Written from White's side and mirrored on request; the symmetric
    // ones read the same either way and take no side. A new preset
    // lands in one list or the other, on purpose.
    const symmetric = ENDGAMES.filter((e) => isSymmetricMaterial(e.spec)).map((e) => e.id);
    expect(symmetric).toEqual([
      'pawn',
      'knight',
      'bishop',
      'bishop-vs-knight',
      'rook',
      'double-rook',
      'rook-bishop',
      'rook-knight',
      'queen',
      'queenless-middlegame',
      'heavy-pieces',
    ]);
  });
});
