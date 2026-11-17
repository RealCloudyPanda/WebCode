import * as Y from 'yjs';
import { normalizePath } from './paths';

export function getFiles(doc: Y.Doc): Y.Map<Y.Text> {
  return doc.getMap<Y.Text>('files');
}
export function getDirs(doc: Y.Doc): Y.Map<true> {
  return doc.getMap<true>('dirs');
}
export function getMeta(doc: Y.Doc): Y.Map<string> {
  return doc.getMap<string>('meta');
}

export function seedDoc(doc: Y.Doc, files: Record<string, string>, title: string): void {
  const entries: [string, string][] = Object.entries(files).map(([p, content]) => {
    const n = normalizePath(p);
    if (n === null) throw new Error(`Invalid path: ${p}`);
    return [n, content];
  });
  doc.transact(() => {
    getMeta(doc).set('title', title);
    const map = getFiles(doc);
    for (const [path, content] of entries) {
      const t = new Y.Text();
      t.insert(0, content);
      map.set(path, t);
    }
  });
}

export function docToFiles(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  getFiles(doc).forEach((t, path) => {
    out[path] = t.toString();
  });
  return out;
}

export function docStats(doc: Y.Doc): { fileCount: number; storedBytes: number } {
  return { fileCount: getFiles(doc).size, storedBytes: Y.encodeStateAsUpdate(doc).byteLength };
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function previewText(files: Record<string, string>): string {
  const paths = Object.keys(files).sort(byCodeUnit);
  if (paths.length === 0) return '';
  const chosen =
    ['README.md', 'src/index.ts', 'src/index.tsx', 'src/index.js'].find((p) => p in files) ??
    paths.find((p) => /^src\/main\.[^/]*$/.test(p)) ??
    paths[0]!;
  return files[chosen]!.split(/\r?\n/).slice(0, 6).join('\n').slice(0, 400);
}
