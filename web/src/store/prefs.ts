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
  | 'charcoal'
  | 'ink'
  | 'khaki'
  | 'tan'
  | 'wood';
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
  // The only theme with a texture; the grain is drawn in index.css.
  { id: 'wood', label: 'Wood grain' },
  { id: 'blue', label: 'Blue' },
  { id: 'slate', label: 'Slate' },
  { id: 'lavender', label: 'Purple' },
  { id: 'rosewood', label: 'Rosewood' },
  // Paper and ink: the one preset whose two squares are different
  // materials rather than one material at two lightnesses.
  { id: 'ink', label: 'Paper and ink' },
  { id: 'charcoal', label: 'Charcoal' },
  // Two near-white boards, matched to the boards chess.com draws so a
  // position looks the same here as where somebody last saw it.
  { id: 'khaki', label: 'Khaki' },
  { id: 'tan', label: 'Tan' },
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
   * 0–1. How far the neutrals are pushed towards black and white; 0
   * unless said otherwise, which is every scheme that existed before
   * this number did.
   *
   * Separate from the two tint knobs on purpose: those decide how much
   * COLOUR a scheme has, this decides how much of the lightness scale it
   * uses, and they are independent. Greyscale said black/white/grey and
   * delivered neither black nor white — its dark page bottomed out at
   * 15.5% lightness and its lightest panel reached 29%, so the whole app
   * sat in the middle of the range with nothing at either end. See
   * --ui-contrast in index.css for what the number does to each token.
   */
  contrast?: number;
}

/**
 * Labels name the COLOUR, not a mood. Forest and Midnight were the two
 * that did not: a scheme called Midnight is a scheme chosen for how it
 * sounds, and the register the rest of this list already speaks — shadcn's
 * Stone, Zinc, Slate, and Tailwind's own Rose — is materials and hues.
 * Green and Violet are what those two are (hue 150 and hue 265).
 *
 * Paper stays: it names the surface, exactly as Stone and Slate do. The
 * ids never move — they are what a device has already stored.
 */
export const SCHEME_PRESETS: { id: string; label: string; scheme: Scheme }[] = [
  // shadcn's five base colours first, as schemes: each is the registry's
  // theme of that name — its neutral hue and how far from grey, with the
  // primary left neutral the way shadcn leaves it. Neutral is the default
  // and is the registry's neutral theme exactly (the knobs at zero).
  { id: 'default', label: 'Neutral', scheme: { hue: 264, tint: 0, accent: 264, accentTint: 0 } },
  { id: 'stone', label: 'Stone', scheme: { hue: 60, tint: 0.25, accent: 60, accentTint: 0 } },
  { id: 'zinc', label: 'Zinc', scheme: { hue: 286, tint: 0.3, accent: 286, accentTint: 0 } },
  { id: 'gray', label: 'Gray', scheme: { hue: 262, tint: 1, accent: 262, accentTint: 0 } },
  { id: 'shadcn-slate', label: 'Slate', scheme: { hue: 257, tint: 2, accent: 257, accentTint: 0 } },
  // The app's own schemes: the same ladder with a coloured accent.
  { id: 'slate', label: 'Blue', scheme: { hue: 264, tint: 1, accent: 240 } },
  { id: 'paper', label: 'Paper', scheme: { hue: 75, tint: 1.8, accent: 45 } },
  { id: 'forest', label: 'Green', scheme: { hue: 150, tint: 1.6, accent: 155 } },
  { id: 'rose', label: 'Rose', scheme: { hue: 350, tint: 1.5, accent: 350 } },
  { id: 'midnight', label: 'Violet', scheme: { hue: 265, tint: 2.4, accent: 275 } },
  // Neutral's surfaces with a coloured button: Mono leans violet, Graphite
  // is the blue the app used to be drawn in.
  { id: 'mono', label: 'Mono', scheme: { hue: 264, tint: 0, accent: 264 } },
  { id: 'graphite', label: 'Graphite', scheme: { hue: 264, tint: 0, accent: 240 } },
  // Neutral with the lightness scale opened all the way up: the dark page
  // is #000 and its button #fff, the light page #fff and its button #000.
  {
    id: 'high-contrast',
    label: 'High contrast',
    scheme: { hue: 264, tint: 0, accent: 264, accentTint: 0, contrast: 1 },
  },
];

