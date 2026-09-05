import type { Init } from './lichessWorker.ts';
import { parseBestMove, parseInfo, type PvLine } from './uci.ts';

export type EngineFlavor = 'lite' | 'lite-single' | 'full' | 'full-single';

/**
 * Which build each flavour is, and how it is spoken to.
 *
 * `lite` and `full` are Lichess's builds of Stockfish 19
 * (`@lichess-org/stockfish-web`): an ES module the shim in
 * lichessWorker.ts loads, with the network fetched separately — 1 MB for
 * the size-optimised small net, 79 MB for the official one. The single-
 * threaded flavours stay on nmrugg's Stockfish 18 builds, which need no
 * SharedArrayBuffer: Stockfish 19 is only built with threads, so a page
 * that is not cross-origin isolated (the static demo on a plain host, a
 * browser with the isolation headers stripped) keeps an engine at all
 * only this way. The two speak identical UCI, and the driver below
 * cannot tell them apart.
 *
 * Paths are RELATIVE to the document, not to the origin.
 *
 * These were `/engine/…`, which is only the right file when the app is
 * served from the root of its origin. The static demo is not: it lives
 * under `/app/` beside the landing page, and on a project page it lives
 * under `/<repo>/app/`. There the worker 404s, `start()` reports the
 * failure, and the failure turns the engine back off — so the toggle
 * flicked on and off again and analysis was simply missing from the demo.
 *
 * `document.baseURI` is what the rest of the app already resolves its
 * assets against (see the demo backend's ECO and database fetches), and it
 * is the app's own base wherever it is deployed, root included.
 */
type Build =
  | { kind: 'classic'; script: string }
  | { kind: 'lichess'; script: string; nnue: string[] };

export const BUILDS: Record<EngineFlavor, Build> = {
  lite: { kind: 'lichess', script: 'engine/sf_dev_smallnet.js', nnue: ['engine/nn-61e7af4bb97d.nnue'] },
  'lite-single': { kind: 'classic', script: 'engine/stockfish-18-lite-single.js' },
  full: { kind: 'lichess', script: 'engine/sf_dev.js', nnue: ['engine/nn-1a298aa575a0.nnue'] },
  'full-single': { kind: 'classic', script: 'engine/stockfish-18-single.js' },
};

const assetUrl = (path: string): string => new URL(path, document.baseURI).href;

/**
 * A classic build IS the worker. A Lichess build is loaded by the shim,
 * which is told what to load in its first message; every message after
 * that is a UCI command, on both kinds.
 */
function spawnWorker(flavor: EngineFlavor): Worker {
  const build = BUILDS[flavor];
  if (build.kind === 'classic') return new Worker(assetUrl(build.script));
  const worker = new Worker(new URL('./lichessWorker.ts', import.meta.url), { type: 'module' });
  worker.postMessage({
    type: 'init',
    script: assetUrl(build.script),
    nnue: build.nnue.map(assetUrl),
  } satisfies Init);
  return worker;
}

/**
 * How long a `stop` may go unanswered before the worker is presumed dead.
 * Stockfish checks for `stop` between nodes and normally answers in single
 * digit milliseconds; the search has its own 10s backstop, but that bounds
 * the SEARCH, not the acknowledgement. So this is a fault detector rather
 * than a budget — and what it does first is rebuild in silence, so a false
 * positive on a throttled device costs a restart, not an error message.
 */
const STOP_TIMEOUT_MS = 5_000;

export interface EngineOptions {
  threads: number;
  hashMb: number;
  multiPv: number;
}

export interface SearchUpdate {
  /** FEN the results belong to, so late messages from a stale search can be dropped. */
  fen: string;
  lines: PvLine[];
  bestMove?: string;
  /** True once the search has stopped, either by depth limit or by `stop`. */
  finished: boolean;
}

/** True when the browser will let us use the multi-threaded build. */
export function supportsThreads(): boolean {
  return (
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof globalThis.crossOriginIsolated === 'boolean' &&
    globalThis.crossOriginIsolated
  );
}

/** Pick the strongest flavour this browser can actually run. */
export function defaultFlavor(): EngineFlavor {
  return supportsThreads() ? 'lite' : 'lite-single';
}

/**
 * Driver for the Stockfish WASM worker.
 *
 * Owns exactly one worker and speaks UCI to it. Deliberately does not know about
 * React or the move tree — the store adapts it — so the same driver can serve the
 * analysis board, a study's scratch analysis and puzzle validation.
 */
export class StockfishEngine {
  private worker: Worker | null = null;
  private ready = false;
  private readyWaiters: (() => void)[] = [];
  private searching = false;

