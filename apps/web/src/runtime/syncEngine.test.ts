import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Y from 'yjs';
import { docToFiles, getDirs, getFiles, LIMITS, seedDoc } from '@webcode/shared';
import { MemoryFs } from './memoryFs';
import { SyncEngine } from './syncEngine';

/** Lets timers, watch events and fs promises run. */
const flush = async (rounds = 10) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
};

const engines: SyncEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop());
  vi.useRealTimers();
});

type Setup = { files?: Record<string, string>; canWriteBack?: () => boolean; debounceMs?: number };

async function setup({ files = { 'src/a.ts': 'x', 'package.json': '{"a":1}' }, canWriteBack = () => true, debounceMs = 0 }: Setup = {}) {
  const doc = new Y.Doc();
  seedDoc(doc, files, 't');
  const fs = new MemoryFs();
  const skipped: [string, string][] = [];
  const engine = new SyncEngine({ doc, fs, canWriteBack, debounceMs, onSkipped: (p, r) => skipped.push([p, r]) });
  engines.push(engine);
  await engine.start();
  await flush();
  return { doc, fs, engine, skipped };
}

const text = (doc: Y.Doc, path: string) => getFiles(doc).get(path)?.toString();

describe('start', () => {
  test('mounts doc files on start', async () => {
    const { fs } = await setup();
    expect(await fs.text('src/a.ts')).toBe('x');
    expect(await fs.text('package.json')).toBe('{"a":1}');
  });

  test('creates explicit folders and skips ignored paths', async () => {
    const doc = new Y.Doc();
    seedDoc(doc, { 'a.ts': '1' }, 't');
    getDirs(doc).set('src/empty', true);
    getFiles(doc).set('node_modules/evil.js', new Y.Text('x'));
    const fs = new MemoryFs();
    const engine = new SyncEngine({ doc, fs, canWriteBack: () => true, debounceMs: 0 });
    engines.push(engine);
    await engine.start();
    expect(fs.isDir('src/empty')).toBe(true);
    expect(await fs.snapshot()).toEqual({ 'a.ts': '1' });
  });

  test('mounting does not echo back into the doc', async () => {
    const { doc } = await setup();
    let updates = 0;
    doc.on('update', () => updates++);
    await flush();
    expect(updates).toBe(0);
  });
});

describe('doc → fs', () => {
  test('remote Yjs edit reaches fs', async () => {
    const { doc, fs } = await setup();
    getFiles(doc).get('src/a.ts')!.insert(0, 'y');
    await flush();
    expect(await fs.text('src/a.ts')).toBe('yx');
  });

  test('new, deleted and renamed files reach fs', async () => {
    const { doc, fs } = await setup();
    doc.transact(() => {
      getFiles(doc).set('lib/new.ts', new Y.Text('n'));
      getFiles(doc).delete('package.json');
    });
    await flush();
    expect(await fs.snapshot()).toEqual({ 'src/a.ts': 'x', 'lib/new.ts': 'n' });
  });

  test('new and deleted folders reach fs', async () => {
    const { doc, fs } = await setup();
    getDirs(doc).set('assets', true);
    await flush();
    expect(fs.isDir('assets')).toBe(true);
    getDirs(doc).delete('assets');
    await flush();
    expect(fs.isDir('assets')).toBe(false);
  });

  test('edits are debounced per file', async () => {
    vi.useFakeTimers();
    const { doc, fs } = await (async () => {
      const doc = new Y.Doc();
      seedDoc(doc, { 'a.ts': '', 'b.ts': '' }, 't');
      const fs = new MemoryFs();
      const engine = new SyncEngine({ doc, fs, canWriteBack: () => true });
      engines.push(engine);
      await engine.start();
      return { doc, fs };
    })();
    const writes = fs.writeCount;
    for (let i = 0; i < 5; i++) {
      getFiles(doc).get('a.ts')!.insert(i, 'a');
      await vi.advanceTimersByTimeAsync(50);
    }
    getFiles(doc).get('b.ts')!.insert(0, 'b');
    expect(fs.writeCount).toBe(writes);
    await vi.advanceTimersByTimeAsync(150);
    expect(fs.writeCount).toBe(writes + 2);
    expect(await fs.text('a.ts')).toBe('aaaaa');
    expect(await fs.text('b.ts')).toBe('b');
  });

  test('our own writes are not echoed back into the doc', async () => {
    const { doc, fs } = await setup();
    getFiles(doc).get('src/a.ts')!.insert(1, 'z');
    let updates = 0;
    doc.on('update', () => updates++);
    await flush();
    expect(await fs.text('src/a.ts')).toBe('xz');
    expect(updates).toBe(0);
  });
});

