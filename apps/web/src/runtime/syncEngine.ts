import diff from 'fast-diff';
import * as Y from 'yjs';
import { getDirs, getFiles, isIgnoredPath, isLockfile, isProbablyBinary, LIMITS, normalizePath } from '@webcode/shared';

export interface FsLike {
  writeFile(path: string, data: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<void>;
  readdir(path: string): Promise<{ name: string; isDir: boolean }[]>;
  watch(onChange: (path: string) => void): () => void;
}

export type SkipReason = 'too-large' | 'binary';

export type SyncEngineOptions = {
  doc: Y.Doc;
  fs: FsLike;
  /** False for viewers: their container changes stay local. */
  canWriteBack: () => boolean;
  onSkipped?: (path: string, reason: SkipReason) => void;
  debounceMs?: number;
};

type Disk =
  | { kind: 'text'; text: string }
  | { kind: 'missing' }
  | { kind: 'dir' }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'unreadable' };

// Keep a BOM as U+FEFF so files round-trip byte for byte.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const under = (path: string, dir: string) => path.startsWith(dir + '/');
const parentOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return /\b(ENOENT|EISDIR)\b/.exec(String((e as Error | null)?.message ?? e))?.[1];
}

/**
 * Two-way sync between the project's Yjs document and a container file system.
 *
 * Every path is reconciled by one serialized routine that compares three versions: the doc's
 * text, the file on disk, and `lastWritten` (what doc and disk last agreed on). A disk change is
 * merged into the doc (editors only); a doc change is written to disk. Because both directions
 * converge on `lastWritten`, our own writes and the doc updates they cause are recognised and not
 * echoed back.
 */
export class SyncEngine {
  private readonly doc: Y.Doc;
  private readonly fs: FsLike;
  private readonly canWriteBack: () => boolean;
  private readonly onSkipped?: (path: string, reason: SkipReason) => void;
  private readonly debounceMs: number;

  private readonly lastWritten = new Map<string, string>();
  private readonly lastSkipped = new Map<string, SkipReason>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly queues = new Map<string, Promise<void>>();
  private unwatch: (() => void) | null = null;
  private stopped = false;

  constructor(opts: SyncEngineOptions) {
    this.doc = opts.doc;
    this.fs = opts.fs;
    this.canWriteBack = opts.canWriteBack;
    this.onSkipped = opts.onSkipped;
    this.debounceMs = opts.debounceMs ?? 150;
  }