  /** FEN of the search currently in flight. */
  private currentFen: string | null = null;
  /** Set while waiting for `bestmove` after a `stop`, so we don't overlap searches. */
  private pendingStop = false;
  private queued: { fen: string; depth: number; moveMs: number } | null = null;
  /** Depth and cap of the search in flight, so a rebuild can resume it. */
  private currentDepth = 22;
  private currentMoveMs = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * One silent rebuild per instance. Deliberately NOT reset by terminate(),
   * which is what the rebuild itself calls — clearing it there would make
   * "once" mean "every time" and hide a worker that wedges on every search.
   * Switching the engine off and on builds a new instance, so the allowance
   * comes back with it, which is the one case where trying again is a
   * person deciding to rather than us looping.
   */
  private stallRecovered = false;

  private lines = new Map<number, PvLine>();

  constructor(
    private readonly flavor: EngineFlavor,
    private options: EngineOptions,
    private readonly onUpdate: (update: SearchUpdate) => void,
    private readonly onError: (message: string) => void,
  ) {}

  /**
   * Boot the worker and complete the UCI handshake.
   *
   * Everyone awaits the SAME boot. The old guard was `if (this.worker)
   * return`, and start() assigns the worker synchronously while the
   * handshake finishes later — so a second analyse() during boot saw a
   * worker, concluded the engine was up, and walked straight past the
   * "am I already searching" guard. Both searches then ran: `position`
   * and `go` were sent before `uciok`, the options were applied AFTER
   * that `go`, and the engine finished on the position the reader had
   * already left, whose results the store correctly discards. What was
   * left on screen was a finished eval with no lines in it — the engine
   * saying nothing, on the starting position, which is the only position
   * whose analysis has to wait for a boot.
   */
  async start(): Promise<void> {
    if (this.ready) return;
    this.booting ??= this.boot().finally(() => {
      this.booting = null;
    });
    await this.booting;
  }

  private booting: Promise<void> | null = null;

  private async boot(): Promise<void> {
    if (this.worker) {
      // Worker up, handshake still outstanding: wait for it, do not start a second one.
      await this.waitForReady();
      if (this.ready) this.applyOptions();
      return;
    }

    try {
      this.worker = spawnWorker(this.flavor);
    } catch (error) {
      this.onError(`Could not start the engine worker: ${(error as Error).message}`);
      return;
    }

    this.worker.onerror = (event) => {
      this.onError(`Engine error: ${event.message || 'worker failed to load'}`);
    };

    this.worker.onmessage = (event: MessageEvent) => {
      // Emscripten builds send strings, but some wrap them in `{ data }`.
      const raw: unknown = event.data;
      const text = typeof raw === 'string' ? raw : String((raw as { data?: string })?.data ?? '');
      if (text) this.handleLine(text);
    };

    this.send('uci');
    await this.waitForReady();
    // Not if the handshake timed out: setoption to a dead engine is noise,
    // and the error has already gone out.
    if (this.ready) this.applyOptions();
  }

