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
  /** Which preset is selected. */
  schemeId: string;
  scheme: Scheme;
  /** Raw CSS, applied last, for a theme the presets do not cover. */
  customCss: string;
  setBoardTheme: (t: BoardTheme) => void;
  setPieces: (p: PieceSet) => void;
  setSound: (on: boolean) => void;
  setSchemeId: (id: string) => void;
  setCustomCss: (css: string) => void;
}

const apply = (boardTheme: BoardTheme, pieces: PieceSet): void => {
  const el = document.documentElement;
  if (boardTheme === 'default') delete el.dataset.board;
  else el.dataset.board = boardTheme;
  if (pieces === 'cburnett') delete el.dataset.pieces;
  else el.dataset.pieces = pieces;
};

/**
 * Whatever the user wrote, in a style element of its own.
 *
 * Last in the document, so it outranks everything the app ships — which
 * is the point: a theme nobody anticipated should not need the app to
 * have anticipated it.
 */
const CUSTOM_CSS_ID = 'chess-vault-custom-css';

const applyCustomCss = (css: string): void => {
  let el = document.getElementById(CUSTOM_CSS_ID);
  if (!css.trim()) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = CUSTOM_CSS_ID;
    document.head.append(el);
  }
  el.textContent = css;
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
      schemeId: 'default',
      scheme: SCHEME_PRESETS[0]!.scheme,
      customCss: '',
      setBoardTheme: (boardTheme) => {
        apply(boardTheme, get().pieces);
        set({ boardTheme });
      },
      setPieces: (pieces) => {
        apply(get().boardTheme, pieces);
        set({ pieces });
      },
      setSound: (sound) => set({ sound }),
      setSchemeId: (schemeId) => {
        const preset = SCHEME_PRESETS.find((p) => p.id === schemeId);
        const scheme = preset ? preset.scheme : get().scheme;
        applyScheme(scheme);
        set({ schemeId, scheme });
      },
      setCustomCss: (customCss) => {
        applyCustomCss(customCss);
        set({ customCss });
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
        applyCustomCss(state.customCss);
      },
    },
  ),
);

/** Applied before React mounts so the board never flashes the default skin. */
export function initPrefs(): void {
  const { boardTheme, pieces, scheme, customCss } = usePrefs.getState();
  apply(boardTheme, pieces);
  applyScheme(scheme);
  applyCustomCss(customCss);
}
