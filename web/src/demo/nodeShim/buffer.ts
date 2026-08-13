/**
 * `Buffer`, only the methods the vault routes actually call.
 *
 * The routes cap a document by its BYTE length, not its character count —
 * a study full of Korean comments is three times its own string length —
 * so this has to encode rather than measure. Installed as a global by
 * `demo/server.ts` because the routes reference `Buffer` free, not as an
 * import, which no alias can intercept.
 */
const encoder = new TextEncoder();

/**
 * A byte window that decodes the way Buffer does.
 *
 * `alloc` exists for the shelf previews, which read the head of a file
 * into a fixed buffer and then `.subarray(0, read).toString('utf-8')` it.
 * A plain Uint8Array would answer that with a comma-separated list of
 * numbers — quietly wrong, and wrong in a place wrapped in a try/catch,
 * which is the worst combination there is. Extending Uint8Array means
 * `subarray` hands back one of these too, so the chain keeps working.
 *
 * A window that ends mid-character decodes its last bytes to a
 * replacement char, exactly as Buffer does; the caller already drops the
 * final line for that reason.
 */
class BufferLike extends Uint8Array {
  override toString(encoding = 'utf-8'): string {
    return new TextDecoder(encoding).decode(this);
  }
}

export const BufferShim = {
  byteLength(value: string | ArrayBufferView): number {
    if (typeof value === 'string') return encoder.encode(value).length;
    return value.byteLength;
  },
  from(value: string): Uint8Array {
    return encoder.encode(value);
  },
  alloc(size: number): Uint8Array {
    return new BufferLike(size);
  },
};

/**
 * Define `Buffer` globally, if the runtime has none of its own.
 *
 * Cast through `unknown`: this is three methods standing in for the whole
 * BufferConstructor, which is exactly the intent — anything reaching for
 * a method that is NOT here SHOULD fail loudly rather than be given a
 * quietly wrong answer. The list grows only when a route needs it to, and
 * each addition has to behave the way Buffer does, not merely exist.
 */
export function installBuffer(): void {
  const target = globalThis as typeof globalThis & { Buffer?: unknown };
  target.Buffer ??= BufferShim as unknown as typeof Buffer;
}
