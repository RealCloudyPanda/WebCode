import type { Config } from '../config.js'

export interface GithubClient {
  authorizeUrl(state: string): string
  exchangeCode(code: string): Promise<string>
  getUser(token: string): Promise<{ githubId: number; login: string; name: string | null; avatarUrl: string }>
  downloadTarball(owner: string, repo: string, ref?: string): Promise<Uint8Array>
  fetchAvatar(url: string): Promise<{ body: Uint8Array; contentType: string }>
}

export class GithubNotFound extends Error {
  constructor(message = 'GitHub resource not found') {
    super(message)
    this.name = 'GithubNotFound'
  }
}

/** Thrown when a tarball download exceeds the compressed-size cap. */
export class GithubTooLarge extends Error {
  constructor(message = 'GitHub download too large') {
    super(message)
    this.name = 'GithubTooLarge'
  }
}

export const MAX_TARBALL_BYTES = 50_000_000
const FETCH_TIMEOUT_MS = 15_000
const timeout = () => AbortSignal.timeout(FETCH_TIMEOUT_MS)

const API_HEADERS = { accept: 'application/vnd.github+json', 'user-agent': 'webcode' }

export function createGithubClient(config: Config): GithubClient {
  return {
    authorizeUrl(state) {
      const u = new URL('https://github.com/login/oauth/authorize')
      u.searchParams.set('client_id', config.githubClientId)
      u.searchParams.set('redirect_uri', new URL('/auth/github/callback', config.publicUrl).toString())
      u.searchParams.set('scope', 'read:user')
      u.searchParams.set('state', state)
      return u.toString()
    },
    async exchangeCode(code) {
      const r = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'webcode' },
        body: JSON.stringify({ client_id: config.githubClientId, client_secret: config.githubClientSecret, code }),
        signal: timeout(),
      })
      if (!r.ok) throw new Error(`GitHub token exchange failed: ${r.status}`)
      const j = await r.json() as { access_token?: string; error?: string }
      if (!j.access_token) throw new Error(`GitHub token exchange failed: ${j.error ?? 'no token'}`)
      return j.access_token
    },
    async getUser(token) {
      const r = await fetch('https://api.github.com/user', { headers: { ...API_HEADERS, authorization: `Bearer ${token}` }, signal: timeout() })
      if (!r.ok) throw new Error(`GitHub user lookup failed: ${r.status}`)
      const j = await r.json() as { id: number; login: string; name: string | null; avatar_url: string }
      return { githubId: j.id, login: j.login, name: j.name ?? null, avatarUrl: j.avatar_url ?? '' }
    },
    async downloadTarball(owner, repo, ref) {
      const path = `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball${ref ? `/${encodeURIComponent(ref)}` : ''}`
      const r = await fetch(`https://api.github.com/repos/${path}`, { headers: API_HEADERS, redirect: 'follow', signal: timeout() })
      if (r.status === 404) throw new GithubNotFound()
      if (!r.ok) throw new Error(`GitHub tarball download failed: ${r.status}`)
      const declared = Number(r.headers.get('content-length'))
      if (declared > MAX_TARBALL_BYTES) { await r.body?.cancel(); throw new GithubTooLarge() }
      if (!r.body) return new Uint8Array(await r.arrayBuffer())
      const chunks: Uint8Array[] = []
      let total = 0
      const reader = r.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_TARBALL_BYTES) { await reader.cancel(); throw new GithubTooLarge() }
        chunks.push(value)
      }
      return new Uint8Array(Buffer.concat(chunks))
    },
    async fetchAvatar(url) {
      const r = await fetch(url, { headers: { 'user-agent': 'webcode' }, redirect: 'follow', signal: timeout() })
      if (!r.ok) throw new Error(`Avatar fetch failed: ${r.status}`)
      return { body: new Uint8Array(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? 'application/octet-stream' }
    },
  }
}