/**
 * How much air a list row and a panel are given.
 *
 * The knob a tool has and this app did not. Corners and annotation size
 * decide how the app LOOKS; this one decides how much of your vault fits
 * on the screen at once, which on a page that is a list of four hundred
 * games is the difference between reading and scrolling.
 *
 * Three custom properties, applied to the root and read by the three
 * surfaces that carry every list in the app — the game rows, the panel
 * rows, and the cards those sit in. One number per surface, so a density
 * is three declarations in index.css rather than a sweep of call sites,
 * and adding a rung later is a fourth line in this list.
 *
 * NOT Tailwind's own `--spacing`, which would have been one line and is
 * the wrong line: 401 rules in the built stylesheet derive from it,
 * including every `size-*`, so squeezing it shrinks the icons along with
 * the padding. Whitespace is what a density control is about; a glyph is
 * not whitespace, and 14px icons measured right for their row do not
 * become 12px ones because a list got tighter.
 *
 * Per-device like the rest of this store, which is the point: the same
 * vault wants compact on a monitor and comfortable under a thumb.
 */
export type Density = 'comfortable' | 'compact';

export const DENSITIES: { id: Density; label: string }[] = [
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];

/**
 * The corner radius every rung of the ladder derives from (index.css:
 * sm/md/lg/xl/2xl are multiples of it). shadcn's own knob, offered as the
 * registry offers it: square, small, the default 0.625rem, large.
 */
