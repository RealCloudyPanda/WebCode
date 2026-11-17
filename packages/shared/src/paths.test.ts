import { describe, expect, test } from 'vitest';
import { isIgnoredPath, isLockfile, isProbablyBinary, normalizePath } from './paths';

describe('normalizePath', () => {
  test.each([
    ['src/a.ts', 'src/a.ts'],
    ['./src//a.ts', 'src/a.ts'],
    ['src\\a.ts', 'src/a.ts'],
    ['src/./a.ts', 'src/a.ts'],
    ['src/a/', 'src/a'],
    ['../x', null],
    ['src/../../x', null],
    ['/etc/passwd', null],
    ['', null],
    ['.', null],
    ['./', null],
    ['a\0b', null],
  ])('normalizePath(%j) -> %j', (input, out) => expect(normalizePath(input)).toBe(out));
});

test('ignored dirs', () => {
  expect(isIgnoredPath('node_modules/x/index.js')).toBe(true);
  expect(isIgnoredPath('packages/a/dist/x.js')).toBe(true);
  expect(isIgnoredPath('src/distance.ts')).toBe(false);
});

test('lockfiles', () => {
  expect(isLockfile('a/pnpm-lock.yaml')).toBe(true);
  expect(isLockfile('package.json')).toBe(false);
});

test('isProbablyBinary', () => {
  expect(isProbablyBinary(new TextEncoder().encode('a\r\nb'))).toBe(false);
  expect(isProbablyBinary(new Uint8Array([0x61, 0x00]))).toBe(true);
  expect(isProbablyBinary(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(true);
});