describe('fs → doc', () => {
  test('command output flows back as a diff', async () => {
    const { doc, fs } = await setup();
    const deltas: unknown[] = [];
    getFiles(doc).get('package.json')!.observe((e) => deltas.push(e.delta));
    fs.externalWrite('package.json', '{"a":1,"b":2}');
    await flush();
    expect(text(doc, 'package.json')).toBe('{"a":1,"b":2}');
    expect(deltas).toEqual([[{ retain: 6 }, { insert: ',"b":2' }]]);
  });

  test('lockfile replaced whole', async () => {
    const { doc, fs } = await setup({ files: { 'package-lock.json': '{"v":1,"deps":{}}' } });
    const t = getFiles(doc).get('package-lock.json')!;
    const del = vi.spyOn(t, 'delete');
    const ins = vi.spyOn(t, 'insert');
    fs.externalWrite('package-lock.json', '{"v":1,"deps":{"x":1}}');
    await flush();
    expect(t.toString()).toBe('{"v":1,"deps":{"x":1}}');
    expect(del.mock.calls).toEqual([[0, '{"v":1,"deps":{}}'.length]]);
    expect(ins.mock.calls).toEqual([[0, '{"v":1,"deps":{"x":1}}']]);
  });

  test('lockfile in a subfolder is replaced whole too', async () => {
    const { doc, fs } = await setup({ files: { 'app/yarn.lock': 'a\nb\n' } });
    const t = getFiles(doc).get('app/yarn.lock')!;
    const del = vi.spyOn(t, 'delete');
    fs.externalWrite('app/yarn.lock', 'a\nc\n');
    await flush();
    expect(del.mock.calls).toEqual([[0, 4]]);
    expect(t.toString()).toBe('a\nc\n');
  });

  test('new file on disk is added to the doc; deleted file is removed', async () => {
    const { doc, fs } = await setup();
    fs.externalWrite('src/gen.ts', 'export {}');
    await flush();
    expect(text(doc, 'src/gen.ts')).toBe('export {}');
    fs.externalRm('src/a.ts');
    await flush();
    expect(getFiles(doc).has('src/a.ts')).toBe(false);
  });

  test('a folder removed on disk removes its files and explicit folders', async () => {
    const { doc, fs } = await setup({ files: { 'src/a.ts': 'x', 'src/b/c.ts': 'y', 'keep.ts': 'k' } });
    getDirs(doc).set('src/empty', true);
    await flush();
    fs.externalRm('src');
    await flush();
    expect(docToFiles(doc)).toEqual({ 'keep.ts': 'k' });
    expect(getDirs(doc).has('src/empty')).toBe(false);
  });

  test('viewer (canWriteBack false) keeps changes local', async () => {
    const { doc, fs } = await setup({ canWriteBack: () => false });
    fs.externalWrite('src/a.ts', 'local');
    fs.externalWrite('new.ts', 'n');
    fs.externalRm('package.json');
    await flush();
    expect(text(doc, 'src/a.ts')).toBe('x');
    expect(getFiles(doc).has('new.ts')).toBe(false);
    expect(text(doc, 'package.json')).toBe('{"a":1}');
    // …and the local change is not overwritten while the doc is unchanged
    expect(await fs.text('src/a.ts')).toBe('local');
  });

  test('ignores node_modules and binaries', async () => {
    const { doc, fs, skipped } = await setup();
    fs.externalWrite('node_modules/x.js', 'a');
    fs.externalWrite('img.png', '\u0000');
    await flush();
    expect(getFiles(doc).has('node_modules/x.js')).toBe(false);
    expect(getFiles(doc).has('img.png')).toBe(false);
    expect(skipped).toEqual([['img.png', 'binary']]);
    expect(fs.readCount('node_modules/x.js')).toBe(0);
  });

  test('skips files over the size limit, keeping the doc text', async () => {
    const { doc, fs, skipped } = await setup();
    fs.externalWrite('src/a.ts', 'a'.repeat(LIMITS.maxFileBytes + 1));
    await flush();
    expect(text(doc, 'src/a.ts')).toBe('x');
    expect(skipped).toEqual([['src/a.ts', 'too-large']]);
  });

  test('deleting an ignored path is ignored', async () => {
    const { doc, fs } = await setup();
    fs.externalWrite('dist/out.js', 'x');
    await flush();
    let updates = 0;
    doc.on('update', () => updates++);
    fs.externalRm('dist');
    await flush();
    expect(updates).toBe(0);
  });

  test('preserves CRLF', async () => {
    const { doc, fs } = await setup();
    fs.externalWrite('a.txt', 'a\r\nb');
    await flush();
    expect(await fs.text('a.txt')).toBe('a\r\nb');
    expect(text(doc, 'a.txt')).toBe('a\r\nb');
    getFiles(doc).get('a.txt')!.insert(3, 'c\r\n');
    await flush();
    expect(await fs.text('a.txt')).toBe('a\r\nc\r\nb');
  });

  test('a disk change merges with an unflushed doc edit instead of reverting it', async () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    seedDoc(doc, { 'a.ts': 'line1\nline2\n' }, 't');
    const fs = new MemoryFs();
    const engine = new SyncEngine({ doc, fs, canWriteBack: () => true, debounceMs: 150 });
    engines.push(engine);
    await engine.start();
    getFiles(doc).get('a.ts')!.insert(0, '// remote\n'); // not yet on disk
    fs.externalWrite('a.ts', 'line1\nline2\nline3\n');
    await vi.advanceTimersByTimeAsync(500);
    expect(text(doc, 'a.ts')).toBe('// remote\nline1\nline2\nline3\n');
    expect(await fs.text('a.ts')).toBe('// remote\nline1\nline2\nline3\n');
  });

  test('stop() detaches from doc and fs', async () => {
    const { doc, fs, engine } = await setup();
    engine.stop();
    getFiles(doc).get('src/a.ts')!.insert(0, 'y');
    fs.externalWrite('package.json', '{}');
    await flush();
    expect(await fs.text('src/a.ts')).toBe('x');
    expect(text(doc, 'package.json')).toBe('{"a":1}');
  });
});

