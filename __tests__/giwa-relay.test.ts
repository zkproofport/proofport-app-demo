import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { depositAction } from './fixtures/giwa';

const origin = 'http://localhost:3300/api/giwa-relay/';
const context = (endpoint: string) => ({ params: Promise.resolve({ path: endpoint.split('/') }) });
const valid = { circuitId: 'giwa_attestation', inputs: { scope: 'giwa-vault:v1:' + 'ab'.repeat(32) } };
const upstream = 'https://staging-relay.example';
let GET: typeof import('../app/api/giwa-relay/[...path]/route').GET;
let POST: typeof import('../app/api/giwa-relay/[...path]/route').POST;
beforeEach(async () => {
  vi.stubEnv('RELAY_URL', upstream);
  vi.stubEnv('NEXT_PUBLIC_RELAY_URL', 'https://wrong-browser-relay.example');
  vi.resetModules();
  ({ GET, POST } = await import('../app/api/giwa-relay/[...path]/route'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Vault relay adapter', () => {
  it('forwards challenge requests without forwarding cookies or authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"requestId":"example"}'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest(origin + 'api/v1/challenge', { headers: { cookie: 'private=secret', authorization: 'Bearer private' } }), context('api/v1/challenge'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(upstream + '/api/v1/challenge');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.redirect).toBe('error');
  });
  it('refuses missing server relay configuration even when a public browser URL is set', async () => {
    vi.stubEnv('RELAY_URL', undefined);
    vi.resetModules();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const route = await import('../app/api/giwa-relay/[...path]/route');
    const response = await route.GET(new NextRequest(origin), context('api/v1/challenge'));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/RELAY_URL|configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('forwards the exact vault scope and typed action without dropping or rewriting fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"requestId":"example"}'));
    vi.stubGlobal('fetch', fetchMock);
    const body = { ...valid, inputs: { ...valid.inputs, action: depositAction() }, signature: 'signed-challenge', nonce: 'challenge-nonce' };
    const response = await POST(new NextRequest(origin + 'api/v1/proof/request', { method: 'POST', body: JSON.stringify(body) }), context('api/v1/proof/request'));
    expect(response.status).toBe(200);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(upstream + '/api/v1/proof/request');
    expect(JSON.parse(options.body)).toEqual(body);
  });
  it('polls the same request through the configured server relay', async () => {
    const requestId = '11111111-2222-4333-8444-555555555555';
    const result = { requestId, status: 'pending' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result)));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest(origin), context('api/v1/proof/' + requestId));
    expect(await response.json()).toEqual(result);
    expect(fetchMock.mock.calls[0][0]).toBe(upstream + '/api/v1/proof/' + requestId);
  });
  it('retains the public mobile deep link returned by the relay', async () => {
    const deepLink = 'zkproofport://proof?callbackUrl=https%3A%2F%2Frelay.zkproofport.app';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ deepLink }))));
    const response = await POST(new NextRequest(origin + 'api/v1/proof/request', { method: 'POST', body: JSON.stringify(valid) }), context('api/v1/proof/request'));
    expect(await response.json()).toEqual({ deepLink });
  });
  it.each(['api/v1/proof/callback', 'api/v1/admin', '../api/v1/challenge', 'https://other.example/api/v1/challenge'])('rejects unsupported routes: %s', async endpoint => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest(origin), context(endpoint));
    expect(response.status).toBe(404); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects other circuits and non-vault scopes before forwarding', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const body of [{ ...valid, circuitId: 'coinbase_attestation' }, { ...valid, inputs: { scope: 'community' } }]) {
      const response = await POST(new NextRequest(origin, { method: 'POST', body: JSON.stringify(body) }), context('api/v1/proof/request'));
      expect(response.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['', ' ', null, undefined, 'giwa-vault:v1:' + 'ab'.repeat(31), 'giwa-vault:v1:' + 'ab'.repeat(33), 'giwa-vault:v1:' + 'GG'.repeat(32), 'giwa-vault:v1:%_\\', 'giwa-vault:v1:<script>', 'giwa-vault:v1:곶간👛\n'])('rejects malformed vault scopes: %s', scope => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    return POST(new NextRequest(origin, { method: 'POST', body: JSON.stringify({ ...valid, inputs: { scope } }) }), context('api/v1/proof/request')).then(response => {
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
  it.each(['', ' ', '{', 'null', '[]', '{}'])('rejects malformed request bodies before forwarding: %s', body => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    return POST(new NextRequest(origin, { method: 'POST', body }), context('api/v1/proof/request')).then(response => {
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
  it('rejects an oversized request before forwarding', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const body = JSON.stringify({ ...valid, message: 'a'.repeat(16385) });
    const response = await POST(new NextRequest(origin, { method: 'POST', body }), context('api/v1/proof/request'));
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns a retryable error when upstream is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private upstream details')));
    const response = await GET(new NextRequest(origin), context('api/v1/challenge'));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('private upstream details');
  });
});
