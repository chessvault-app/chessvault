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

  it('still reports a network failure as an offline ApiError', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('navigator', { onLine: true });
    const error = await api('/api/anything').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(0);
    expect((error as ApiError).offline).toBe(true);
  });
});
