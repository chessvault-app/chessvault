import { boardFeatures } from './image';
import { harvestTemplates, type Template } from './classify';
import { grayFromCanvas, loadImage } from './browser';

/**
 * Built-in templates for boards drawn with the app's own (cburnett) piece
 * set — the set lichess and this app render with, so screenshots of
 * either read out of the box, no calibration diagram needed (lanph3re's ask
 * for the editor flow). The sprites are pulled from the vendored
 * chessground stylesheet at runtime: no extra assets, still offline.
 */

const ROLE_LETTER: Record<string, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** A calibration position holding every piece on both square shades. */
const CALIBRATION_PLACEMENT = 'PNBRQK2/1PNBRQK1/8/pnbrqk2/1pnbrqk1/8/8/8 w - - 0 1';

let cached: Promise<Template[]> | null = null;

export function builtinTemplates(): Promise<Template[]> {
  cached ??= build().catch((error: Error) => {
    cached = null;
    throw error;
  });
  return cached;
}

/**
 * Sprite data-URLs per FEN letter, scraped from the loaded stylesheets.
 * The piece rules hide inside `@layer` blocks and `@import`ed sheets, so
 * the walk must recurse through grouping rules rather than skim the top.
 */
function spriteUrls(): Map<string, string> {
  const sprites = new Map<string, string>();

  const visit = (rule: CSSRule): void => {
    if (rule instanceof CSSStyleRule) {
      // Both selector shapes exist in the wild: `piece.pawn.white` and
      // `.white piece.pawn` (class order also varies).
      const selector = rule.selectorText;
      const role = /(pawn|knight|bishop|rook|queen|king)/.exec(selector)?.[1];
      const color = /(white|black)/.exec(selector)?.[1];
      if (role && color && selector.includes('piece')) {
        const url = /url\(["']?(.+?)["']?\)/.exec(rule.style.backgroundImage)?.[1];
        if (url) {
          const letter = ROLE_LETTER[role]!;
          sprites.set(color === 'white' ? letter.toUpperCase() : letter, url);
        }
      }
      return;
    }
    // Grouping rules: @layer, @media, @supports…
    const inner = (rule as { cssRules?: CSSRuleList }).cssRules;
    if (inner) for (const child of Array.from(inner)) visit(child);
    // @import pulls in a whole sheet.
    const imported = (rule as { styleSheet?: CSSStyleSheet }).styleSheet;
    if (imported) {
      try {
        for (const child of Array.from(imported.cssRules)) visit(child);
      } catch {
        // cross-origin
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) visit(rule);
    } catch {
      // cross-origin sheet; not ours
    }
  }
  return sprites;
}

/** Board themes vary wildly; harvest against several shade pairs. */
const SHADE_PAIRS: [number, number][] = [
  [235, 178],
  [200, 128],
  [160, 95],
  [248, 215],
];

async function build(): Promise<Template[]> {
  const sprites = spriteUrls();
  if (sprites.size < 12) throw new Error('piece sprites not found in stylesheets');
  const images = new Map<string, HTMLImageElement>();
  for (const [letter, url] of sprites) images.set(letter, await loadImage(url));

  // Compose the calibration position as an image, then harvest it exactly
  // like a confirmed user diagram — one pipeline, no special cases. Done
  // once per background pair so any board theme finds a close match.
  const cell = 64;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 8;
  canvas.height = cell * 8;
  const ctx = canvas.getContext('2d')!;
  const placement = CALIBRATION_PLACEMENT.split(' ')[0]!;

  let templates: Template[] = [];
  for (const [light, dark] of SHADE_PAIRS) {
    const rows = placement.split('/');
    for (let row = 0; row < 8; row++) {
      let col = 0;
      for (const ch of rows[row]!) {
        if (ch >= '1' && ch <= '8') {
          for (let i = 0; i < Number(ch); i++) drawSquare(ctx, col + i, row, cell, light, dark);
          col += Number(ch);
        } else {
          drawSquare(ctx, col, row, cell, light, dark);
          ctx.drawImage(
            images.get(ch)!,
            col * cell + cell * 0.06,
            row * cell + cell * 0.06,
            cell * 0.88,
            cell * 0.88,
          );
          col++;
        }
      }
    }
    templates = harvestTemplates(
      boardFeatures(grayFromCanvas(canvas)),
      CALIBRATION_PLACEMENT,
      false,
      templates,
    );
  }
  return templates;
}

function drawSquare(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  cell: number,
  light: number,
  dark: number,
): void {
  const shade = (col + row) % 2 === 0 ? light : dark;
  ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
  ctx.fillRect(col * cell, row * cell, cell, cell);
}
