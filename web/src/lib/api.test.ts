import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.ts';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('passes a caller-side abort through as an AbortError, not as an outage', async () => {
    // The Insights page cancels its report request when the engine pass's
    // status arrives; folded into "server unreachable" that cancellation
    // marked the page failed after the replacement request had begun.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    );
    const controller = new AbortController();
    const pending = api('/api/anything', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toBeInstanceOf(ApiError);
  });

  it('keeps an abort that lands while the body is being read', async () => {
    // The headers of a big report arrive first; the cancel comes while its
    // body is still parsing. Read as "no body" this became a TypeError in
    // the page, and the page called that a failed load.
    const controller = new AbortController();
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => {
          controller.abort();
          return Promise.reject(new DOMException('aborted', 'AbortError'));
        },
      } as unknown as Response),
    );
    const pending = api('/api/anything', { signal: controller.signal });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still reports a network failure as an offline ApiError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('navigator', { onLine: true });
    const error = await api('/api/anything').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).offline).toBe(true);
  });
});
