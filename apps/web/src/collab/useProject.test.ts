import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { HocuspocusProviderConfiguration } from '@hocuspocus/provider';

type Config = HocuspocusProviderConfiguration & Record<string, any>;

const instances: FakeProvider[] = [];

class FakeProvider {
  config: Config;
  unsyncedChanges = 0;
  awareness = { fake: 'awareness' };
  destroyed = false;
  constructor(config: Config) {
    this.config = config;
    instances.push(this);
  }
  destroy() {
    this.destroyed = true;
  }
}

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: vi.fn().mockImplementation((c: Config) => new FakeProvider(c)),
}));

const { useProject, STATUS_COPY } = await import('./useProject');

const last = () => instances[instances.length - 1]!;
const fire = (fn: () => void) => act(fn);

beforeEach(() => {
  instances.length = 0;
});

describe('useProject', () => {
  test('connects to /collab with the project id as the document name', () => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    expect(p.config.name).toBe('p1');
    expect(p.config.url).toBe(`ws://${location.host}/collab`);
    expect(p.config.document).toBe(result.current.doc);
    expect(result.current.provider).toBe(p);
    expect(result.current.awareness).toBe(p.awareness);
    expect(result.current).toMatchObject({ status: 'connecting', fatal: null, sizeLocked: false, role: null, readOnly: true });
  });

  test('status: connecting → saved → saving → saved → offline', () => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onStatus!({ status: 'connected' as any }));
    expect(result.current.status).toBe('connecting');
    fire(() => p.config.onSynced!({ state: true }));
    expect(result.current.status).toBe('saved');
    fire(() => {
      p.unsyncedChanges = 2;
      p.config.onUnsyncedChanges!({ number: 2 });
    });
    expect(result.current.status).toBe('saving');
    fire(() => {
      p.unsyncedChanges = 0;
      p.config.onUnsyncedChanges!({ number: 0 });
    });
    expect(result.current.status).toBe('saved');
    fire(() => p.config.onStatus!({ status: 'disconnected' as any }));
    expect(result.current.status).toBe('offline');
    fire(() => p.config.onStatus!({ status: 'connecting' as any }));
    expect(result.current.status).toBe('offline');
    fire(() => p.config.onStatus!({ status: 'connected' as any }));
    fire(() => p.config.onSynced!({ state: true }));
    expect(result.current.status).toBe('saved');
  });

  test('disconnect before the first sync stays connecting', () => {
    const { result } = renderHook(() => useProject('p1'));
    fire(() => last().config.onStatus!({ status: 'disconnected' as any }));
    expect(result.current.status).toBe('connecting');
  });

  test('role and size-lock stateless messages', () => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onStateless!({ payload: JSON.stringify({ type: 'role', role: 'editor', readOnly: false }) }));
    expect(result.current).toMatchObject({ role: 'editor', readOnly: false });
    fire(() => p.config.onStateless!({ payload: JSON.stringify({ type: 'size-locked' }) }));
    expect(result.current.sizeLocked).toBe(true);
    fire(() => p.config.onStateless!({ payload: JSON.stringify({ type: 'role', role: 'editor', readOnly: true }) }));
    expect(result.current).toMatchObject({ role: 'editor', readOnly: true });
    fire(() => p.config.onStateless!({ payload: JSON.stringify({ type: 'size-unlocked' }) }));
    expect(result.current.sizeLocked).toBe(false);
    fire(() => p.config.onStateless!({ payload: 'not json' }));
    fire(() => p.config.onStateless!({ payload: JSON.stringify({ type: 'role', role: 'admin', readOnly: false }) }));
    expect(result.current).toMatchObject({ role: 'editor', readOnly: true });
  });

  test.each([
    ['no-access', 'no-access'],
    ['need-guest', 'need-guest'],
    ['too-many', 'too-many'],
    ['not-found', 'deleted'],
  ])('auth failure %s → fatal %s, provider stopped', async (reason, fatal) => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onAuthenticationFailed!({ reason }));
    expect(result.current.fatal).toBe(fatal);
    await act(async () => {});
    expect(p.destroyed).toBe(true);
    expect(result.current.provider).toBeNull();
    expect(result.current.awareness).toBeNull();
  });

  test.each([
    [4403, 'revoked'],
    [4404, 'deleted'],
  ])('close code %i → fatal %s, provider stopped', async (code, fatal) => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onClose!({ event: { code } as CloseEvent }));
    expect(result.current.fatal).toBe(fatal);
    await act(async () => {});
    expect(p.destroyed).toBe(true);
  });

  test('ordinary close codes are not fatal', async () => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onClose!({ event: { code: 1006 } as CloseEvent }));
    await act(async () => {});
    expect(result.current.fatal).toBeNull();
    expect(p.destroyed).toBe(false);
  });

  test('the first fatal wins', () => {
    const { result } = renderHook(() => useProject('p1'));
    const p = last();
    fire(() => p.config.onClose!({ event: { code: 4404 } as CloseEvent }));
    fire(() => p.config.onClose!({ event: { code: 4403 } as CloseEvent }));
    expect(result.current.fatal).toBe('deleted');
  });

  test('unmount destroys the provider; a new id gets a new doc and provider', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useProject(id), { initialProps: { id: 'p1' } });
    const first = last();
    const firstDoc = result.current.doc;
    rerender({ id: 'p2' });
    expect(first.destroyed).toBe(true);
    expect(last().config.name).toBe('p2');
    expect(result.current.doc).not.toBe(firstDoc);
    unmount();
    expect(last().destroyed).toBe(true);
  });

  test('status copy is verbatim', () => {
    expect(STATUS_COPY).toEqual({
      saving: 'Saving…',
      saved: 'Saved',
      offline: 'Offline – changes will sync when you reconnect',
    });
  });
});
