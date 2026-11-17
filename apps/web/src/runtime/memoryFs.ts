import type { FsLike } from './syncEngine';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const fsError = (code: string, path: string) => Object.assign(new Error(`${code}: ${path}`), { code });
const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const under = (path: string, dir: string) => path.startsWith(dir + '/');

/**
 * In-memory file system with WebContainer-like semantics, for tests: writes need an existing
 * parent folder, and watch events arrive asynchronously, one per touched path (a recursive
 * folder removal reports only the folder).
 */
export class MemoryFs implements FsLike {
  private files = new Map<string, Uint8Array>();
  private dirs = new Set<string>(['']);
  private listeners = new Set<(path: string) => void>();
  private reads = new Map<string, number>();
  /** Number of writeFile calls (externalWrite is not counted). */
  writeCount = 0;

  async writeFile(path: string, data: string): Promise<void> {
    if (!this.dirs.has(parentOf(path))) throw fsError('ENOENT', path);
    if (this.dirs.has(path)) throw fsError('EISDIR', path);
    this.files.set(path, encoder.encode(data));
    this.writeCount++;
    this.emit(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1);
    if (this.dirs.has(path)) throw fsError('EISDIR', path);
    const bytes = this.files.get(path);
    if (!bytes) throw fsError('ENOENT', path);
    return bytes.slice();
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    if (this.files.delete(path)) return this.emit(path);
    if (!this.dirs.has(path) || path === '') throw fsError('ENOENT', path);
    const hasChildren = [...this.files.keys(), ...this.dirs].some((p) => under(p, path));
    if (hasChildren && !opts?.recursive) throw fsError('ENOTEMPTY', path);
    this.removeTree(path);
    this.emit(path);
  }

  async mkdir(path: string, _opts: { recursive: true }): Promise<void> {
    if (this.files.has(path)) throw fsError('EEXIST', path);
    this.makeDirs(path);
  }

  watch(onChange: (path: string) => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  /** Simulates a command writing a file (parents are created). */
  externalWrite(path: string, data: string | Uint8Array): void {
    this.makeDirs(parentOf(path));
    this.files.set(path, typeof data === 'string' ? encoder.encode(data) : data);
    this.emit(path);
  }

  /** Simulates a command removing a file or folder (recursively). */
  externalRm(path: string): void {
    if (!this.files.delete(path)) this.removeTree(path);
    this.emit(path);
  }

  async text(path: string): Promise<string | undefined> {
    const bytes = this.files.get(path);
    return bytes && decoder.decode(bytes);
  }

  async snapshot(): Promise<Record<string, string>> {
    return Object.fromEntries([...this.files].map(([p, b]) => [p, decoder.decode(b)]));
  }

  isDir(path: string): boolean {
    return this.dirs.has(path);
  }

  readCount(path: string): number {
    return this.reads.get(path) ?? 0;
  }

  private makeDirs(path: string): void {
    const segs = path.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const d = segs.slice(0, i).join('/');
      if (!this.dirs.has(d)) {
        this.dirs.add(d);
        this.emit(d);
      }
    }
  }

  private removeTree(path: string): void {
    for (const f of [...this.files.keys()]) if (under(f, path)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === path || under(d, path)) this.dirs.delete(d);
  }

  private emit(path: string): void {
    setTimeout(() => this.listeners.forEach((l) => l(path)), 0);
  }
}
