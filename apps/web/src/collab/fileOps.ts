import * as Y from 'yjs';
import { getDirs, getFiles, isIgnoredPath, LIMITS, normalizePath } from '@webcode/shared';

export type FileOpErrorCode = 'invalid-path' | 'ignored' | 'exists' | 'not-found' | 'too-large' | 'too-many';

export class FileOpError extends Error {
  constructor(readonly code: FileOpErrorCode) {
    super(code);
    this.name = 'FileOpError';
  }
}

export type TreeNode = { name: string; path: string; kind: 'file' | 'dir'; children?: TreeNode[] };

const utf8 = new TextEncoder();

function validPath(path: string): string {
  const p = normalizePath(path);
  if (p === null) throw new FileOpError('invalid-path');
  if (isIgnoredPath(p)) throw new FileOpError('ignored');
  return p;
}

const under = (path: string, dir: string) => path.startsWith(dir + '/');

/** True if `path` names a folder: explicit, or implied by a file inside it. */
function isDir(doc: Y.Doc, path: string): boolean {
  if (getDirs(doc).has(path)) return true;
  for (const f of getFiles(doc).keys()) if (under(f, path)) return true;
  return false;
}

/** Throws `exists` if `path` is taken, or if an ancestor of it is a file. */
function assertFree(doc: Y.Doc, path: string): void {
  const files = getFiles(doc);
  if (files.has(path) || isDir(doc, path)) throw new FileOpError('exists');
  const segs = path.split('/');
  for (let i = 1; i < segs.length; i++) {
    if (files.has(segs.slice(0, i).join('/'))) throw new FileOpError('exists');
  }
}

export function createFile(doc: Y.Doc, path: string, content = ''): void {
  const p = validPath(path);
  assertFree(doc, p);
  if (utf8.encode(content).length > LIMITS.maxFileBytes) throw new FileOpError('too-large');
  const files = getFiles(doc);
  if (files.size >= LIMITS.maxFiles) throw new FileOpError('too-many');
  const t = new Y.Text();
  t.insert(0, content);
  files.set(p, t);
}

export function createDir(doc: Y.Doc, path: string): void {
  const p = validPath(path);
  assertFree(doc, p);
  getDirs(doc).set(p, true);
}

/** Deletes a file, or a folder and everything under it. */
export function deleteEntry(doc: Y.Doc, path: string): void {
  const p = normalizePath(path);
  if (p === null) throw new FileOpError('invalid-path');
  const files = getFiles(doc);
  const dirs = getDirs(doc);
  if (files.has(p)) {
    files.delete(p);
    return;
  }
  if (!isDir(doc, p)) throw new FileOpError('not-found');
  doc.transact(() => {
    for (const f of [...files.keys()]) if (under(f, p)) files.delete(f);
    for (const d of [...dirs.keys()]) if (d === p || under(d, p)) dirs.delete(d);
  });
}

/** Moves a file or folder; text is copied to the new key and the old key deleted, in one transaction. */
export function renameEntry(doc: Y.Doc, from: string, to: string): void {
  const src = normalizePath(from);
  if (src === null) throw new FileOpError('invalid-path');
  const dst = validPath(to);
  const files = getFiles(doc);
  const dirs = getDirs(doc);
  const srcIsFile = files.has(src);
  if (!srcIsFile && !isDir(doc, src)) throw new FileOpError('not-found');
  if (dst === src || under(dst, src)) throw new FileOpError('invalid-path');
  assertFree(doc, dst);

  const move = (oldPath: string, newPath: string) => {
    const t = new Y.Text();
    t.insert(0, files.get(oldPath)!.toString());
    files.delete(oldPath);
    files.set(newPath, t);
  };
  doc.transact(() => {
    if (srcIsFile) {
      move(src, dst);
      return;
    }
    for (const f of [...files.keys()]) if (under(f, src)) move(f, dst + f.slice(src.length));
    for (const d of [...dirs.keys()]) {
      if (d !== src && !under(d, src)) continue;
      dirs.delete(d);
      dirs.set(dst + d.slice(src.length), true);
    }
  });
}

type DirNode = TreeNode & { kind: 'dir'; children: TreeNode[] };

const byName = (a: TreeNode, b: TreeNode) =>
  a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true });

/** The project as a tree: folders first, then files, each alphabetical. */
export function listTree(doc: Y.Doc): TreeNode[] {
  const root: DirNode = { name: '', path: '', kind: 'dir', children: [] };
  const dirIndex = new Map<string, DirNode>([['', root]]);

  const dirNode = (path: string): DirNode => {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = dirNode(slash < 0 ? '' : path.slice(0, slash));
    const node: DirNode = { name: path.slice(slash + 1), path, kind: 'dir', children: [] };
    parent.children.push(node);
    dirIndex.set(path, node);
    return node;
  };

  for (const d of getDirs(doc).keys()) dirNode(d);
  for (const f of getFiles(doc).keys()) {
    const slash = f.lastIndexOf('/');
    dirNode(slash < 0 ? '' : f.slice(0, slash)).children.push({ name: f.slice(slash + 1), path: f, kind: 'file' });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort(byName);
    for (const n of nodes) if (n.children) sort(n.children);
  };
  sort(root.children);
  return root.children;
}
