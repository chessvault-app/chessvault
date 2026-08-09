import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-device display preferences (Settings > Appearance). Deliberately
 * localStorage, not vault config: the phone can run a green board while
 * the desktop stays walnut — these describe the device, not the chess.
 */

export type BoardTheme = 'default' | 'green' | 'brown' | 'blue' | 'slate';
export type PieceSet = 'cburnett' | 'merida' | 'chessnut' | 'pirouetti';

export const BOARD_THEMES: { id: BoardTheme; label: string }[] = [
  { id: 'default', label: 'Walnut (adaptive)' },
  { id: 'green', label: 'Tournament green' },
  { id: 'brown', label: 'Classic brown' },
  { id: 'blue', label: 'Ocean' },
  { id: 'slate', label: 'Slate' },
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
  { id: 'cburnett', label: 'Cburnett' },
  { id: 'merida', label: 'Merida' },
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'pirouetti', label: 'Pirouetti' },
];

interface PrefsState {
  boardTheme: BoardTheme;
  pieces: PieceSet;
  sound: boolean;
  setBoardTheme: (t: BoardTheme) => void;
  setPieces: (p: PieceSet) => void;
  setSound: (on: boolean) => void;
}

const apply = (boardTheme: BoardTheme, pieces: PieceSet): void => {
  const el = document.documentElement;
  if (boardTheme === 'default') delete el.dataset.board;
  else el.dataset.board = boardTheme;
  if (pieces === 'cburnett') delete el.dataset.pieces;
  else el.dataset.pieces = pieces;
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      boardTheme: 'default',
      pieces: 'cburnett',
      sound: true,
      setBoardTheme: (boardTheme) => {
        apply(boardTheme, get().pieces);
        set({ boardTheme });
      },
      setPieces: (pieces) => {
        apply(get().boardTheme, pieces);
        set({ pieces });
      },
      setSound: (sound) => set({ sound }),
    }),
    {
      name: 'chess-vault:prefs',
      onRehydrateStorage: () => (state) => {
        if (state) apply(state.boardTheme, state.pieces);
      },
    },
  ),
);

/** Applied before React mounts so the board never flashes the default skin. */
export function initPrefs(): void {
  const { boardTheme, pieces } = usePrefs.getState();
  apply(boardTheme, pieces);
}
