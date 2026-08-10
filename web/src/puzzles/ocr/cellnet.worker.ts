/**
 * CellNet in a Web Worker: board classification runs off the main thread,
 * so a whole-book scan never freezes the UI. Boards arrive as transferred
 * gray buffers; readings go back as plain arrays.
 */
import { classifyBoardDetailed, classifyBoardNet, parseCellNet, type CellNet } from './cellnet';
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
  const { id, w, h, data, detail } = e.data as {
    id: number;
    w: number;
    h: number;
    data: ArrayBuffer;
    /** Ask for every cell's distribution, for the repair search. */
    detail?: boolean;
  };
  await ensureNet();
  if (!net) {
    self.postMessage({ id, readings: null, cells: null });
    return;
  }
  const board: Gray = { w, h, data: new Uint8ClampedArray(data) };
  if (detail) {
    const { cells, labels } = classifyBoardDetailed(net, board);
    // Maps do not survive some structured-clone paths as cleanly as pairs,
    // and the arrays have to be plain to transfer at all.
    self.postMessage({
      id,
      labels,
      cells: cells.map((c) => ({ probs: Array.from(c.probs), top: c.top, votes: [...c.votes] })),
    });
    return;
  }
  const readings = classifyBoardNet(net, board);
  self.postMessage({ id, readings });
};
