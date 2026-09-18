import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/giwa-relay/[...path]/route';

const origin = 'http://localhost:3300/api/giwa-relay/';
const context = (endpoint: string) => ({ params: Promise.resolve({ path: endpoint.split('/') }) });
const valid = { circuitId: 'giwa_attestation', inputs: { scope: 'giwa-vault:v1:' + 'ab'.repeat(32) } };
afterEach(() => vi.unstubAllGlobals());

describe('Vault relay adapter', () => {
  it('forwards challenge requests without forwarding cookies or authorization', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"requestId":"example"}'));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest(origin + 'api/v1/challenge', { headers: { cookie: 'private=secret', authorization: 'Bearer private' } }), context('api/v1/challenge'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/challenge$/);
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.redirect).toBe('error');
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
  it('returns a retryable error when upstream is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private upstream details')));
    const response = await GET(new NextRequest(origin), context('api/v1/challenge'));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('private upstream details');
  });
});
