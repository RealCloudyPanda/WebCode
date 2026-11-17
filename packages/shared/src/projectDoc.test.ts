import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { docStats, docToFiles, getDirs, getFiles, getMeta, previewText, seedDoc } from './projectDoc';

describe('projectDoc', () => {
  test('seed/docToFiles round-trip incl. CRLF', () => {
    const d = new Y.Doc();
    seedDoc(d, { 'src/a.ts': 'x\r\ny', 'README.md': '# hi' }, 'demo');
    expect(docToFiles(d)).toEqual({ 'src/a.ts': 'x\r\ny', 'README.md': '# hi' });
    expect(getMeta(d).get('title')).toBe('demo');
    expect(getFiles(d).get('README.md')).toBeInstanceOf(Y.Text);
    expect(getDirs(d).size).toBe(0);
  });
  test('seedDoc rejects traversal', () => expect(() => seedDoc(new Y.Doc(), { '../x': '' }, 't')).toThrow());
  test('seedDoc normalizes paths', () => {
    const d = new Y.Doc();
    seedDoc(d, { './a.ts': '1' }, 't');
    expect(Object.keys(docToFiles(d))).toEqual(['a.ts']);
  });
  test('docStats', () => {
    const d = new Y.Doc();
    seedDoc(d, { 'a.ts': 'abc', 'b.ts': '' }, 't');
    const s = docStats(d);
    expect(s.fileCount).toBe(2);
    expect(s.storedBytes).toBe(Y.encodeStateAsUpdate(d).byteLength);
  });
});

describe('previewText', () => {
  test('prefers README', () =>
    expect(previewText({ 'README.md': '# T\nline', 'src/index.ts': 'x' })).toBe('# T\nline'));
  test('index order', () => {
    expect(previewText({ 'src/index.js': 'js', 'src/index.tsx': 'tsx' })).toBe('tsx');
    expect(previewText({ 'src/index.ts': 'ts', 'src/index.tsx': 'tsx' })).toBe('ts');
  });
  test('src/main.* alphabetical', () =>
    expect(previewText({ 'src/main.py': 'py', 'src/main.go': 'go', 'a.txt': 'a' })).toBe('go'));
  test('falls back to first path alphabetically', () => expect(previewText({ 'z.txt': 'z', 'b.txt': 'b' })).toBe('b'));
  test('empty', () => expect(previewText({})).toBe(''));
  test('first 6 lines only', () =>
    expect(previewText({ 'README.md': '1\n2\n3\n4\n5\n6\n7\n8' })).toBe('1\n2\n3\n4\n5\n6'));
  test('caps at 400 chars', () => expect(previewText({ 'README.md': 'a'.repeat(1000) })).toHaveLength(400));
});