describe('two engines sharing a doc', () => {
  test('converges without echo loops when two engines share a doc', async () => {
    const docA = new Y.Doc();
    seedDoc(docA, { 'src/a.ts': 'x', 'package.json': '{"a":1}' }, 't');
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    docA.on('update', (u: Uint8Array, origin: unknown) => origin !== 'B' && Y.applyUpdate(docB, u, 'A'));
    docB.on('update', (u: Uint8Array, origin: unknown) => origin !== 'A' && Y.applyUpdate(docA, u, 'B'));

    const fsA = new MemoryFs();
    const fsB = new MemoryFs();
    const a = new SyncEngine({ doc: docA, fs: fsA, canWriteBack: () => true, debounceMs: 0 });
    const b = new SyncEngine({ doc: docB, fs: fsB, canWriteBack: () => true, debounceMs: 0 });
    engines.push(a, b);
    await Promise.all([a.start(), b.start()]);
    await flush();
    const startWrites = fsA.writeCount + fsB.writeCount;

    getFiles(docA).get('src/a.ts')!.insert(1, '1');
    fsB.externalWrite('package.json', '{"a":1,"b":2}');
    getFiles(docA).get('src/a.ts')!.insert(2, '2');
    getFiles(docA).get('package.json')!.insert(0, ' ');
    fsB.externalWrite('src/new.ts', 'new');
    await flush(20);

    expect(docToFiles(docA)).toEqual(docToFiles(docB));
    expect(await fsA.snapshot()).toEqual(await fsB.snapshot());
    expect(await fsA.snapshot()).toEqual(docToFiles(docA));
    expect(docToFiles(docA)['src/a.ts']).toBe('x12');
    expect(docToFiles(docA)['package.json']).toBe(' {"a":1,"b":2}');
    expect(fsA.writeCount + fsB.writeCount - startWrites).toBeLessThan(20);

    // Quiet afterwards: nothing keeps bouncing.
    const settled = fsA.writeCount + fsB.writeCount;
    await flush(20);
    expect(fsA.writeCount + fsB.writeCount).toBe(settled);
  });
});
