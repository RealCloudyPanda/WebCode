import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import tar from 'tar-stream'
import { isIgnoredPath, isProbablyBinary, LIMITS, normalizePath } from '@webcode/shared'
import { GithubNotFound, GithubTooLarge, type GithubClient } from '../auth/github.js'

export type RepoRef = { owner: string; repo: string; ref?: string }
export type ImportErrorCode = 'not-found' | 'too-large' | 'no-text-files'

export const IMPORT_MESSAGES: Record<ImportErrorCode, string> = {
  'not-found': 'Repo not found or private',
  'too-large': 'This repo is too large for Webcode',
  'no-text-files': 'No text files found in this repo',
}

export class ImportError extends Error {
  constructor(public code: ImportErrorCode) {
    super(IMPORT_MESSAGES[code])
    this.name = 'ImportError'
  }
}

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

function validRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 200 && !/\s/.test(ref) && !ref.includes('..')
}

function build(owner: string, repoRaw: string, ref?: string): RepoRef | null {
  const repo = repoRaw.replace(/\.git$/, '')
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null
  if (ref !== undefined && !validRef(ref)) return null
  return ref === undefined ? { owner, repo } : { owner, repo, ref }
}

/** Accepts `owner/repo`, `owner/repo#branch`, and github.com URLs (optionally `/tree/<branch>`, trailing `/` or `.git`). */
export function parseRepoRef(input: string): RepoRef | null {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) {
    let u: URL
    try { u = new URL(s) } catch { return null }
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length < 2) return null
    let ref: string | undefined
    if (parts.length > 2) {
      if (parts[2] !== 'tree' || parts.length < 4) return null
      try { ref = decodeURIComponent(parts.slice(3).join('/')) } catch { return null }
    }
    return build(parts[0]!, parts[1]!, ref)
  }
  const [path, ...hash] = s.split('#')
  const ref = hash.length ? hash.join('#') : undefined
  const parts = path!.replace(/\/+$/, '').split('/')
  if (parts.length !== 2) return null
  return build(parts[0]!, parts[1]!, ref)
}

/** Download a public repo tarball and return its text files (top folder stripped). */
export async function importFromGithub(
  github: GithubClient, ref: RepoRef,
): Promise<{ files: Record<string, string>; title: string; skipped: number }> {
  let tarball: Uint8Array
  try {
    tarball = await github.downloadTarball(ref.owner, ref.repo, ref.ref)
  } catch (e) {
    if (e instanceof GithubNotFound) throw new ImportError('not-found')
    if (e instanceof GithubTooLarge) throw new ImportError('too-large')
    throw e
  }

  const files: Record<string, string> = {}
  let count = 0
  let bytes = 0
  let skipped = 0

  const gunzip = createGunzip()
  const extract = tar.extract()
  const source = Readable.from([tarball])
  source.on('error', e => gunzip.destroy(e))
  gunzip.on('error', e => extract.destroy(e))
  source.pipe(gunzip).pipe(extract)

  try {
    for await (const entry of extract) {
      const { header } = entry
      if (header.type !== 'file') { entry.resume(); continue }
      const slash = header.name.indexOf('/')
      const rel = slash === -1 ? null : normalizePath(header.name.slice(slash + 1))
      if (rel === null || isIgnoredPath(rel) || header.size > LIMITS.maxFileBytes) {
        skipped++; entry.resume(); continue
      }
      const chunks: Buffer[] = []
      for await (const chunk of entry) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks)
      if (isProbablyBinary(body)) { skipped++; continue }
      if (++count > LIMITS.maxFiles || (bytes += body.length) > LIMITS.maxProjectBytes) {
        throw new ImportError('too-large')
      }
      files[rel] = body.toString('utf8')
    }
  } catch (e) {
    if (e instanceof ImportError) throw e
    // Truncated or corrupt archive: treat as unusable repo contents.
    if (Object.keys(files).length === 0) throw new ImportError('no-text-files')
    throw e
  } finally {
    source.destroy()
    gunzip.destroy()
    extract.destroy()
  }

  if (count === 0) throw new ImportError('no-text-files')
  return { files, title: ref.repo, skipped }
}
