import { describe, expect, test, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { chooseRunCommand, chooseTestCommand, ProcessManager, type TermSink } from './processes';

const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });

describe('command choice', () => {
  test('run prefers dev, then start, else null', () => {
    expect(chooseRunCommand(pkg({ dev: 'vite', start: 'node .' }))).toEqual(['npm', 'run', 'dev']);
    expect(chooseRunCommand(pkg({ start: 'node .' }))).toEqual(['npm', 'start']);
    expect(chooseRunCommand(pkg({ build: 'tsc' }))).toBeNull();
    expect(chooseRunCommand('not json')).toBeNull();
  });

  test('test needs a test script', () => {
    expect(chooseTestCommand(pkg({ test: 'vitest run' }))).toEqual(['npm', 'test']);
    expect(chooseTestCommand(pkg({}))).toBeNull();
  });
});

function fakeWc(scripts: Record<string, string>) {
  const kills: string[] = [];
  const spawn = vi.fn(async (cmd: string, args: string[]) => {
    const line = [cmd, ...args].join(' ');
    const isInstall = line === 'npm install';
    return {
      output: new ReadableStream<string>({ start: (c) => (c.enqueue(`out:${line}\n`), c.close()) }),
      // Long-running commands only end when killed.
      exit: isInstall ? Promise.resolve(0) : new Promise<number>(() => {}),
      kill: () => kills.push(line),
      input: new WritableStream<string>(),
    };
  });
  const wc = {
    spawn,
    fs: { readFile: vi.fn(async () => pkg(scripts)), rm: vi.fn(async () => {}) },
  };
  return { wc: wc as unknown as WebContainer, spawn, kills };
}

const term = (): TermSink & { out: string[] } => {
  const out: string[] = [];
  return { out, cols: 80, rows: 24, write: (d) => void out.push(d) };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('ProcessManager', () => {
  test('two concurrent runs share a single install', async () => {
    const { wc, spawn } = fakeWc({ test: 'vitest run' });
    const m = new ProcessManager(wc);
    void m.run('test', term());
    void m.run('test', term());
    await tick();
    await tick();
    const installs = spawn.mock.calls.filter(([c, a]) => c === 'npm' && a[0] === 'install');
    expect(installs).toHaveLength(1);
  });

  test('stop kills the run process', async () => {
    const { wc, kills } = fakeWc({ dev: 'vite' });
    const m = new ProcessManager(wc);
    void m.run('run', term());
    await tick();
    await tick();
    m.stop('run');
    expect(kills).toEqual(['npm run dev']);
  });

  test('a missing script is reported in the terminal', async () => {
    const { wc, spawn } = fakeWc({});
    const t = term();
    expect(await new ProcessManager(wc).run('run', t)).toBe(1);
    expect(t.out.join('')).toContain('No "dev" or "start" script in package.json');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('shells', () => {
  test('killShells kills running jsh processes', async () => {
    const kill = vi.fn();
    const wc = {
      spawn: vi.fn(async () => ({
        output: new ReadableStream<string>({ start: (c) => c.close() }),
        exit: new Promise<number>(() => {}),
        kill,
        input: new WritableStream<string>(),
      })),
    } as unknown as WebContainer;
    const m = new ProcessManager(wc);
    void m.shell(term());
    await vi.waitFor(() => expect(wc.spawn).toHaveBeenCalled());
    await Promise.resolve();
    m.killShells();
    expect(kill).toHaveBeenCalledTimes(1);
  });
});
