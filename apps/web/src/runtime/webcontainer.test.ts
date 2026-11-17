import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const boot = vi.fn();
vi.mock('@webcontainer/api', () => ({ WebContainer: { boot } }));

async function load() {
  vi.resetModules();
  return import('./webcontainer');
}

beforeEach(() => {
  boot.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('getWebContainer', () => {
  test('boots once with the project workdir and require-corp', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    const wc = { fake: true };
    boot.mockResolvedValue(wc);
    const { getWebContainer } = await load();
    const [a, b] = await Promise.all([getWebContainer(), getWebContainer()]);
    expect(a).toBe(wc);
    expect(b).toBe(wc);
    expect(boot).toHaveBeenCalledTimes(1);
    expect(boot).toHaveBeenCalledWith({ coep: 'require-corp', workdirName: 'project' });
  });

  test('rejects with RuntimeUnsupported without cross-origin isolation', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const { getWebContainer, RuntimeUnsupported } = await load();
    await expect(getWebContainer()).rejects.toBeInstanceOf(RuntimeUnsupported);
    expect(boot).not.toHaveBeenCalled();
  });

  test('rejects with RuntimeUnsupported when boot fails', async () => {
    vi.stubGlobal('crossOriginIsolated', true);
    boot.mockImplementation(async () => {
      throw new Error('nope');
    });
    const { getWebContainer, RuntimeUnsupported } = await load();
    const err = await getWebContainer().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RuntimeUnsupported);
    expect((err as Error).message).toBe('WebContainer failed to boot');
  });
});

describe('webcontainerFs', () => {
  test('watches the project folder recursively and reports paths as strings', async () => {
    const { webcontainerFs } = await load();
    let listener!: (event: string, filename: string | Uint8Array) => void;
    const close = vi.fn();
    const wc = {
      workdir: '/home/project',
      fs: {
        watch: vi.fn((_p: string, _o: unknown, l: typeof listener) => {
          listener = l;
          return { close };
        }),
      },
    };
    const seen: string[] = [];
    const unwatch = webcontainerFs(wc as any).watch((p) => seen.push(p));
    expect(wc.fs.watch).toHaveBeenCalledWith('.', { recursive: true }, expect.any(Function));
    listener('change', 'src/a.ts');
    listener('rename', new TextEncoder().encode('b.ts'));
    listener('rename', '/home/project/lib/c.ts');
    expect(seen).toEqual(['src/a.ts', 'b.ts', 'lib/c.ts']);
    unwatch();
    expect(close).toHaveBeenCalled();
  });
});

describe('watcher paths and workdir', () => {
  test('stripWorkdir removes the workdir or a leading slash', async () => {
    const { stripWorkdir } = await load();
    expect(stripWorkdir('/home/project/src/a.ts', '/home/project')).toBe('src/a.ts');
    expect(stripWorkdir('/src/a.ts', '/home/project')).toBe('src/a.ts');
    expect(stripWorkdir('src/a.ts', '/home/project')).toBe('src/a.ts');
  });

  test('clearWorkdir removes every entry', async () => {
    const { clearWorkdir } = await load();
    const { MemoryFs } = await import('./memoryFs');
    const fs = new MemoryFs();
    fs.externalWrite('a.ts', '1');
    fs.externalWrite('node_modules/x/i.js', '2');
    await clearWorkdir(fs);
    expect(await fs.snapshot()).toEqual({});
  });
});
