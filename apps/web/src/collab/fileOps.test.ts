import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { docToFiles, getDirs, getFiles, LIMITS } from '@webcode/shared';
import { createDir, createFile, deleteEntry, FileOpError, listTree, renameEntry } from './fileOps';

const code = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FileOpError) return e.code;
    throw e;
  }
  return undefined;
};

describe('createFile', () => {
  test('creates a file with content under a normalized path', () => {
    const d = new Y.Doc();
    createFile(d, './src//a.ts', 'x');
    expect(docToFiles(d)).toEqual({ 'src/a.ts': 'x' });
  });

  test('defaults to empty content', () => {
    const d = new Y.Doc();
    createFile(d, 'a.ts');
    expect(docToFiles(d)).toEqual({ 'a.ts': '' });
  });

  test('rejects invalid, existing, ignored and too-large paths', () => {
    const d = new Y.Doc();
    createFile(d, 'a.ts');
    createDir(d, 'dir');
    expect(code(() => createFile(d, '../x'))).toBe('invalid-path');
    expect(code(() => createFile(d, ''))).toBe('invalid-path');
    expect(code(() => createFile(d, 'a.ts'))).toBe('exists');
    expect(code(() => createFile(d, 'dir'))).toBe('exists');
    expect(code(() => createFile(d, 'a.ts/b.ts'))).toBe('exists');
    expect(code(() => createFile(d, 'node_modules/x.js'))).toBe('ignored');
    expect(code(() => createFile(d, 'big.txt', 'a'.repeat(LIMITS.maxFileBytes + 1)))).toBe('too-large');
  });

  test('too-large counts UTF-8 bytes, not characters', () => {
    const d = new Y.Doc();
    const twoByte = 'é'.repeat(LIMITS.maxFileBytes / 2 + 1);
    expect(code(() => createFile(d, 'big.txt', twoByte))).toBe('too-large');
  });

  test('refuses past the file-count limit', () => {
    const d = new Y.Doc();
    d.transact(() => {
      for (let i = 0; i < LIMITS.maxFiles; i++) getFiles(d).set(`f${i}`, new Y.Text());
    });
    expect(code(() => createFile(d, 'one-more.ts'))).toBe('too-many');
  });
});

describe('createDir', () => {
  test('records an explicit folder', () => {
    const d = new Y.Doc();
    createDir(d, 'src/empty/');
    expect(getDirs(d).has('src/empty')).toBe(true);
  });

  test('rejects an existing file, folder or implicit folder', () => {
    const d = new Y.Doc();
    createFile(d, 'src/a.ts');
    createDir(d, 'lib');
    expect(code(() => createDir(d, 'src/a.ts'))).toBe('exists');
    expect(code(() => createDir(d, 'lib'))).toBe('exists');
    expect(code(() => createDir(d, 'src'))).toBe('exists');
    expect(code(() => createDir(d, '/abs'))).toBe('invalid-path');
  });
});

describe('deleteEntry', () => {
  test('deletes a file', () => {
    const d = new Y.Doc();
    createFile(d, 'a.ts');
    createFile(d, 'b.ts');
    deleteEntry(d, 'a.ts');
    expect(Object.keys(docToFiles(d))).toEqual(['b.ts']);
  });

  test('delete dir removes nested files and folders', () => {
    const d = new Y.Doc();
    createDir(d, 'src');
    createFile(d, 'src/a.ts', 'x');
    createFile(d, 'src/deep/b.ts', 'y');
    createDir(d, 'src/empty');
    createFile(d, 'srcfile.ts');
    deleteEntry(d, 'src');
    expect(Object.keys(docToFiles(d))).toEqual(['srcfile.ts']);
    expect([...getDirs(d).keys()]).toEqual([]);
  });

  test('deletes in one transaction', () => {
    const d = new Y.Doc();
    createFile(d, 'src/a.ts');
    createFile(d, 'src/b.ts');
    let updates = 0;
    d.on('update', () => updates++);
    deleteEntry(d, 'src');
    expect(updates).toBe(1);
  });

  test('missing path throws not-found', () => {
    const d = new Y.Doc();
    expect(code(() => deleteEntry(d, 'nope'))).toBe('not-found');
  });
});

describe('renameEntry', () => {
  test('renames a file, keeping content', () => {
    const d = new Y.Doc();
    createFile(d, 'a.ts', 'hello');
    renameEntry(d, 'a.ts', 'src/b.ts');
    expect(docToFiles(d)).toEqual({ 'src/b.ts': 'hello' });
  });

  test('rename dir moves children', () => {
    const d = new Y.Doc();
    createFile(d, 'src/a.ts', 'x');
    createDir(d, 'src/empty');
    renameEntry(d, 'src', 'lib');
    expect(Object.keys(docToFiles(d))).toEqual(['lib/a.ts']);
    expect(docToFiles(d)['lib/a.ts']).toBe('x');
    expect(getDirs(d).has('lib/empty')).toBe(true);
    expect(getDirs(d).has('src/empty')).toBe(false);
  });

  test('rename is one transaction', () => {
    const d = new Y.Doc();
    createFile(d, 'src/a.ts', 'x');
    createFile(d, 'src/b.ts', 'y');
    let updates = 0;
    d.on('update', () => updates++);
    renameEntry(d, 'src', 'lib');
    expect(updates).toBe(1);
  });

  test('rename onto existing path throws', () => {
    const d = new Y.Doc();
    createFile(d, 'a.ts');
    createFile(d, 'b.ts');
    expect(() => renameEntry(d, 'a.ts', 'b.ts')).toThrow(FileOpError);
    expect(code(() => renameEntry(d, 'a.ts', 'b.ts'))).toBe('exists');
  });

  test('rejects missing source, invalid target and moving a folder into itself', () => {
    const d = new Y.Doc();
    createFile(d, 'src/a.ts');
    expect(code(() => renameEntry(d, 'nope', 'x'))).toBe('not-found');
    expect(code(() => renameEntry(d, 'src/a.ts', '../x'))).toBe('invalid-path');
    expect(code(() => renameEntry(d, 'src', 'src/inner'))).toBe('invalid-path');
    expect(code(() => renameEntry(d, 'src', 'dist'))).toBe('ignored');
  });
});

describe('listTree', () => {
  test('listTree dirs first', () => {
    const d = new Y.Doc();
    createFile(d, 'README.md');
    createFile(d, 'src/a.ts');
    expect(listTree(d).map((n) => n.name)).toEqual(['src', 'README.md']);
  });

  test('nests implicit and explicit folders, sorted alphabetically', () => {
    const d = new Y.Doc();
    createFile(d, 'src/z.ts');
    createFile(d, 'src/b.ts');
    createFile(d, 'src/util/x.ts');
    createDir(d, 'src/empty');
    createDir(d, 'assets');
    createFile(d, 'a.md');
    expect(listTree(d)).toEqual([
      { name: 'assets', path: 'assets', kind: 'dir', children: [] },
      {
        name: 'src',
        path: 'src',
        kind: 'dir',
        children: [
          { name: 'empty', path: 'src/empty', kind: 'dir', children: [] },
          { name: 'util', path: 'src/util', kind: 'dir', children: [{ name: 'x.ts', path: 'src/util/x.ts', kind: 'file' }] },
          { name: 'b.ts', path: 'src/b.ts', kind: 'file' },
          { name: 'z.ts', path: 'src/z.ts', kind: 'file' },
        ],
      },
      { name: 'a.md', path: 'a.md', kind: 'file' },
    ]);
  });
});
