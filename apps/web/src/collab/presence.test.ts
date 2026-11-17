import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { remoteCursorCss, setLocalFile, setLocalUser, usePeers, type Peer } from './presence';

const alice = { id: 'u1', name: 'Alice', color: '#f28b82', kind: 'github' as const };
const bob = { id: 'g1', name: 'Bob', color: '#81c995', kind: 'guest' as const };

const peer = (name: string, color = '#81c995', clientId = 7): Peer => ({
  clientId,
  user: { id: 'x', name, color, kind: 'guest' },
  file: null,
});

/** Copies `from`'s local state into `to`, as the provider would over the wire. */
const relay = (from: Awareness, to: Awareness) =>
  applyAwarenessUpdate(to, encodeAwarenessUpdate(from, [from.clientID]), 'remote');

describe('local state', () => {
  test('setLocalUser and setLocalFile set awareness fields', () => {
    const a = new Awareness(new Y.Doc());
    setLocalUser(a, alice);
    setLocalFile(a, 'src/a.ts');
    expect(a.getLocalState()).toMatchObject({ user: alice, file: 'src/a.ts' });
    setLocalFile(a, null);
    expect(a.getLocalState()!.file).toBeNull();
  });
});

describe('usePeers', () => {
  test('lists remote peers, excluding self, and follows changes', () => {
    const local = new Awareness(new Y.Doc());
    const remote = new Awareness(new Y.Doc());
    setLocalUser(local, alice);
    const { result } = renderHook(() => usePeers(local));
    expect(result.current).toEqual([]);

    setLocalUser(remote, bob);
    setLocalFile(remote, 'README.md');
    act(() => relay(remote, local));
    expect(result.current).toEqual([{ clientId: remote.clientID, user: bob, file: 'README.md' }]);

    act(() => removeAwarenessStates(local, [remote.clientID], 'remote'));
    expect(result.current).toEqual([]);
  });

  test('skips peers without a well-formed user', () => {
    const local = new Awareness(new Y.Doc());
    const remote = new Awareness(new Y.Doc());
    remote.setLocalStateField('user', { name: 42 });
    act(() => relay(remote, local));
    const { result } = renderHook(() => usePeers(local));
    expect(result.current).toEqual([]);
  });

  test('null awareness gives no peers', () => {
    const { result } = renderHook(() => usePeers(null));
    expect(result.current).toEqual([]);
  });
});

describe('remoteCursorCss', () => {
  test('emits selection, head and name-flag rules per peer', () => {
    const css = remoteCursorCss([peer('Bob', '#81c995', 12)]);
    expect(css).toContain('.yRemoteSelection-12');
    expect(css).toContain('background-color: rgba(129, 201, 149, 0.25)');
    expect(css).toContain('.yRemoteSelectionHead-12');
    expect(css).toMatch(/\.yRemoteSelectionHead-12 \{[^}]*border-color: #81c995/);
    expect(css).toContain('.yRemoteSelectionHead-12::after');
    expect(css).toContain('content: "Bob"');
  });

  test('remoteCursorCss escapes names', () => {
    expect(remoteCursorCss([peer('Jo"e')])).toContain('content: "Jo\\"e"');
    expect(remoteCursorCss([peer('a\\b')])).toContain('content: "a\\\\b"');
    expect(remoteCursorCss([peer('x\n} body { display: none')])).not.toContain('\n} body');
  });

  test('ignores a colour that is not a hex colour', () => {
    const css = remoteCursorCss([peer('Eve', 'red; } body { display: none')]);
    expect(css).not.toContain('display: none');
  });

  test('empty list gives empty css', () => {
    expect(remoteCursorCss([])).toBe('');
  });
});
