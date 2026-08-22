import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { crossSiteGuard } from './crossSite.ts';

function makeApp(opts: { loopbackOnly?: boolean } = {}): Hono {
  const app = new Hono();
  app.use('/api/*', crossSiteGuard(opts));
  app.get('/api/read', (c) => c.json({ ok: true }));
  app.post('/api/write', (c) => c.json({ ok: true }));
  app.delete('/api/write', (c) => c.json({ ok: true }));
  app.post('/api/sources', (c) => c.json({ ok: true }));
  return app;
}

describe('crossSiteGuard', () => {
  it('refuses anything a browser marks cross-site', async () => {
    const app = makeApp();
    for (const method of ['GET', 'POST', 'DELETE']) {
      const res = await app.request(method === 'GET' ? '/api/read' : '/api/write', {
        method,
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(res.status).toBe(403);
    }
  });

  it('admits same-origin and non-browser requests', async () => {
    const app = makeApp();
    // A browser on the app's own origin.
    const same = await app.request('/api/write', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(same.status).toBe(200);
    // curl, the desktop updater: no Sec-Fetch-Site at all.
    const plain = await app.request('/api/read');
    expect(plain.status).toBe(200);
  });

  it('refuses the content types an HTML form can produce', async () => {
    const app = makeApp();
    // The legacy-browser CSRF vector: a cross-site form posts with no
    // Sec-Fetch-Site header, but it cannot avoid declaring a form type.
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await app.request('/api/write', {
        method: 'POST',
        headers: { 'content-type': type },
        body: '{"confirm":"wipe everything"}',
      });
      expect(res.status).toBe(415);
    }
  });

  it('admits JSON bodies and body-less state changes', async () => {
    const app = makeApp();
    const json = await app.request('/api/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: '{}',
    });
    expect(json.status).toBe(200);
    // DELETEs carry no content type; they must not be caught.
    const del = await app.request('/api/write', { method: 'DELETE' });
    expect(del.status).toBe(200);
  });

  it('leaves the streaming source upload alone', async () => {
    const app = makeApp();
    const res = await app.request('/api/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/x-chess-pgn' },
      body: '[Event "?"]',
    });
    expect(res.status).toBe(200);
  });

  it('leaves the streaming book uploads alone, and nothing that merely looks like them', async () => {
    const app = makeApp();
    app.post('/api/books', (c) => c.json({ ok: true }));
    app.put('/api/books/:id/pdf', (c) => c.json({ ok: true }));
    app.put('/api/books/:id/cover', (c) => c.json({ ok: true }));
    const pdf = { 'content-type': 'application/pdf' };
    expect(
      (await app.request('/api/books', { method: 'POST', headers: pdf, body: '%PDF-' })).status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/books/b0123456789abcdef/pdf', {
          method: 'PUT',
          headers: pdf,
          body: '%PDF-',
        })
      ).status,
    ).toBe(200);
    // A sibling JSON route keeps the content-type check.
    expect(
      (
        await app.request('/api/books/b0123456789abcdef/cover', {
          method: 'PUT',
          headers: { 'content-type': 'text/plain' },
          body: 'x',
        })
      ).status,
    ).toBe(415);
    // Check 1 still covers the exempted routes.
    expect(
      (
        await app.request('/api/books', {
          method: 'POST',
          headers: { ...pdf, 'sec-fetch-site': 'cross-site' },
          body: '%PDF-',
        })
      ).status,
    ).toBe(403);
  });

  it('pins Host to loopback names when loopback-bound', async () => {
    const app = makeApp({ loopbackOnly: true });
    for (const host of ['127.0.0.1:8788', 'localhost:8788', '[::1]:8788']) {
      const res = await app.request('/api/read', { headers: { host } });
      expect(res.status).toBe(200);
    }
    // The DNS-rebinding shape: the browser resolved an attacker's name to
    // 127.0.0.1, so the request arrives with that name as its Host.
    const rebound = await app.request('/api/read', { headers: { host: 'attacker.example:8788' } });
    expect(rebound.status).toBe(403);
  });

  it('does not pin Host on a normal deployment', async () => {
    const app = makeApp();
    const res = await app.request('/api/read', { headers: { host: 'vault.tailnet.example' } });
    expect(res.status).toBe(200);
  });
});
