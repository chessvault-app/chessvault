/**
 * CellNet in a Web Worker: board classification runs off the main thread,
 * so a whole-book scan never freezes the UI. Boards arrive as transferred
 * gray buffers; readings go back as plain arrays.
 */
import { classifyBoardNet, parseCellNet, type CellNet } from './cellnet';
import type { Gray } from './image';

let net: CellNet | null = null;
let loading: Promise<void> | null = null;

async function ensureNet(): Promise<void> {
  loading ??= fetch('/models/cellnet-v1.bin')
    .then(async (res) => {
      if (!res.ok) throw new Error(`model fetch ${res.status}`);
      net = parseCellNet(await res.arrayBuffer());
    })
    .catch(() => {
      net = null;
    });
  await loading;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, w, h, data } = e.data as { id: number; w: number; h: number; data: ArrayBuffer };
  await ensureNet();
  if (!net) {
    self.postMessage({ id, readings: null });
    return;
  }
  const board: Gray = { w, h, data: new Uint8ClampedArray(data) };
  const readings = classifyBoardNet(net, board);
  self.postMessage({ id, readings });
};
