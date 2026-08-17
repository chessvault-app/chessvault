import { parseBestMove, parseInfo, type PvLine } from './uci.ts';

export type EngineFlavor = 'lite' | 'lite-single' | 'full' | 'full-single';

/**
 * RELATIVE to the document, not to the origin.
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
const SCRIPTS: Record<EngineFlavor, string> = {
  lite: 'engine/stockfish-18-lite.js',
  'lite-single': 'engine/stockfish-18-lite-single.js',
  full: 'engine/stockfish-18.js',
  'full-single': 'engine/stockfish-18-single.js',
};

const scriptUrl = (flavor: EngineFlavor): string =>
  new URL(SCRIPTS[flavor], document.baseURI).href;

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
 * Driver for the Stockfish 18 WASM worker.
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

  /**
   * While set, every engine line is diverted here instead of the UCI
   * parser — the `eval` trace is plain prose (a board of piece values),
   * not `info` messages, and handleLine would drop all of it.
   */
  private traceSink: ((line: string) => void) | null = null;

  private lines = new Map<number, PvLine>();

  constructor(
    private readonly flavor: EngineFlavor,
    private options: EngineOptions,
    private readonly onUpdate: (update: SearchUpdate) => void,
    private readonly onError: (message: string) => void,
  ) {}

  /** Boot the worker and complete the UCI handshake. */
  async start(): Promise<void> {
    if (this.worker) return;

    try {
      this.worker = new Worker(scriptUrl(this.flavor));
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
    this.applyOptions();
  }

  private handleLine(line: string): void {
    if (this.traceSink) {
      this.traceSink(line);
      return;
    }

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
    if (!this.worker) await this.start();
    if (!this.worker) return;

    if (this.searching || this.pendingStop) {
      this.queued = { fen, depth, moveMs };
      if (!this.pendingStop) {
        this.pendingStop = true;
        this.send('stop');
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
    this.searching = true;
    this.send(`position fen ${fen}`);
    // Both limits at once, which UCI allows and Stockfish honours: it stops
    // at whichever arrives first and emits `bestmove` either way, so nothing
    // downstream can tell the two apart. Depth stays the target — the cap is
    // only there so the target cannot cost unbounded time on a slow device.
    this.send(`go depth ${depth}${moveMs > 0 ? ` movetime ${moveMs}` : ''}`);
  }

  /**
   * Run the NNUE `eval` trace for a position and return its raw lines.
   *
   * The trace ends with a "Final evaluation" line; if that never comes
   * (an engine built without the command) the partial capture is returned
   * after a timeout and the caller's parser will find no grid in it —
   * absence, not an error. Must not be called while a search is in
   * flight; callers serialise (see probe.ts).
   */
  evalTrace(fen: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) {
        reject(new Error('engine not ready'));
        return;
      }
      if (this.searching || this.pendingStop || this.traceSink) {
        reject(new Error('engine busy'));
        return;
      }
      const lines: string[] = [];
      const timer = setTimeout(() => {
        this.traceSink = null;
        resolve(lines);
      }, 5_000);
      this.traceSink = (line) => {
        lines.push(line);
        if (line.startsWith('Final evaluation')) {
          clearTimeout(timer);
          this.traceSink = null;
          resolve(lines);
        }
      };
      this.send(`position fen ${fen}`);
      this.send('eval');
    });
  }

  /** Halt the current search but keep the worker warm. */
  stop(): void {
    this.queued = null;
    if (this.searching && !this.pendingStop) {
      this.pendingStop = true;
      this.send('stop');
    }
  }

  /** Shut the engine down completely and release its memory. */
  terminate(): void {
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.clearHandshakeTimer();
    // A start() awaiting the handshake must not hang on a dead worker.
    for (const waiter of this.readyWaiters.splice(0)) waiter();
    this.queued = null;
    this.searching = false;
    this.pendingStop = false;
    this.ready = false;
    this.currentFen = null;
    this.lines.clear();
    // A trace in flight resolves partial via its own timer; the sink just
    // must not outlive the worker it was reading.
    this.traceSink = null;
    this.worker?.terminate();
    this.worker = null;
  }


  private send(command: string): void {
    this.worker?.postMessage(command);
  }
}