export type RadiusId = 'none' | 'small' | 'default' | 'large';
export const RADIUS_PRESETS: { id: RadiusId; label: string; rem: number }[] = [
  { id: 'none', label: 'Square', rem: 0 },
  { id: 'small', label: 'Small', rem: 0.3 },
  { id: 'default', label: 'Default', rem: 0.625 },
  { id: 'large', label: 'Large', rem: 1 },
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

/**
 * How large a comment is rendered in the move list.
 *
 * 'medium' is what the app rendered for its whole life, and is the default:
 * 14px against the moves' 16px, a deliberate step down beside a board on a
 * desktop where the column is read at arm's length.
 *
 * It replaces a `stacked:text-base` that lifted the comment to the moves'
 * size under a board on a phone, on the grounds that 14px was the smallest
 * thing on the screen anyone was expected to READ rather than glance at.
 * That was the right size and the wrong mechanism: a viewport cannot tell
 * how far away the screen is being held, and it left the same document
 * rendering two ways for reasons the reader could neither see nor change.
 * The lift is now 'large', and it is a choice — which is the whole point of
 * this setting, and why the sizes are flat at every width.
 *
 * Per-device like the rest of this store, which is what makes that work: the
 * phone can be set large while the desktop keeps the comment out of the way
 * of the moves.
 */
export type AnnotationSize = 'small' | 'medium' | 'large';

export const ANNOTATION_SIZES: { id: AnnotationSize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
];

/**
 * Written out as whole class strings rather than composed from a size name,
 * because Tailwind scans for literals — a `text-${size}` here is a class that
 * never reaches the stylesheet.
 *
 * A variation's comment stays one step under the mainline's and keeps its
 * italic at the call site: what marks it as an aside is the gap between the
 * two, so the setting moves the pair together rather than closing it.
 */
export const ANNOTATION_CLASS: Record<AnnotationSize, { mainline: string; variation: string }> = {
  // 11px for the aside, which has no scale step of its own — the ladder has
  // to keep the gap at its bottom rung too, or the smallest setting is the
  // one where a variation's comment stops reading as one.
  small: { mainline: 'text-xs', variation: 'text-[0.6875rem]' },
  medium: { mainline: 'text-sm', variation: 'text-xs' },
  large: { mainline: 'text-base', variation: 'text-sm' },
};

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
  /**
   * The typed-move field at the foot of every moves panel.
   *
   * On by default because it is the keyboard's only way onto the board;
   * off for anyone who never types a move and would rather have the row
   * back. Per-device like coordinates: it is a question of what the
   * screen shows, not of the chess.
   */
  moveBox: boolean;
  /** How large a comment is rendered in the move list. */
  annotationSize: AnnotationSize;
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
  /**
   * Whether the explorer looks up exact endgame verdicts (Settings >
   * Tablebase).
   *
   * Per-device for the same reason autosave is, plus one of its own: it
   * is the one lookup in the app that leaves the machine WITHOUT being
   * asked for — no source to select, no button to press, just a position
   * small enough. Somebody on a metered connection, or who would rather
   * their endgames stayed theirs, needs a way to say no, and it has to
   * be a way that does not also switch off the explorer.
   */
  tablebase: boolean;
  /** Which preset is selected. */
  schemeId: string;
  scheme: Scheme;
  radius: RadiusId;
  density: Density;
  setBoardTheme: (t: BoardTheme) => void;
  setPieces: (p: PieceSet) => void;
  setSound: (on: boolean) => void;
  setSoundVolume: (v: number) => void;
  setMoveSound: (id: string) => void;
  setCaptureSound: (id: string) => void;
  setSchemeId: (id: string) => void;
  setRadius: (id: RadiusId) => void;
  setDensity: (id: Density) => void;
  setCastleStyle: (style: CastleStyle) => void;
  setCoordinates: (on: boolean) => void;
  setMoveBox: (on: boolean) => void;
  setAnnotationSize: (size: AnnotationSize) => void;
  setHaptics: (on: boolean) => void;
  setAutosave: (on: boolean) => void;
  setTablebase: (on: boolean) => void;
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

/** The one number the corner ladder derives from; the default is what :root says. */
const applyRadius = (id: RadiusId): void => {
  const rem = RADIUS_PRESETS.find((r) => r.id === id)?.rem;
  const el = document.documentElement;
  if (rem === undefined || id === 'default') el.style.removeProperty('--radius');
  else el.style.setProperty('--radius', `${rem}rem`);
};

/** Comfortable is what :root already says, so it carries no attribute. */
const applyDensity = (id: Density): void => {
  const el = document.documentElement;
  if (id === 'compact') el.dataset.density = 'compact';
  else delete el.dataset.density;
};

/** Five custom properties; every token in index.css reads from them. */
const applyScheme = ({ hue, tint, accent, accentTint = 1, contrast = 0 }: Scheme): void => {
  const el = document.documentElement;
  el.style.setProperty('--ui-hue', String(hue));
  el.style.setProperty('--ui-tint', String(tint));
  el.style.setProperty('--accent-hue', String(accent));
  el.style.setProperty('--accent-tint', String(accentTint));
  el.style.setProperty('--ui-contrast', String(contrast));
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set, get) => ({
      boardTheme: 'blue',
      pieces: 'cburnett',
      sound: true,
      soundVolume: 0.7,
      // Take one of each, chosen by ear. Rotating is still there for anyone
      // who would rather not hear the same knock every move.
      moveSound: 'take-1',
      captureSound: 'take-1',
      castleStyle: 'king',
      coordinates: true,
      moveBox: true,
      // What the move list has always rendered a comment at.
      annotationSize: 'medium',
      haptics: true,
      autosave: false,
      // On: an endgame verdict is the answer the engine cannot give, and
      // a feature nobody finds is a feature nobody has. It costs one
      // request per position under seven pieces, cached for good, and
      // Settings > Tablebase turns it off.
      tablebase: true,
      schemeId: 'default',
      scheme: SCHEME_PRESETS[0]!.scheme,
      radius: 'default',
      density: 'comfortable',
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
      setMoveBox: (moveBox) => set({ moveBox }),
      setAnnotationSize: (annotationSize) => set({ annotationSize }),
      setHaptics: (haptics) => set({ haptics }),
      setAutosave: (autosave) => set({ autosave }),
      setTablebase: (tablebase) => set({ tablebase }),
      setSchemeId: (schemeId) => {
        const preset = SCHEME_PRESETS.find((p) => p.id === schemeId);
        const scheme = preset ? preset.scheme : get().scheme;
        applyScheme(scheme);
        set({ schemeId, scheme });
      },
      setRadius: (radius) => {
        applyRadius(radius);
        set({ radius });
      },
      setDensity: (density) => {
        applyDensity(density);
        set({ density });
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
        // A preset is re-read from the list, not from what was stored: the
        // list is what a preset MEANS, and it has changed (the default is
        // shadcn's neutral now). A stored scheme under an id the list no
        // longer has is kept as it was.
        const preset = SCHEME_PRESETS.find((p) => p.id === state.schemeId);
        const scheme = preset ? preset.scheme : state.scheme;
        if (preset) state.scheme = scheme;
        applyScheme(scheme);
        applyRadius(state.radius ?? 'default');
        applyDensity(state.density ?? 'comfortable');
      },
    },
  ),
);

/** Applied before React mounts so the board never flashes the default skin. */
export function initPrefs(): void {
  const { boardTheme, pieces, scheme, radius, density } = usePrefs.getState();
  apply(boardTheme, pieces);
  applyScheme(scheme);
  applyRadius(radius);
  applyDensity(density);
}