  /** Writes every folder and file into the file system, then keeps both sides in step. */
  async start(): Promise<void> {
    if (this.stopped || this.unwatch) return;
    const files = getFiles(this.doc);
    const dirs = getDirs(this.doc);
    files.observeDeep(this.onFilesChange);
    dirs.observe(this.onDirsChange);
    this.unwatch = this.fs.watch(this.onFsChange);

    await Promise.all(
      [...dirs.keys()].filter((d) => !isIgnoredPath(d)).map((d) => this.fs.mkdir(d, { recursive: true }).catch(() => {})),
    );
    await Promise.all(
      [...files.keys()].filter((p) => !isIgnoredPath(p)).map((p) => this.enqueue(p, () => this.mount(p))),
    );
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.unwatch) {
      getFiles(this.doc).unobserveDeep(this.onFilesChange);
      getDirs(this.doc).unobserve(this.onDirsChange);
      this.unwatch();
      this.unwatch = null;
    }
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }

  private onFilesChange = (events: Y.YEvent<any>[], txn: Y.Transaction) => {
    if (txn.origin === this) return;
    const files = getFiles(this.doc);
    for (const e of events) {
      if (e.target === files) (e as Y.YMapEvent<Y.Text>).keysChanged.forEach((k) => this.schedule(k));
      else if (typeof e.path[0] === 'string') this.schedule(e.path[0]);
    }
  };

  private onDirsChange = (e: Y.YMapEvent<true>, txn: Y.Transaction) => {
    if (txn.origin === this) return;
    e.changes.keys.forEach((change, dir) => {
      if (isIgnoredPath(dir)) return;
      if (change.action === 'add') {
        void this.fs.mkdir(dir, { recursive: true }).catch(() => {});
      } else if (change.action === 'delete' && !this.docHasAnythingUnder(dir)) {
        void this.fs.rm(dir, { recursive: true }).catch(() => {});
      }
    });
  };

  private onFsChange = (raw: string) => {
    const path = normalizePath(raw);
    if (path === null || isIgnoredPath(path)) return;
    this.schedule(path);
  };

  private docHasAnythingUnder(dir: string): boolean {
    for (const f of getFiles(this.doc).keys()) if (under(f, dir)) return true;
    for (const d of getDirs(this.doc).keys()) if (under(d, dir)) return true;
    return false;
  }

  private schedule(path: string): void {
    if (this.stopped || isIgnoredPath(path)) return;
    clearTimeout(this.timers.get(path));
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        void this.enqueue(path, () => this.reconcile(path));
      }, this.debounceMs),
    );
  }

  /** Runs `task` after any earlier work on the same path. */
  private enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(path) ?? Promise.resolve())
      .then(() => (this.stopped ? undefined : task()))
      .catch((err) => console.warn(`[sync] ${path}:`, err));
    this.queues.set(path, next);
    void next.then(() => {
      if (this.queues.get(path) === next) this.queues.delete(path);
    });
    return next;
  }

  private async mount(path: string): Promise<void> {
    const text = getFiles(this.doc).get(path)?.toString();
    if (text === undefined) return;
    await this.write(path, text);
  }

  private async write(path: string, text: string): Promise<void> {
    const parent = parentOf(path);
    if (parent) await this.fs.mkdir(parent, { recursive: true });
    await this.fs.writeFile(path, text);
    this.lastWritten.set(path, text);
  }

  private async readDisk(path: string): Promise<Disk> {
    let bytes: Uint8Array;
    try {
      bytes = await this.fs.readFile(path);
    } catch (e) {
      const code = errorCode(e);
      return code === 'ENOENT' ? { kind: 'missing' } : code === 'EISDIR' ? { kind: 'dir' } : { kind: 'unreadable' };
    }
    if (bytes.byteLength > LIMITS.maxFileBytes) return { kind: 'skipped', reason: 'too-large' };
    if (isProbablyBinary(bytes)) return { kind: 'skipped', reason: 'binary' };
    return { kind: 'text', text: decoder.decode(bytes) };
  }

  private async reconcile(path: string): Promise<void> {
    const disk = await this.readDisk(path);
    if (this.stopped || disk.kind === 'unreadable') return;
    if (disk.kind === 'dir') {
      await this.scanDir(path);
      return;
    }
    const files = getFiles(this.doc);
    const base = this.lastWritten.get(path);
    const writeBack = this.canWriteBack();

    if (disk.kind === 'missing' && base === undefined && !files.has(path)) {
      this.folderRemoved(path, writeBack);
      return;
    }
    if (disk.kind === 'skipped') {
      if (writeBack && this.lastSkipped.get(path) !== disk.reason) this.onSkipped?.(path, disk.reason);
      this.lastSkipped.set(path, disk.reason);
    } else {
      this.lastSkipped.delete(path);
    }

    // Disk → doc: bring in what changed on disk since doc and disk last agreed.
    if (writeBack) this.applyDiskToDoc(path, disk, base);

    // Doc → disk: write what changed in the doc since then.
    const text = files.get(path)?.toString();
    if (text === undefined) {
      if (base === undefined) return;
      if (disk.kind !== 'missing') await this.fs.rm(path).catch(() => {});
      this.lastWritten.delete(path);
      return;
    }
    // Unchanged doc: any difference on disk is local only (a viewer's, or a skipped file).
    if (text === base) return;
    if (disk.kind === 'text' && disk.text === text) this.lastWritten.set(path, text);
    else await this.write(path, text);
  }

  private applyDiskToDoc(path: string, disk: Disk, base: string | undefined): void {
    const files = getFiles(this.doc);
    const t = files.get(path);
    if (disk.kind === 'missing') {
      // Deleted on disk after we wrote it.
      if (base !== undefined && t) this.doc.transact(() => files.delete(path), this);
      return;
    }
    if (disk.kind !== 'text' || disk.text === base) return;
    if (!t) {
      // New on disk. (If it had been synced before, the doc deleted it: the doc wins.)
      if (base === undefined && files.size < LIMITS.maxFiles) {
        this.doc.transact(() => files.set(path, new Y.Text(disk.text)), this);
      }
      return;
    }
    const current = t.toString();
    // A file the doc just gained over a local-only one: the doc wins.
    if (disk.text === current || base === undefined) return;
    this.doc.transact(() => {
      if (isLockfile(path)) {
        t.delete(0, t.length);
        t.insert(0, disk.text);
      } else {
        applyRebased(t, base, disk.text, current);
      }
    }, this);
  }

  /** A folder appeared on disk (created or renamed in): pick up everything inside it. */
  private async scanDir(dir: string): Promise<void> {
    let entries: { name: string; isDir: boolean }[];
    try {
      entries = await this.fs.readdir(dir);
    } catch {
      return;
    }
    if (this.stopped) return;
    if (entries.length === 0 && this.canWriteBack()) {
      const dirs = getDirs(this.doc);
      if (!dirs.has(dir)) this.doc.transact(() => dirs.set(dir, true), this);
    }
    for (const e of entries) {
      const child = `${dir}/${e.name}`;
      if (isIgnoredPath(child)) continue;
      if (e.isDir) await this.scanDir(child);
      else this.schedule(child);
    }
  }

  /** A path that is neither a known file nor on disk: maybe a folder removed on disk. */
  private folderRemoved(path: string, writeBack: boolean): void {
    for (const p of this.lastWritten.keys()) if (under(p, path)) this.schedule(p);
    if (!writeBack) return;
    const dirs = getDirs(this.doc);
    const gone = [...dirs.keys()].filter((d) => d === path || under(d, path));
    if (gone.length) this.doc.transact(() => gone.forEach((d) => dirs.delete(d)), this);
  }
}

