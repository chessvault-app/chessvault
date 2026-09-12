import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { crossSiteGuard, type CrossSiteOptions } from './crossSite.ts';

function makeApp(opts: CrossSiteOptions = {}): Hono {
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

  it('refuses a state change from another origin, whatever the body looks like', async () => {
    const app = makeApp();
    const host = 'vault.tail1234.ts.net:8787';
    // The shape checks 1 and 2 both miss: no Sec-Fetch-Site (plain http to
    // a non-loopback host is not a trustworthy url, so browsers omit it)
    // and no Content-Type at all (a Blob with an empty type sets none).
    // Declared as JSON, so check 2 would pass it; only the Origin refuses.
    const drive = await app.request('/api/write', {
      method: 'POST',
      headers: { host, origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: '{"confirm":"wipe everything"}',
    });
    expect(drive.status).toBe(403);
    // The exempted streaming uploads are covered too: this check reads no body.
    const upload = await app.request('/api/sources', {
      method: 'POST',
      headers: { host, origin: 'https://attacker.example', 'content-type': 'application/x-chess-pgn' },
      body: '[Event "?"]',
    });
    expect(upload.status).toBe(403);
    // An Origin that parses as nothing (a sandboxed iframe) belongs to nobody.
    const opaque = await app.request('/api/write', {
      method: 'POST',
      headers: { host, origin: 'null' },
      body: '{}',
    });
    expect(opaque.status).toBe(403);
    // Reads are not state changes; checks 1 and 4 cover those.
    expect(
      (await app.request('/api/read', { headers: { host, origin: 'https://attacker.example' } }))
        .status,
    ).toBe(200);
  });

  it('admits the origins that are this server', async () => {
    const app = makeApp();
    const ok = async (headers: Record<string, string>): Promise<number> =>
      (
        await app.request('/api/write', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: '{}',
        })
      ).status;
    // The app's own page, port and all.
    expect(await ok({ host: 'vault.ts.net:8787', origin: 'http://vault.ts.net:8787' })).toBe(200);
    // Behind a TLS-terminating proxy that rewrites Host. A cross-site page
    // cannot set X-Forwarded-Host: a custom header forces a preflight.
    expect(
      await ok({
        host: '127.0.0.1:8787',
        'x-forwarded-host': 'vault.example',
        origin: 'https://vault.example',
      }),
    ).toBe(200);
    // The Vite dev proxy: changeOrigin rewrites Host, Origin stays the
    // browser's. Both ends loopback.
    expect(await ok({ host: '127.0.0.1:8787', origin: 'http://localhost:5173' })).toBe(200);
    // Another port on the same public host is still somebody else.
    expect(await ok({ host: 'vault.ts.net:8787', origin: 'http://vault.ts.net:3000' })).toBe(403);
    // curl and the updater send no Origin at all.
    expect(await ok({ host: 'vault.ts.net:8787' })).toBe(200);
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

  it('vouches for the Hosts an ungated network server can, and no other', async () => {
    const app = makeApp({ gated: () => false, allowedHosts: ['vault.home.example'] });
    for (const host of [
      '192.168.1.20:8787',
      '100.101.102.103',
      '[fd7a:115c:a1e0::1]:8787',
      'localhost:8787',
      'study-mac.local:8787',
      'study-mac.tail1234.ts.net',
      'Vault.Home.Example:8787',
    ]) {
      const res = await app.request('/api/read', { headers: { host } });
      expect(res.status, host).toBe(200);
    }
    // The rebind: an outside name the browser now resolves to this box.
    for (const host of ['attacker.example', 'attacker.example:8787', 'ts.net.attacker.example']) {
      const res = await app.request('/api/read', { headers: { host } });
      expect(res.status, host).toBe(403);
    }
    // No Host at all (an HTTP/1.0 tool) is not a browser and is let by.
    expect((await app.request('/api/read')).status).toBe(200);
  });

  it('drops the Host check the moment a password is on', async () => {
    let gated = false;
    const app = makeApp({ gated: () => gated });
    const attacker = { headers: { host: 'attacker.example' } };
    expect((await app.request('/api/read', attacker)).status).toBe(403);
    gated = true;
    expect((await app.request('/api/read', attacker)).status).toBe(200);
  });
});
