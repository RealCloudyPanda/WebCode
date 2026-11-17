import { WebContainer } from '@webcontainer/api';
import type { FsLike } from './syncEngine';

/** Running code is unavailable in this browser (no cross-origin isolation, or boot failed). */
export class RuntimeUnsupported extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RuntimeUnsupported';
  }
}

let booting: Promise<WebContainer> | null = null;

/** The page's single WebContainer, booted on first use. */
export function getWebContainer(): Promise<WebContainer> {
  booting ??= (async () => {
    if (!globalThis.crossOriginIsolated) throw new RuntimeUnsupported('The page is not cross-origin isolated');
    try {
      return await WebContainer.boot({ coep: 'require-corp', workdirName: 'project' });
    } catch (cause) {
      throw new RuntimeUnsupported('WebContainer failed to boot', { cause });
    }
  })();
  return booting;
}

const decoder = new TextDecoder();

/** Watcher paths may arrive absolute (`/home/project/src/a.ts`); the sync engine wants them relative. */
export function stripWorkdir(raw: string, workdir: string): string {
  const base = workdir.replace(/\/+$/, '') + '/';
  if (raw.startsWith(base)) return raw.slice(base.length);
  return raw.replace(/^\/+/, '');
}

/** The container's file system, rooted at the project folder, as the sync engine sees it. */
export function webcontainerFs(wc: WebContainer): FsLike {
  return {
    writeFile: (path, data) => wc.fs.writeFile(path, data),
    readFile: (path) => wc.fs.readFile(path),
    rm: (path, opts) => wc.fs.rm(path, opts),
    readdir: async (path) => {
      const entries = await wc.fs.readdir(path || '.', { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    },
    mkdir: async (path, opts) => {
      await wc.fs.mkdir(path, opts);
    },
    watch: (onChange) => {
      const watcher = wc.fs.watch('.', { recursive: true }, (_event, filename) => {
        const raw = typeof filename === 'string' ? filename : decoder.decode(filename);
        const rel = stripWorkdir(raw, wc.workdir);
        onChange(rel);
      });
      return () => watcher.close();
    },
  };
}

/** Empties the project folder (including node_modules) so a new project starts clean. */
export async function clearWorkdir(fs: FsLike): Promise<void> {
  const entries = await fs.readdir('');
  await Promise.all(entries.map((e) => fs.rm(e.name, { recursive: true, force: true }).catch(() => {})));
}
