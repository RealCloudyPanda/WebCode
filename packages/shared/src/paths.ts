const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.cache',
  '.vite',
]);
const LOCKFILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']);

/** Normalize a project-relative POSIX path; null if empty, absolute, contains `..` or NUL. */
export function normalizePath(p: string): string | null {
  if (p.includes('\0')) return null;
  const s = p.replace(/\\/g, '/');
  if (s.startsWith('/')) return null;
  const out: string[] = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

export function isIgnoredPath(path: string): boolean {
  return path.split('/').some((seg) => IGNORED_DIRS.has(seg));
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(path.slice(path.lastIndexOf('/') + 1));
}

export function isProbablyBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8000);
  if (head.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}
