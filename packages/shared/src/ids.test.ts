import { expect, test } from 'vitest';
import { COLLAB_COLORS, pickColor } from './colors';
import { newProjectId, newToken } from './ids';
import { LIMITS } from './limits';

test('newProjectId', () => {
  const id = newProjectId();
  expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(newProjectId()).not.toBe(id);
});

test('newToken', () => {
  expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
});

test('pickColor is stable and in palette', () => {
  expect(pickColor('u1')).toBe(pickColor('u1'));
  expect(COLLAB_COLORS).toContain(pickColor('u1'));
  expect(COLLAB_COLORS).toHaveLength(8);
});

test('limits', () => {
  expect(LIMITS.maxFileBytes).toBe(1_000_000);
  expect(LIMITS.siteCapBytes).toBe(400_000_000);
});
