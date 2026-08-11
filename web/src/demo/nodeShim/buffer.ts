/**
 * `Buffer`, only the one method the vault routes actually call.
 *
 * The routes cap a document by its BYTE length, not its character count —
 * a study full of Korean comments is three times its own string length —
 * so this has to encode rather than measure. Installed as a global by
 * `demo/server.ts` because the routes reference `Buffer` free, not as an
 * import, which no alias can intercept.
 */
const encoder = new TextEncoder();

export const BufferShim = {
  byteLength(value: string | ArrayBufferView): number {
    if (typeof value === 'string') return encoder.encode(value).length;
    return value.byteLength;
  },
  from(value: string): Uint8Array {
    return encoder.encode(value);
  },
};

/**
 * Define `Buffer` globally, if the runtime has none of its own.
 *
 * Cast through `unknown`: this is two methods standing in for the whole
 * BufferConstructor, which is exactly the intent — anything reaching for
 * `Buffer.alloc` in a route SHOULD fail loudly here rather than be given a
 * quietly wrong answer.
 */
export function installBuffer(): void {
  const target = globalThis as typeof globalThis & { Buffer?: unknown };
  target.Buffer ??= BufferShim as unknown as typeof Buffer;
}
