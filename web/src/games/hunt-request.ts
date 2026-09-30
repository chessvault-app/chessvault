import { mirrorMaterialSpec, type MatchMode } from '@shared/scanMatch';
import type { MotifSide } from '@shared/scanMotif';
import type { CustomSpec } from './CustomMaterialWindow';
import ENDGAMES from './endgames.json';
import MOTIFS from './motifs.json';
import STRUCTURES from './structures.json';

/**
 * What a Databases tab hunt asks for of its own (DatabaseGames' runHunt
 * sets these after the database, the filters and the box), stated apart
 * so every kind can be held to it without rendering the page.
 *
 * Each kind keeps its draft while another is up: the Motif list always
 * holds a pick and the material select a preset, whichever kind is
 * showing. So the kind alone says which of them the request carries.
 * A request built by asking for the Motif list's entry sent that entry
 * for every Material search from 0.8.2 through 0.11.4: the Isolated
 * queen's pawn, unless another pattern or a pawn structure had been
 * picked there.
 */
export type HuntKind = 'position' | 'material' | 'motif';

/** The hunt controls as they stand, every kind's knobs at once. */
export interface HuntControls {
  kind: HuntKind;
  /** Position: the FEN as typed, or as the setup board handed it over,
      and how closely to match it. */
  fen: string;
  rung: MatchMode;
  /** Material: a preset (written from White's side, mirrored for
      Black), or 'custom' with the editor's spec, which names its sides
      itself; and how long it must hold, in plies. */
  presetId: string;
  materialSide: 'white' | 'black';
  customSpec: CustomSpec | null;
  heldPlies: number;
  /** Motif: the list's pick and its two knobs, which only some motifs
      have (motifs.json says which). */
  motifId: string;
  motifSide: MotifSide;
  motifHeld: number;
}

/**
 * The Motif list's pick, across its two files: a named structure
 * (structures.json, a pawns-only sketch) or a pattern motif
 * (motifs.json, a predicate the server replays). One id names one entry
 * across both, and an id that names neither is the first pattern.
 */
export function motifListPick(
  id: string,
):
  | { structure: (typeof STRUCTURES)[number]; motif: null }
  | { structure: null; motif: (typeof MOTIFS)[number] } {
  const structure = STRUCTURES.find((s) => s.id === id);
  if (structure) return { structure, motif: null };
  return { structure: null, motif: MOTIFS.find((m) => m.id === id) ?? MOTIFS[0]! };
}

/**
 * The request's own params for the kind picked, in the order they are
 * set; null when there is nothing to run, which is only a Custom…
 * material pick with no spec (its Search button is disabled then too).
 */
export function huntKindParams(controls: HuntControls): [string, string][] | null {
  if (controls.kind === 'position') {
    const params: [string, string][] = [['fen', controls.fen.trim()]];
    if (controls.rung !== 'exact') params.push(['match', controls.rung]);
    return params;
  }
  if (controls.kind === 'motif') {
    const { structure, motif } = motifListPick(controls.motifId);
    // A named structure is a pawn sketch on the structure rung —
    // the editor handoff's own shape, with the sketch as data.
    if (structure) {
      return [
        ['fen', structure.fen],
        ['match', 'structure'],
      ];
    }
    // The knobs a motif does not have are sent at their neutral
    // values, which is what the server would default them to.
    return [
      [
        'motif',
        JSON.stringify({
          id: motif.id,
          side: motif.side ? controls.motifSide : 'either',
          stable: motif.held ? controls.motifHeld : 1,
        }),
      ],
    ];
  }
  const preset = ENDGAMES.find((p) => p.id === controls.presetId) ?? ENDGAMES[0]!;
  const material =
    controls.presetId === 'custom'
      ? controls.customSpec
      : controls.materialSide === 'black'
        ? mirrorMaterialSpec(preset.spec)
        : preset.spec;
  if (!material) return null;
  return [['material', JSON.stringify({ ...material, stable: controls.heldPlies })]];
}
