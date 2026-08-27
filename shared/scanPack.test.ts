import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { hashSetup } from './zobrist.ts';
import { decodeScanPack, encodeScanPack } from './scanPack.ts';

const START_KEY32 = Number(hashSetup(Chess.default().toSetup()) & 0xffffffffn);

describe('encodeScanPack', () => {
  it('pins the layout: header, keys, events, byte for byte', () => {
    // Two plies, no captures: npos 3, three keys, two zero events.
    const pack = encodeScanPack('e4 e5');
    expect(pack.length).toBe(2 + 4 * 3 + 2);
    const view = new DataView(pack.buffer);
    expect(view.getUint16(0, true)).toBe(3);
    expect(view.getUint32(2, true)).toBe(START_KEY32);
    expect([...pack.slice(-2)]).toEqual([0, 0]);
    // The keys are the replay's own, truncated — recompute one.
    const pos = Chess.default();
    pos.play(parseSan(pos, 'e4')!);
    expect(view.getUint32(6, true)).toBe(Number(hashSetup(pos.toSetup()) & 0xffffffffn));
  });

  it('writes capture, en passant, promotion and castling events', () => {
    // exd5: pawn takes pawn — captured=1.
    expect(decodeScanPack(encodeScanPack('e4 d5 exd5'))!.events).toEqual([0, 0, 1]);
    // exd6 en passant: destination square is empty, file changes.
    expect(decodeScanPack(encodeScanPack('e4 c5 e5 d5 exd6'))!.events).toEqual([0, 0, 0, 0, 1]);
    // Qxd5 after exd5 Qxd5: queen takes pawn then knight takes queen.
    expect(decodeScanPack(encodeScanPack('e4 d5 exd5 Qxd5 Nc3 Qd8'))!.events).toEqual([
      0, 0, 1, 1, 0, 0,
    ]);
    // Capture-promotion to a queen: pawn takes rook on a8, promoted=5.
    const promo = decodeScanPack(encodeScanPack('e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=Q'))!;
    expect(promo.events.at(-1)).toBe(4 | (5 << 3));
    // Underpromotion to a knight over the same line.
    const under = decodeScanPack(encodeScanPack('e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=N'))!;
    expect(under.events.at(-1)).toBe(4 | (2 << 3));
    // Castling is king-takes-rook in the encoding — an OWN piece on the
    // destination, so no capture event.
    const castle = decodeScanPack(encodeScanPack('e4 e5 Nf3 Nc6 Bc4 Bc5 O-O'))!;
    expect(castle.events.at(-1)).toBe(0);
  });

  it('stops where the replay stops, keeping what replayed', () => {
    // The bogus token ends the stream; the two legal plies remain.
    const pack = decodeScanPack(encodeScanPack('e4 e5 Zz9 d4'))!;
    expect(pack.keys).toHaveLength(3);
    expect(pack.events).toHaveLength(2);
    // No ply cap: a long game encodes past the plies table's 30.
    const long = decodeScanPack(
      encodeScanPack(
        'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 ' +
          'Nbd2 Bb7 Bc2 Re8 Nf1 Bf8 Ng3 g6 a4 c5 d5 c4 Bg5 Nc5 Qd2 h6',
      ),
    )!;
    expect(long.keys.length).toBe(37);
  });

  it('encodes the empty and the unparseable as one lone position', () => {
    for (const moves of ['', 'nonsense']) {
      const pack = decodeScanPack(encodeScanPack(moves))!;
      expect(pack.keys).toEqual([START_KEY32]);
      expect(pack.events).toEqual([]);
    }
  });

  it('decode refuses what encode never wrote', () => {
    expect(decodeScanPack(new Uint8Array([]))).toBeNull();
    expect(decodeScanPack(new Uint8Array([0, 0]))).toBeNull(); // npos 0
    expect(decodeScanPack(new Uint8Array([2, 0, 1, 2, 3]))).toBeNull(); // truncated
    const good = encodeScanPack('e4');
    expect(decodeScanPack(good)).not.toBeNull();
    expect(decodeScanPack(good.slice(0, good.length - 1))).toBeNull();
  });
});
