/**
 * Worker shim around a `@lichess-org/stockfish-web` engine module.
 *
 * The rest of the app speaks UCI to a Worker: strings in, strings out
 * (see StockfishEngine). nmrugg's stockfish.js builds ARE that worker.
 * Lichess's builds are not — each is an ES module exporting a factory
 * whose instance takes commands through `uci()` and answers through a
 * `listen` callback, and whose network is not embedded but handed over
 * as a buffer. This worker owns one such instance and translates, so the
 * driver never learns which kind of build it is talking to.
 *
 * The first message is the configuration (`Init`): which module to load
 * and which network files to feed it. Everything after it is a UCI
 * command. Commands that arrive while the module and its network are
 * still loading are queued and replayed in order, which is what lets the
 * driver post `uci` the moment the worker exists, exactly as it does to
 * the classic build.
 *
 * The module spawns its own pthread workers from its own URL, so it has
 * to be served as a plain static file beside its `.wasm`, which is why
 * setup-engine stages it into `web/public/engine/` rather than bundling.
 */

export interface Init {
  type: 'init';
  /** Absolute URL of the engine module (`sf_….js`). */
  script: string;
  /** Absolute URLs of the network files, in the module's index order. */
  nnue: string[];
}

interface LichessEngine {
  uci(command: string): void;
  setNnueBuffer(data: Uint8Array, index?: number): void;
  getRecommendedNnue(index?: number): string | undefined;
  listen: (line: string) => void;
  onError: (message: string) => void;
}

type Factory = (init?: Record<string, unknown>) => Promise<LichessEngine>;

export interface Port {
  postMessage(line: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface Loader {
  importModule(url: string): Promise<{ default: Factory }>;
  fetchBytes(url: string): Promise<Uint8Array>;
}

/**
 * Wire a port to an engine. Exported for the test; the worker entry at
 * the bottom binds it to `self` and real `import`/`fetch`.
 */
export function attach(port: Port, loader: Loader): void {
  let engine: LichessEngine | null = null;
  const queued: string[] = [];
  let starting = false;

  const fail = (error: unknown): void => {
    // Rethrown outside the handler so it surfaces as the Worker's `error`
    // event in the parent, the same way a classic build that fails to
    // load does — the driver's onerror is the one place that reports it.
    const message = error instanceof Error ? error.message : String(error);
    setTimeout(() => {
      throw new Error(`engine module failed to start: ${message}`);
    });
  };

  const start = async (init: Init): Promise<void> => {
    const { default: create } = await loader.importModule(init.script);
    const instance = await create();
    instance.listen = (line) => port.postMessage(line);
    // stderr: Stockfish only writes there when something is wrong, and
    // a failure to load the network is the case worth seeing.
    instance.onError = (message) => console.warn(`[engine] ${message}`);
    const nets = await Promise.all(init.nnue.map((url) => loader.fetchBytes(url)));
    nets.forEach((bytes, index) => instance.setNnueBuffer(bytes, index));
    engine = instance;
    for (const command of queued.splice(0)) engine.uci(command);
  };

  port.onmessage = (event) => {
    const data = event.data;
    if (typeof data === 'string') {
      if (engine) engine.uci(data);
      else queued.push(data);
      return;
    }
    if (isInit(data) && !starting) {
      starting = true;
      start(data).catch(fail);
    }
  };
}

const isInit = (value: unknown): value is Init =>
  typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'init';

// The worker entry. Guarded so the test can import `attach` on its own;
// the global is looked up by name because the DOM lib does not declare it.
if (typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !== 'undefined') {
  attach(self as unknown as Port, {
    // A runtime URL, deliberately outside the bundle: see the header.
    importModule: (url) => import(/* @vite-ignore */ url),
    fetchBytes: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  });
}
