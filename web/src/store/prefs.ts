import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-device display preferences (Settings > Appearance). Deliberately
 * localStorage, not vault config: the phone can run a green board while
 * the desktop stays walnut — these describe the device, not the chess.
 */

export type BoardTheme =
  | 'default'
  | 'green'
  | 'brown'
  | 'blue'
  | 'slate'
  | 'lavender'
  | 'rosewood'
  | 'charcoal';
export type PieceSet =
  | 'cburnett'
  | 'merida'
  | 'chessnut'
  | 'pirouetti'
  | 'fantasy'
  | 'spatial'
  | 'celtic'
  | 'kiwen-suwi'
  | 'mpchess'
  | 'rhosgfx';

export const BOARD_THEMES: { id: BoardTheme; label: string }[] = [
  { id: 'default', label: 'Walnut (adaptive)' },
  { id: 'green', label: 'Tournament green' },
  { id: 'brown', label: 'Classic brown' },
  { id: 'blue', label: 'Ocean' },
  { id: 'slate', label: 'Slate' },
  { id: 'lavender', label: 'Lavender' },
  { id: 'rosewood', label: 'Rosewood' },
  { id: 'charcoal', label: 'Charcoal' },
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
  /**
   * 0–1. How far the accent is from grey; 1 unless said otherwise.
   *
   * Optional because it arrived after people had schemes saved, and a
   * stored scheme without it means the accent it has always had.
   */
  accentTint?: number;
  /**
   * Take the DARK theme's page to black and leave its panels grey.
   *
   * The other three numbers are hue and chroma; this one is lightness, and
   * it is a flag rather than a fourth number because there is one useful
   * answer and not a range: the ladder below the surfaces has to keep its
   * steps or a card stops reading as a card (see index.css), so "how
   * black" is not a knob anyone can usefully turn — it is a different
   * ladder, drawn once. Nothing in the light theme is affected: a black
   * page is a dark-theme idea.
   */
  ink?: boolean;
}

export const SCHEME_PRESETS: { id: string; label: string; scheme: Scheme }[] = [
  { id: 'default', label: 'Slate', scheme: { hue: 264, tint: 1, accent: 240 } },
  { id: 'paper', label: 'Paper', scheme: { hue: 75, tint: 1.8, accent: 45 } },
  { id: 'forest', label: 'Forest', scheme: { hue: 150, tint: 1.6, accent: 155 } },
  { id: 'rose', label: 'Rose', scheme: { hue: 350, tint: 1.5, accent: 350 } },
  { id: 'midnight', label: 'Midnight', scheme: { hue: 265, tint: 2.4, accent: 275 } },
  { id: 'mono', label: 'Mono', scheme: { hue: 264, tint: 0, accent: 264 } },
  // Mono greys the panels and keeps a blue button; this greys that too.
  { id: 'greyscale', label: 'Greyscale', scheme: { hue: 264, tint: 0, accent: 264, accentTint: 0 } },
  // Grey panels on a black page, and the app's own blue on top of them —
  // Mono's neutrals with the default accent rather than Mono's own, which
  // leans violet. The one preset that changes lightness as well as hue.
  // Named Ink and not Black: labels are the translation keys themselves
  // (see lib/i18n), and 'Black' is already the chess colour — a scheme
  // called that would advertise itself in Korean as the black pieces.
  // It also puts it in the family the others are named from: Paper,
  // Slate, Ink are all things you write on or with.
  { id: 'ink', label: 'Ink', scheme: { hue: 264, tint: 0, accent: 240, ink: true } },
];

/**
 * Which square castling is played on.
 *
 * 'king' — drop the king on g1/c1, where it lands. chess.com's current way.
 * 'rook' — drop the king on its own rook. Lichess, and chess.com before.
 *
 * Exactly one is offered AND accepted (chessground prunes the rook square
 * for 'king'; Board prunes g1/c1 for 'rook'): showing both makes a click
 * on the rook ambiguous with capturing it in the mind of someone who
 * expects one or the other, and accepting the unchosen one quietly
 * defeats having chosen.
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
  { id: 'fantasy', label: 'Fantasy' },
  { id: 'spatial', label: 'Spatial' },
  { id: 'celtic', label: 'Celtic' },
  { id: 'kiwen-suwi', label: 'Kiwen-suwi' },
  { id: 'mpchess', label: 'MPChess' },
  { id: 'rhosgfx', label: 'RhosGFX' },
];

/**
 * The move and capture samples, and what they sound like.
 *
 * Filenames are the generator's own (chessvault-app/chess-sounds-gen), kept
 * exactly so a file can be traced back to the run that produced it — which
 * is also why `move-opponent-*` appear here despite the app drawing no
 * distinction between whose move it is. They are simply more takes.
 *
 * `rotate` plays a different take each time, so a long analysis does not
 * sound like one sample fired fifty times. It is not the default — a chosen
 * sound is, because a sound that changes on every move is a stronger
 * preference than most people want by default.
 */
export interface SoundChoice {
  id: string;
  /** Position in the list, 1-based. Null is the rotating option. */
  take: number | null;
  file: string | null;
}

