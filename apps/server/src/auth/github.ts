export interface GithubClient {
  authorizeUrl(state: string): string
  exchangeCode(code: string): Promise<string>
  getUser(token: string): Promise<{ githubId: number; login: string; name: string | null; avatarUrl: string }>
  downloadTarball(owner: string, repo: string, ref?: string): Promise<Uint8Array>
  fetchAvatar(url: string): Promise<{ body: Uint8Array; contentType: string }>
}