type Edit = { start: number; end: number; insert: string };

/** The minimal edits turning `from` into `to`, in `from` coordinates. */
function editsBetween(from: string, to: string): Edit[] {
  const out: Edit[] = [];
  let pos = 0;
  let cur: Edit | null = null;
  for (const [op, s] of diff(from, to)) {
    if (op === diff.EQUAL) {
      if (cur) out.push(cur);
      cur = null;
      pos += s.length;
      continue;
    }
    cur ??= { start: pos, end: pos, insert: '' };
    if (op === diff.DELETE) {
      pos += s.length;
      cur.end = pos;
    } else {
      cur.insert += s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Maps a position in `base` to the text that `chunks` (diff of base → current) produces.
 * `left` stays before text inserted at that point; `right` goes after it.
 */
function mapPosition(chunks: diff.Diff[], p: number, assoc: 'left' | 'right'): number {
  let b = 0;
  let c = 0;
  for (const [op, s] of chunks) {
    const len = s.length;
    if (op === diff.INSERT) {
      if (p === b && assoc === 'left') return c;
      c += len;
    } else if (op === diff.EQUAL) {
      if (p < b + len) return c + (p - b);
      b += len;
      c += len;
    } else {
      if (p < b + len) return c;
      b += len;
    }
  }
  return c;
}

/**
 * Applies the disk's change (base → target) to `t`, whose text is `current`. When the doc has
 * not moved since `base`, this is a plain minimal diff; otherwise the edits are moved past the
 * doc's own changes so neither side's work is reverted.
 */
function applyRebased(t: Y.Text, base: string, target: string, current: string): void {
  const chunks = current === base ? null : diff(base, current);
  const map = (p: number, assoc: 'left' | 'right') => (chunks ? mapPosition(chunks, p, assoc) : p);
  for (const e of editsBetween(base, target).reverse()) {
    const start = map(e.start, 'right');
    const end = Math.max(start, map(e.end, 'left'));
    if (end > start) t.delete(start, end - start);
    if (e.insert) t.insert(start, e.insert);
  }
}
