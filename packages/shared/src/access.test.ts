import { describe, expect, test } from 'vitest';
import { resolveAccess } from './access';

const proj = { ownerId: 'u1', ownerGuestId: null, linkAccess: 'viewer' as const };

describe('resolveAccess', () => {
  test('owner', () => expect(resolveAccess(proj, { kind: 'user', userId: 'u1' })).toBe('owner'));
  test('link viewer', () => expect(resolveAccess(proj, { kind: 'guest', guestId: 'g' })).toBe('viewer'));
  test('link editor', () =>
    expect(resolveAccess({ ...proj, linkAccess: 'editor' }, { kind: 'user', userId: 'u2' })).toBe('editor'));
  test('anonymous gets link role', () => expect(resolveAccess(proj, { kind: 'anonymous' })).toBe('viewer'));
  test('restricted', () =>
    expect(resolveAccess({ ...proj, linkAccess: 'restricted' }, { kind: 'user', userId: 'u2' })).toBe('none'));
  test('restricted anonymous', () =>
    expect(resolveAccess({ ...proj, linkAccess: 'restricted' }, { kind: 'anonymous' })).toBe('none'));
  test('guest owner', () =>
    expect(
      resolveAccess({ ownerId: null, ownerGuestId: 'g1', linkAccess: 'restricted' }, { kind: 'guest', guestId: 'g1' }),
    ).toBe('owner'));
  test('null owner ids never match', () =>
    expect(resolveAccess({ ownerId: null, ownerGuestId: null, linkAccess: 'restricted' }, { kind: 'anonymous' })).toBe('none'));
});
