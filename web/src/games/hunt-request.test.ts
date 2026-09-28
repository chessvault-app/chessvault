import { describe, expect, it } from 'vitest';
import type { CustomSpec } from './CustomMaterialWindow';
import ENDGAMES from './endgames.json';
import MOTIFS from './motifs.json';
import STRUCTURES from './structures.json';
import { huntKindParams, type HuntControls } from './hunt-request';

/**
 * What a Databases tab hunt sends for each kind. The controls start as
 * the pane's do (the first preset, the first motif, nothing typed), and
 * each case moves only what it is about: every kind's draft stays put
 * while another kind is up, which is how a Material search came to
 * carry the Motif list's pick from 0.8.2 through 0.11.4.
 */
const controls = (moved: Partial<HuntControls>): HuntControls => ({
  kind: 'position',
  fen: '',
  rung: 'exact',
  presetId: ENDGAMES[0]!.id,
  materialSide: 'white',
  customSpec: null,
  heldPlies: 1,
  motifId: MOTIFS[0]!.id,
  motifSide: 'either',
  motifHeld: MOTIFS[0]!.stable,
  ...moved,
});

const FEN = '8/8/4k3/8/2R5/8/4K3/8 w - - 0 1';
const ROOK = ENDGAMES.find((p) => p.id === 'rook')!.spec;

describe('a position hunt', () => {
  it('sends the FEN trimmed, and no rung for the exact one', () => {
    expect(huntKindParams(controls({ fen: `  ${FEN} ` }))).toEqual([['fen', FEN]]);
  });

  it('names a relaxed rung after the FEN', () => {
    expect(huntKindParams(controls({ fen: FEN, rung: 'structure' }))).toEqual([
      ['fen', FEN],
      ['match', 'structure'],
    ]);
  });
});

describe('a material hunt', () => {
  it("sends the preset as written, from White's side", () => {
    expect(huntKindParams(controls({ kind: 'material', presetId: 'queen-vs-rook' }))).toEqual([
      [
        'material',
        JSON.stringify({
          white: { n: [0, 0], b: [0, 0], r: [0, 0], q: [1, 1] },
          black: { n: [0, 0], b: [0, 0], r: [1, 1], q: [0, 0] },
          stable: 1,
        }),
      ],
    ]);
  });

  it('mirrors the preset for Black: the sides swap and a difference flips', () => {
    expect(
      huntKindParams(controls({ kind: 'material', presetId: 'queen-vs-rook', materialSide: 'black' })),
    ).toEqual([
      [
        'material',
        JSON.stringify({
          white: { n: [0, 0], b: [0, 0], r: [1, 1], q: [0, 0] },
          black: { n: [0, 0], b: [0, 0], r: [0, 0], q: [1, 1] },
          stable: 1,
        }),
      ],
    ]);
    expect(
      huntKindParams(controls({ kind: 'material', presetId: 'queen-up', materialSide: 'black' })),
    ).toEqual([['material', JSON.stringify({ diff: { q: [-9, -1] }, stable: 1 })]]);
  });

  it('sends a custom spec as the editor built it, whatever side the presets were on', () => {
    const customSpec: CustomSpec = { white: { r: [1, 1] }, black: { q: [1, 1] } };
    expect(
      huntKindParams(controls({ kind: 'material', presetId: 'custom', customSpec, materialSide: 'black' })),
    ).toEqual([['material', JSON.stringify({ white: { r: [1, 1] }, black: { q: [1, 1] }, stable: 1 })]]);
  });

  it('has nothing to run for Custom… before the editor built a spec', () => {
    expect(huntKindParams(controls({ kind: 'material', presetId: 'custom' }))).toBeNull();
  });

  it("sends the material, not the Motif list's default pick", () => {
    // What shipped instead was motif={"id":"iqp","side":"either","stable":8}.
    expect(huntKindParams(controls({ kind: 'material' }))?.map(([key]) => key)).toEqual(['material']);
  });

  it('sends the material after a pawn structure was picked in the Motif list', () => {
    // The case that broke: a structure picked, then Search by moved to
    // Material, sent the structure's sketch on the structure rung.
    expect(huntKindParams(controls({ kind: 'material', motifId: 'carlsbad', presetId: 'rook' }))).toEqual([
      ['material', JSON.stringify({ ...ROOK, stable: 1 })],
    ]);
  });
});

describe('a motif hunt', () => {
  it('sends the pattern with its side and how long it must hold', () => {
    expect(
      huntKindParams(controls({ kind: 'motif', motifId: 'passed-pawn', motifSide: 'black', motifHeld: 16 })),
    ).toEqual([['motif', JSON.stringify({ id: 'passed-pawn', side: 'black', stable: 16 })]]);
  });

  it('sends a knob the motif does not have at its neutral value', () => {
    // Opposite-coloured bishops is nobody's; a Greek gift is a move,
    // not a board that holds.
    expect(
      huntKindParams(controls({ kind: 'motif', motifId: 'opposite-bishops', motifSide: 'white', motifHeld: 8 })),
    ).toEqual([['motif', JSON.stringify({ id: 'opposite-bishops', side: 'either', stable: 8 })]]);
    expect(
      huntKindParams(controls({ kind: 'motif', motifId: 'greek-gift', motifSide: 'white', motifHeld: 16 })),
    ).toEqual([['motif', JSON.stringify({ id: 'greek-gift', side: 'white', stable: 1 })]]);
  });

  it('sends a named structure as its sketch on the structure rung', () => {
    const carlsbad = STRUCTURES.find((s) => s.id === 'carlsbad')!;
    expect(huntKindParams(controls({ kind: 'motif', motifId: 'carlsbad' }))).toEqual([
      ['fen', carlsbad.fen],
      ['match', 'structure'],
    ]);
  });

  it('runs while the material draft is a Custom… with no spec', () => {
    expect(huntKindParams(controls({ kind: 'motif', presetId: 'custom' }))).toEqual([
      ['motif', JSON.stringify({ id: 'iqp', side: 'either', stable: 8 })],
    ]);
  });
});

describe('the held-for knobs', () => {
  it("are each their own kind's, never the other's", () => {
    for (const plies of [1, 8, 16]) {
      expect(
        huntKindParams(controls({ kind: 'material', presetId: 'rook', heldPlies: plies, motifHeld: 99 })),
      ).toEqual([['material', JSON.stringify({ ...ROOK, stable: plies })]]);
      expect(
        huntKindParams(controls({ kind: 'motif', motifId: 'iqp', motifHeld: plies, heldPlies: 99 })),
      ).toEqual([['motif', JSON.stringify({ id: 'iqp', side: 'either', stable: plies })]]);
    }
  });
});

describe('every kind, whatever the other drafts hold', () => {
  it("sends its own params and none of another kind's", () => {
    const structures = new Set(STRUCTURES.map((s) => s.id));
    for (const motifId of [...MOTIFS.map((m) => m.id), ...structures]) {
      for (const { id: presetId } of ENDGAMES) {
        const at = (kind: HuntControls['kind']) =>
          huntKindParams(controls({ kind, motifId, presetId, fen: FEN, rung: 'files' }));
        expect(at('position'), motifId).toEqual([
          ['fen', FEN],
          ['match', 'files'],
        ]);
        expect(at('material')?.map(([key]) => key), `${motifId} under ${presetId}`).toEqual(['material']);
        expect(at('motif')?.map(([key]) => key), motifId).toEqual(
          structures.has(motifId) ? ['fen', 'match'] : ['motif'],
        );
      }
    }
  });
});
