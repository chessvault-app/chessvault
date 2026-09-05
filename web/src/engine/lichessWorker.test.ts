import { describe, expect, it } from 'vitest';
import { attach, type Init, type Port } from './lichessWorker.ts';

/**
 * A fake engine module: records commands and network buffers, and lets
 * the test decide when loading finishes, which is the window that
 * matters — the driver posts `uci` before anything is loaded.
 */
function makeModule() {
  const instance = {
    commands: [] as string[],
    nets: [] as { index: number; bytes: number }[],
    listen: (_line: string) => {},
    onError: (_message: string) => {},
    uci(command: string) {
      this.commands.push(command);
    },
    setNnueBuffer(data: Uint8Array, index = 0) {
      this.nets.push({ index, bytes: data.byteLength });
    },
    getRecommendedNnue: () => undefined,
  };
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loader = {
    fetched: [] as string[],
    importModule: async () => ({
      default: async () => {
        await gate;
        return instance;
      },
    }),
    fetchBytes: async (url: string) => {
      loader.fetched.push(url);
      return new Uint8Array(url.length);
    },
  };
  return { instance, loader, release };
}

function makePort() {
  const port: Port & { out: string[] } = { out: [], postMessage: (line) => port.out.push(line), onmessage: null };
  const deliver = (data: unknown) => port.onmessage?.({ data });
  return { port, deliver };
}

const INIT: Init = {
  type: 'init',
  script: 'http://localhost/engine/sf.js',
  nnue: ['http://localhost/engine/big.nnue', 'http://localhost/engine/small.nnue'],
};

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('lichess worker shim', () => {
  it('holds commands until the module and its networks are in, then replays them in order', async () => {
    const { instance, loader, release } = makeModule();
    const { port, deliver } = makePort();
    attach(port, loader);

    deliver(INIT);
    deliver('uci');
    deliver('isready');
    await settle();
    expect(instance.commands).toEqual([]);

    release();
    await settle();
    await settle();
    expect(loader.fetched).toEqual(INIT.nnue);
    expect(instance.nets).toEqual([
      { index: 0, bytes: INIT.nnue[0]!.length },
      { index: 1, bytes: INIT.nnue[1]!.length },
    ]);
    expect(instance.commands).toEqual(['uci', 'isready']);

    // Live from here on: straight through, no queue.
    deliver('go depth 5');
    expect(instance.commands.at(-1)).toBe('go depth 5');
  });

  it('forwards every engine line to the port as a plain string', async () => {
    const { instance, loader, release } = makeModule();
    const { port, deliver } = makePort();
    attach(port, loader);
    deliver(INIT);
    release();
    await settle();
    await settle();

    instance.listen('uciok');
    instance.listen('info depth 1 score cp 10 pv e2e4');
    expect(port.out).toEqual(['uciok', 'info depth 1 score cp 10 pv e2e4']);
  });

  it('starts once, however many init messages arrive', async () => {
    const { loader, release } = makeModule();
    const { port, deliver } = makePort();
    let imports = 0;
    const counting = { ...loader, importModule: () => (imports++, loader.importModule()) };
    attach(port, counting);
    deliver(INIT);
    deliver(INIT);
    release();
    await settle();
    expect(imports).toBe(1);
  });
});
