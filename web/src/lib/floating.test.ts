import { describe, expect, it } from 'vitest';
import { placeNear, type Box } from './floating';

/** A rectangle written the way a caller thinks of one. */
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const VIEW = { width: 1000, height: 800 };

describe('placeNear', () => {
  it('hangs a dropdown under its trigger, left edges lined up', () => {
    const at = placeNear(box(100, 200, 120, 32), { width: 200, height: 150 }, { viewport: VIEW });
    expect(at).toMatchObject({ side: 'bottom', top: 236, left: 100 });
  });

  it('flips above when below cannot hold it and above can', () => {
    // 40px of room under the trigger, 700 over it.
    const at = placeNear(box(100, 720, 120, 32), { width: 200, height: 150 }, { viewport: VIEW });
    expect(at.side).toBe('top');
    // Bottom edge a gap above the trigger: 720 - 4 - 150.
    expect(at.top).toBe(566);
  });

  it('stays below when below is merely tight, not smaller than above', () => {
    // The rule that replaced "flip when past the middle of the screen":
    // this trigger is well past halfway and below still has the most room.
    const at = placeNear(box(100, 500, 120, 32), { width: 200, height: 150 }, { viewport: VIEW });
    expect(at.side).toBe('bottom');
  });

  it('does not flip when neither side can hold it, keeping the expected side', () => {
    const tall = { width: 200, height: 700 };
    const at = placeNear(box(100, 380, 120, 32), tall, { viewport: VIEW });
    // Above has 372, below has 388 — below wins on room, and is preferred.
    expect(at.side).toBe('bottom');
  });

  it('honours flip: false, however little room is left', () => {
    const at = placeNear(
      box(100, 720, 120, 32),
      { width: 200, height: 150 },
      { viewport: VIEW, flip: false },
    );
    expect(at.side).toBe('bottom');
    // Clamped to the bottom margin rather than hanging off the screen.
    expect(at.top).toBe(800 - 150 - 8);
  });

  it('reports the room on the side it chose, for a layer that scrolls', () => {
    const below = placeNear(box(100, 200, 120, 32), { width: 200, height: 150 }, { viewport: VIEW });
    // 800 - 232 - gap 4 - margin 8.
    expect(below.room).toBe(556);
    const above = placeNear(box(100, 720, 120, 32), { width: 200, height: 150 }, { viewport: VIEW });
    expect(above.room).toBe(708);
  });

  it('aligns to the far edge on request', () => {
    const at = placeNear(
      box(700, 100, 120, 32),
      { width: 200, height: 100 },
      { viewport: VIEW, align: 'end' },
    );
    // Right edges flush: 820 - 200.
    expect(at.left).toBe(620);
  });

  it('centres on the anchor on request', () => {
    const at = placeNear(
      box(400, 100, 120, 32),
      { width: 200, height: 100 },
      { viewport: VIEW, align: 'center' },
    );
    expect(at.left).toBe(360);
  });

  it('keeps a start-aligned layer off the right edge', () => {
    // The Select bug: `left: rect.left` with no clamp, so a wide list on a
    // trigger near the right edge ran off the screen.
    const at = placeNear(box(900, 100, 80, 32), { width: 288, height: 100 }, { viewport: VIEW });
    expect(at.left).toBe(1000 - 288 - 8);
  });

  it('keeps an end-aligned layer off the left edge', () => {
    const at = placeNear(
      box(10, 100, 40, 32),
      { width: 288, height: 100 },
      { viewport: VIEW, align: 'end' },
    );
    expect(at.left).toBe(8);
  });

  it('puts a peek card beside its row, preferring the side with room', () => {
    // The engine pane is docked right, so a card for one of its rows goes
    // to the LEFT of the row and is centred on it.
    const at = placeNear(
      box(700, 300, 250, 20),
      { width: 176, height: 184 },
      { viewport: VIEW, side: 'left', align: 'center', gap: 16 },
    );
    expect(at).toMatchObject({ side: 'left', left: 700 - 16 - 176, top: 300 + 10 - 92 });
  });

  it('sends the peek to the other side when its own has no room', () => {
    const at = placeNear(
      box(20, 300, 250, 20),
      { width: 176, height: 184 },
      { viewport: VIEW, side: 'left', align: 'center', gap: 16 },
    );
    expect(at).toMatchObject({ side: 'right', left: 270 + 16 });
  });

  it('clamps a centred peek against the top and bottom of the window', () => {
    const size = { width: 176, height: 184 };
    const high = placeNear(box(700, 4, 250, 20), size, {
      viewport: VIEW,
      side: 'left',
      align: 'center',
      gap: 16,
    });
    expect(high.top).toBe(8);
    const low = placeNear(box(700, 790, 250, 20), size, {
      viewport: VIEW,
      side: 'left',
      align: 'center',
      gap: 16,
    });
    expect(low.top).toBe(800 - 184 - 8);
  });

  it('pins a layer too big for the window to the near edge instead of off it', () => {
    // Not a hypothetical: a 288px picker on a 320px phone, and the old
    // `Math.min(rect.left, innerWidth - width - 8)` could go negative.
    const at = placeNear(box(10, 100, 40, 32), { width: 400, height: 100 }, {
      viewport: { width: 320, height: 600 },
    });
    expect(at.left).toBe(8);
  });
});
