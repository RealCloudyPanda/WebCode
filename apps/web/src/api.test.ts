import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, api } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it('post throws ApiFailure with status and message on 409', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'conflict', message: 'Already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const err = (await api.post("/api/x", { a: 1 }).catch((e) => e)) as ApiFailure;
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(409);
    expect(err.error).toBe('conflict');
    expect(err.message).toBe('Already exists');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('returns undefined for 204', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    expect(await api.del('/api/x')).toBeUndefined();
  });

  it('gives friendly messages when the server omits one', async () => {
    const mk = (status: number) => vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"x"}', { status })));
    mk(404);
    expect(((await api.get('/a').catch((e) => e)) as ApiFailure).message).toBe('That project no longer exists');
    mk(401);
    expect(((await api.get('/a').catch((e) => e)) as ApiFailure).message).toBe('Please sign in again');
    mk(500);
    expect(((await api.get('/a').catch((e) => e)) as ApiFailure).message).toBe('Something went wrong, try again');
    mk(400);
    const e400 = (await api.get('/a').catch((e) => e)) as ApiFailure;
    expect(e400.message).toBe('Request failed');
    expect(e400.error).toBe('x');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const net = (await api.get('/a').catch((e) => e)) as ApiFailure;
    expect(net.message).toBe('Something went wrong, try again');
  });
});