  private handleLine(line: string): void {
    if (line === 'uciok') {
      this.send('isready');
      return;
    }

    if (line === 'readyok') {
      this.ready = true;
      this.clearHandshakeTimer();
      for (const waiter of this.readyWaiters.splice(0)) waiter();
      return;
    }

    if (line.startsWith('info ')) {
      const parsed = parseInfo(line);
      // Bound scores are provisional; showing them makes the eval flicker.
      if (parsed && !parsed.bound) {
        this.lines.set(parsed.multipv, parsed);
        this.emit(false);
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      this.clearStopWatchdog();
      this.searching = false;
      const best = parseBestMove(line);
      this.emit(true, best);

      // A stop was issued to make room for a newer position; run it now.
      this.pendingStop = false;
      const next = this.queued;
      this.queued = null;
      if (next) void this.analyse(next.fen, next.depth, next.moveMs);
      return;
    }
  }

  /**
   * Intermediate `info` updates are coalesced onto a ~90 ms timer: the
   * engine emits dozens a second and each one was a store write, hence a
   * React commit in every subscriber (and a chessground redraw). The
   * FINAL update (bestmove) always flushes immediately, so the settled
   * state is byte-identical — only the intermediate frames are dropped.
   */
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  private emit(finished: boolean, bestMove?: string): void {
    if (!this.currentFen) return;
    if (!finished) {
      if (this.emitTimer !== null) return;
      this.emitTimer = setTimeout(() => {
        this.emitTimer = null;
        this.flush(false);
      }, 90);
      return;
    }
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.flush(true, bestMove);
  }

  private flush(finished: boolean, bestMove?: string): void {
    if (!this.currentFen) return;
    const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
    this.onUpdate({
      fen: this.currentFen,
      lines,
      ...(bestMove ? { bestMove } : {}),
      finished,
    });
  }

  /**
   * Owned so it can be DISARMED. This used to be an anonymous setTimeout
   * checking `!this.ready` — but terminate() sets ready back to false, so
   * the stale timer of an instance torn down and restarted within 20 s
   * fired onError against the store, which killed the NEW, healthy engine
   * (store/review.ts still guards against the same ghost from its side).
   */
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer !== null) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private waitForReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.readyWaiters.push(resolve);
      // Don't hang forever if the worker never answers.
      this.handshakeTimer ??= setTimeout(() => {
        this.handshakeTimer = null;
        if (!this.ready) this.onError('Engine did not respond to the UCI handshake.');
        for (const waiter of this.readyWaiters.splice(0)) waiter();
      }, 20_000);
    });
  }

  private applyOptions(): void {
    const threads = supportsThreads() && this.isMultiThreaded() ? this.options.threads : 1;
    this.send(`setoption name Threads value ${threads}`);
    this.send(`setoption name Hash value ${this.options.hashMb}`);
    this.send(`setoption name MultiPV value ${this.options.multiPv}`);
  }

  private isMultiThreaded(): boolean {
    return this.flavor === 'lite' || this.flavor === 'full';
  }

  setOptions(options: Partial<EngineOptions>): void {
    this.options = { ...this.options, ...options };
    if (this.worker && this.ready) this.applyOptions();
  }

  /**
   * Analyse a position.
   *
   * If a search is already running it is stopped first, and the new position is
   * queued until `bestmove` arrives. Issuing `go` while a search is live is the
   * classic way to desynchronise a UCI engine, so it is avoided.
   */
  async analyse(fen: string, depth = 22, moveMs = 0): Promise<void> {
    if (!this.ready) await this.start();
    if (!this.worker || !this.ready) return;

    if (this.searching || this.pendingStop) {
      this.queued = { fen, depth, moveMs };
      if (!this.pendingStop) {
        this.pendingStop = true;
        this.send('stop');
        this.armStopWatchdog();
      }
      return;
    }

    // Drop any coalesced frame from the previous position — it would
    // publish the new fen with the old (now cleared) lines.
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.lines.clear();
    this.currentFen = fen;
    this.currentDepth = depth;
    this.currentMoveMs = moveMs;
    this.searching = true;
    this.send(`position fen ${fen}`);
    // Both limits at once, which UCI allows and Stockfish honours: it stops
    // at whichever arrives first and emits `bestmove` either way, so nothing
    // downstream can tell the two apart. Depth stays the target — the cap is
    // only there so the target cannot cost unbounded time on a slow device.
    this.send(`go depth ${depth}${moveMs > 0 ? ` movetime ${moveMs}` : ''}`);
  }

  /** Halt the current search but keep the worker warm. */
  stop(): void {
    this.queued = null;
    if (this.searching && !this.pendingStop) {
      this.pendingStop = true;
      this.send('stop');
      this.armStopWatchdog();
    }
  }

  private clearStopWatchdog(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  private armStopWatchdog(): void {
    this.clearStopWatchdog();
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      this.handleStall();
    }, STOP_TIMEOUT_MS);
  }

  /**
   * A `stop` went unanswered, which nothing else can notice: the worker is
   * alive, so it fires no error event, and `pendingStop` is cleared only by
   * the `bestmove` that is not coming. Every later request would be parked
   * in `queued` and never drained — an engine pane that stays empty for as
   * long as the page is open, saying nothing.
   */
  private handleStall(): void {
    // Where to pick up: where the reader has got to, or failing that the
    // position that was being searched. Captured before terminate() clears both.
    const next =
      this.queued ??
      (this.currentFen
        ? { fen: this.currentFen, depth: this.currentDepth, moveMs: this.currentMoveMs }
        : null);

    if (this.stallRecovered) {
      // Twice is not a hiccup. The store terminates and switches off from here.
      this.onError('The engine stopped responding. Switch it back on to try again.');
      return;
    }

    this.stallRecovered = true;
    this.terminate();
    if (next) void this.analyse(next.fen, next.depth, next.moveMs);
  }

  /** Shut the engine down completely and release its memory. */
  terminate(): void {
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.clearHandshakeTimer();
    this.clearStopWatchdog();
    // A start() awaiting the handshake must not hang on a dead worker.
    for (const waiter of this.readyWaiters.splice(0)) waiter();
    this.queued = null;
    this.searching = false;
    this.pendingStop = false;
    this.ready = false;
    this.currentFen = null;
    this.lines.clear();
    this.worker?.terminate();
    this.worker = null;
  }


  private send(command: string): void {
    this.worker?.postMessage(command);
  }
}
