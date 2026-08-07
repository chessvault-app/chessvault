import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyBoardNet, parseCellNet, runCellNet } from './cellnet';
import golden from './__fixtures__/cellnet-golden.json';

/**
 * Parity with the training graph: the shipped binary + this TS inference
 * must reproduce PyTorch's folded-model probabilities on real book tiles.
 * Any drift here means the browser reads differently than the model that
 * was evaluated — the one bug class this file exists to catch.
 */

const BIN = resolve(__dirname, '..', '..', '..', 'public', 'models', 'cellnet-v1.bin');

describe('cellnet inference parity', () => {
  const net = parseCellNet(readFileSync(BIN).buffer.slice(0) as ArrayBuffer);

  it('parses the shipped model', () => {
    expect(net.labels).toBe('1RNBQKPrnbqkp');
    expect(net.convs).toHaveLength(4);
    expect(net.head.outN).toBe(13);
  });

  it('matches PyTorch probabilities on golden tiles', () => {
    for (const [i, tile] of golden.tiles.entries()) {
      const input = new Float32Array(32 * 32);
      for (let p = 0; p < input.length; p++) input[p] = tile[p]! / 255;
      const probs = runCellNet(net, input);
      const expected = golden.probs[i]!;
      for (let c = 0; c < 13; c++) {
        expect(Math.abs(probs[c]! - expected[c]!)).toBeLessThan(2e-3);
      }
    }
  });

  it('reads a synthetic empty board as all empty', () => {
    // Plain light/dark checkerboard, no pieces: every cell must read empty
    // with a solid margin.
    const board = { w: 512, h: 512, data: new Uint8ClampedArray(512 * 512) };
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const dark = (Math.floor(y / 64) + Math.floor(x / 64)) % 2 === 1;
        board.data[y * 512 + x] = dark ? 150 : 240;
      }
    }
    const readings = classifyBoardNet(net, board);
    expect(readings).toHaveLength(64);
    for (const r of readings) {
      expect(r.label).toBe('empty');
      expect(r.confidence).toBeGreaterThan(0.35);
    }
  });
});