/**
 * Numbered rather than named: with ten takes of one knock, an adjective per
 * take would be inventing distinctions nobody can hear.
 *
 * The first entry is the default, so the order is chosen rather than
 * measured — number one is the one picked by ear. The rest run darkest to
 * brightest by spectral centroid, which is the only ordering that gives
 * "try the next one" a direction.
 */
const take = (files: string[]): SoundChoice[] => [
  { id: 'rotate', take: null, file: null },
  ...files.map((file, i) => ({ id: `take-${i + 1}`, take: i + 1, file })),
];

export const MOVE_SOUNDS: SoundChoice[] = take([
  'move-opponent-1.wav', //  984 Hz — the default
  'move-opponent-3.wav', //  825 Hz
  'move-self-1.wav', //  919 Hz
  'move-self.wav', //  984 Hz
  'move-self-3.wav', //  997 Hz
  'move-self-4.wav', // 1062 Hz
  'move-opponent-4.wav', // 1101 Hz
  'move-self-2.wav', // 1156 Hz
  'move-opponent.wav', // 1193 Hz
  'move-opponent-2.wav', // 1352 Hz
]);

export const CAPTURE_SOUNDS: SoundChoice[] = take([
  'capture-3.wav', // 1737 Hz
  'capture.wav', // 1907 Hz
  'capture-1.wav', // 1935 Hz
  'capture-4.wav', // 1940 Hz
  'capture-6.wav', // 2083 Hz
  'capture-7.wav', // 2106 Hz
  'capture-2.wav', // 2156 Hz
  'capture-5.wav', // 2169 Hz
  'capture-8.wav', // 2186 Hz
]);

interface PrefsState {
  boardTheme: BoardTheme;
  pieces: PieceSet;
  sound: boolean;
  /** 0–1. Applied as a gain, so 0 is silent without disabling the setting. */
  soundVolume: number;
  moveSound: string;
  captureSound: string;
  castleStyle: CastleStyle;
  /** File and rank labels on the board edge. */
  coordinates: boolean;
  /** One short vibration when a piece lands. Android only — iOS Safari
      exposes no haptics to web pages, so there the setting is inert. */
  haptics: boolean;
  /**
   * Write games, studies and notes to the vault as they are edited.
   *
   * Off by default, which is the change this setting exists to make
   * optional: a document is yours until you save it. On restores the old
   * behaviour — a 1.5s debounce after the last edit.
   *
   * Here rather than in the vault config for three reasons. The demo
   * writes /api/settings out by hand (the real module wants node:crypto),
   * so a vault setting is dead in the app most people meet first unless
   * the demo is taught that one route too — as home's layout was. The
   * consumers are module-level subscribers outside React, where
   * getState() is a synchronous always-current read and a fetched
   * setting would need caching and invalidation for one boolean. And it
   * is genuinely per-device: writing as you type is a thing to want on a
   * desktop and not on a train. The cost is that a new device does not
   * inherit the choice — and since the default is the safe value, it
   * fails the right way.
   */
  autosave: boolean;
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
  setCoordinates: (on: boolean) => void;
  setHaptics: (on: boolean) => void;
  setAutosave: (on: boolean) => void;
}

const apply = (boardTheme: BoardTheme, pieces: PieceSet): void => {
  const el = document.documentElement;
  if (boardTheme === 'default') delete el.dataset.board;
  else el.dataset.board = boardTheme;
  if (pieces === 'cburnett') delete el.dataset.pieces;
  else {
    el.dataset.pieces = pieces;
    // Each vendored set is its own CSS chunk, fetched the first time it
    // is chosen and cached by the service worker like any other chunk —
    // nine sets of embedded art would otherwise sit in the eager bundle
    // for a preference most people leave on cburnett. Until the chunk
    // lands the board simply shows cburnett, and if the fetch fails
    // (offline, never seen before) that fallback is the behaviour.
    void import(`../pieces/${pieces}.css`).catch(() => {});
  }
};

/** Four custom properties and one flag; every token in index.css reads
    from them. `ink` is an attribute rather than a property because what it
    selects is a whole block of replacement lightnesses (`.dark[data-ink]`),
    the same way the board palettes hang off `data-board`. */
const applyScheme = ({ hue, tint, accent, accentTint = 1, ink = false }: Scheme): void => {
  const el = document.documentElement;
  el.style.setProperty('--ui-hue', String(hue));
  el.style.setProperty('--ui-tint', String(tint));
  el.style.setProperty('--accent-hue', String(accent));
  el.style.setProperty('--accent-tint', String(accentTint));
  if (ink) el.dataset.ink = '';
  else delete el.dataset.ink;
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      boardTheme: 'default',
      pieces: 'cburnett',
      sound: true,
      soundVolume: 0.7,
      // Take one of each, chosen by ear. Rotating is still there for anyone
      // who would rather not hear the same knock every move.
      moveSound: 'take-1',
      captureSound: 'take-1',
      castleStyle: 'king',
      coordinates: true,
      haptics: true,
      autosave: false,
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
      setCoordinates: (coordinates) => set({ coordinates }),
      setHaptics: (haptics) => set({ haptics }),
      setAutosave: (autosave) => set({ autosave }),
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
