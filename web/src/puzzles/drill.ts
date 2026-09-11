import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import type { Color } from 'chessops/types';
import { parseUci } from 'chessops/util';
import { parseMaterialSpec } from '@shared/scanMatch';
import { drillable } from '@shared/endgameDrill';
import ENDGAMES from '@/games/endgames.json';
import { draftToSpec, type CustomDraft } from '@/games/CustomMaterialWindow';

/**
 * The endgame drill's own arithmetic, kept out of the page so it can be
 * tested without one: which classes are offered, what a class asks the
 * server for, and how a position on the board is read.
 *
 * The classes are the games hunt's material presets (endgames.json),
 * data the drill never names in code; a preset is offered when its
 * minimum material fits under Syzygy's seven men, which is the same rule
 * the server's draw applies (shared/endgameDrill.ts). A "Custom
 * material" class rides beside them, built in the hunt's own editor.
 */

/** The class id that stands for the custom editor's spec. */
export const CUSTOM_CLASS = 'custom';

/** Where this device keeps the custom material it last drilled: a
    draft of the editor's picks, not a spec, so reopening the window
    shows the choices that were made. */
const CUSTOM_KEY = 'vault:endgame-drill:custom';

export interface DrillPreset {
  id: string;
  label: string;
  spec: unknown;
}

/** The presets a tablebase can hold, in the order the file lists them. */
export const DRILL_PRESETS: DrillPreset[] = ENDGAMES.filter((preset) => {
  const spec = parseMaterialSpec(JSON.stringify(preset.spec));
  return spec !== null && drillable(spec);
});

/** The English label for a class id, which is `t()`'s key. */
export function classLabel(id: string): string {
  if (id === CUSTOM_CLASS) return 'Custom material';
  return DRILL_PRESETS.find((p) => p.id === id)?.label ?? id;
}

export function readCustomDraft(): CustomDraft {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) return JSON.parse(raw) as CustomDraft;
  } catch {
    // Unreadable or absent: an empty draft.
  }
  return { white: {}, black: {} };
}

export function writeCustomDraft(draft: CustomDraft): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(draft));
  } catch {
    // A full or blocked store loses only the convenience of a remembered draft.
  }
}

/**
 * What the draw route is asked for, as the JSON it parses, or null for
 * a class this device has nothing for: an unknown id, or a custom draft
 * with no counts picked.
 */
export function specFor(classId: string): string | null {
  if (classId === CUSTOM_CLASS) {
    const spec = draftToSpec(readCustomDraft());
    return spec ? JSON.stringify(spec) : null;
  }
  const preset = DRILL_PRESETS.find((p) => p.id === classId);
  return preset ? JSON.stringify(preset.spec) : null;
}

export interface DrillPosition {
  fen: string;
  /** chessground dests for the side to move. */
  dests: Map<string, string[]>;
  check: boolean;
  turn: Color;
  lastMove?: [string, string];
}

/** A FEN as the board draws it; null for one chessops refuses. */
export function positionOf(fen: string, lastMove?: [string, string]): DrillPosition | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  if (pos.isErr) return null;
  return {
    fen,
    dests: chessgroundDests(pos.value),
    check: pos.value.isCheck(),
    turn: pos.value.turn,
    ...(lastMove && { lastMove }),
  };
}

/** The two squares a UCI move names, for the board's last-move mark. */
export const squaresOf = (uci: string): [string, string] => [uci.slice(0, 2), uci.slice(2, 4)];

/**
 * The position one legal move leaves, or null where the FEN or the move
 * is refused. The server answers a held move with the position after
 * the defender's reply; the bottom bar walks every ply, so the one in
 * between is rebuilt here from the solver's own move.
 */
export function afterMove(fen: string, uci: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.value);
  const move = parseUci(uci);
  if (pos.isErr || !move || !pos.value.isLegal(move)) return null;
  pos.value.play(move);
  return makeFen(pos.value.toSetup());
}
