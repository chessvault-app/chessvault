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

/**
 * A colour scheme is three numbers: the hue everything neutral is tinted
 * towards, how strongly it is tinted, and the accent's hue.
 *
 * That is the whole model, and it is why a custom scheme costs nothing
 * extra — a preset is a named triple, and "custom" is the same triple with
 * the user holding the sliders. The semantic colours are deliberately not
 * part of it: green means solved in every scheme.
 */
export interface Scheme {
  /** 0–360. Everything neutral leans this way. */
  hue: number;
  /** 0–3. How far from grey the neutrals are pushed. */
  tint: number;
  /** 0–360. Buttons, links, the active nav. */
  accent: number;
}

export const SCHEME_PRESETS: { id: string; label: string; scheme: Scheme }[] = [
  { id: 'default', label: 'Slate', scheme: { hue: 264, tint: 1, accent: 240 } },
  { id: 'paper', label: 'Paper', scheme: { hue: 75, tint: 1.8, accent: 45 } },
  { id: 'forest', label: 'Forest', scheme: { hue: 150, tint: 1.6, accent: 155 } },
  { id: 'rose', label: 'Rose', scheme: { hue: 350, tint: 1.5, accent: 350 } },
  { id: 'midnight', label: 'Midnight', scheme: { hue: 265, tint: 2.4, accent: 275 } },
  { id: 'mono', label: 'Mono', scheme: { hue: 264, tint: 0, accent: 264 } },
];

/**
 * Which square castling is played on.
 *
 * 'king' — drop the king on g1/c1, where it lands. chess.com's current way.
 * 'rook' — drop the king on its own rook. Lichess, and chess.com before.
 *
 * Both are always LEGAL; this only decides which chessground offers, since
 * showing both means a click on the rook is ambiguous with capturing it in
 * the mind of someone who expects one or the other.
 */
export type CastleStyle = 'king' | 'rook';

export const CASTLE_STYLES: { id: CastleStyle; label: string }[] = [
  { id: 'king', label: 'Move the king two squares (g1)' },
  { id: 'rook', label: 'Move the king onto the rook (h1)' },
];

export const PIECE_SETS: { id: PieceSet; label: string }[] = [
  { id: 'cburnett', label: 'Cburnett' },
  { id: 'merida', label: 'Merida' },
  { id: 'chessnut', label: 'Chessnut' },
  { id: 'pirouetti', label: 'Pirouetti' },
];

/**
 * The move and capture samples, and what they sound like.
 *
 * Filenames are the generator's own (chessvault-app/chesssounds-gen), kept
 * exactly so a file can be traced back to the run that produced it. The
 * labels are what the setting shows, and they are not decoration: each was
 * assigned from the measured spectral centroid of that file, so "Bright"
 * really is brighter than "Standard" rather than being a guess about a
 * sound nobody could describe.
 *
 * `rotate` is the default and the reason the variations exist — a move
 * repeated fifty times in an analysis session should not sound like one
 * sample fired fifty times.
 */
export interface SoundChoice {
  id: string;
  label: string;
  file: string | null;
}

export const MOVE_SOUNDS: SoundChoice[] = [
  { id: 'rotate', label: 'Rotate through all', file: null },
  { id: 'deep', label: 'Deep', file: 'move-self-1.wav' }, //  919 Hz
  { id: 'standard', label: 'Standard', file: 'move-self.wav' }, //  984 Hz
  { id: 'bright', label: 'Bright', file: 'move-self-4.wav' }, // 1062 Hz
  { id: 'sharp', label: 'Sharp', file: 'move-self-2.wav' }, // 1156 Hz
  { id: 'long', label: 'Long', file: 'move-self-3.wav' }, //  54 ms
];

export const CAPTURE_SOUNDS: SoundChoice[] = [
  { id: 'rotate', label: 'Rotate through all', file: null },
  { id: 'deep', label: 'Deep', file: 'capture-3.wav' }, // 1737 Hz
  { id: 'standard', label: 'Standard', file: 'capture.wav' }, // 1907 Hz
  { id: 'bright', label: 'Bright', file: 'capture-6.wav' }, // 2083 Hz
  { id: 'sharp', label: 'Sharp', file: 'capture-8.wav' }, // 2186 Hz
  { id: 'short', label: 'Short', file: 'capture-7.wav' }, //  51 ms
];

interface PrefsState {
  boardTheme: BoardTheme;
  pieces: PieceSet;
  sound: boolean;
  /** 0–1. Applied as a gain, so 0 is silent without disabling the setting. */
  soundVolume: number;
  moveSound: string;
  captureSound: string;
  castleStyle: CastleStyle;
  /** Which preset is selected. */
  schemeId: string;
  scheme: Scheme;
  setBoardTheme: (t: BoardTheme) => void;
  setPieces: (p: PieceSet) => void;
  setSound: (on: boolean) => void;
  setSoundVolume: (v: number) => void;
  setMoveSound: (id: string) => void;
  setCaptureSound: (id: string) => void;
  setSchemeId: (id: string) => void;
  setCastleStyle: (style: CastleStyle) => void;
}

const apply = (boardTheme: BoardTheme, pieces: PieceSet): void => {
  const el = document.documentElement;
  if (boardTheme === 'default') delete el.dataset.board;
  else el.dataset.board = boardTheme;
  if (pieces === 'cburnett') delete el.dataset.pieces;
  else el.dataset.pieces = pieces;
};

/** Three custom properties; every token in index.css reads from them. */
const applyScheme = ({ hue, tint, accent }: Scheme): void => {
  const el = document.documentElement;
  el.style.setProperty('--ui-hue', String(hue));
  el.style.setProperty('--ui-tint', String(tint));
  el.style.setProperty('--accent-hue', String(accent));
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      boardTheme: 'default',
      pieces: 'cburnett',
      sound: true,
      soundVolume: 0.7,
      moveSound: 'rotate',
      captureSound: 'rotate',
      castleStyle: 'king',
      schemeId: 'default',
      scheme: SCHEME_PRESETS[0]!.scheme,
      setBoardTheme: (boardTheme) => {
        apply(boardTheme, get().pieces);
        set({ boardTheme });
      },
      setPieces: (pieces) => {
        apply(get().boardTheme, pieces);
        set({ pieces });
      },
      setSound: (sound) => set({ sound }),
      setSoundVolume: (soundVolume) => set({ soundVolume: Math.min(1, Math.max(0, soundVolume)) }),
      setMoveSound: (moveSound) => set({ moveSound }),
      setCaptureSound: (captureSound) => set({ captureSound }),
      setCastleStyle: (castleStyle) => set({ castleStyle }),
      setSchemeId: (schemeId) => {
        const preset = SCHEME_PRESETS.find((p) => p.id === schemeId);
        const scheme = preset ? preset.scheme : get().scheme;
        applyScheme(scheme);
        set({ schemeId, scheme });
      },
    }),
    {
      name: 'chess-vault:prefs',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Everything the store paints with, not just the board — leaving
        // the scheme out here meant a rehydrate could put the colours back
        // to default while the setting still said otherwise.
        apply(state.boardTheme, state.pieces);
        applyScheme(state.scheme);
      },
    },
  ),
);

/** Applied before React mounts so the board never flashes the default skin. */
export function initPrefs(): void {
  const { boardTheme, pieces, scheme } = usePrefs.getState();
  apply(boardTheme, pieces);
  applyScheme(scheme);
}
