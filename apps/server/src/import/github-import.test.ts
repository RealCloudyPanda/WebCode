import { gzipSync } from 'node:zlib'
import tar from 'tar-stream'
import { describe, expect, test } from 'vitest'
import { GithubNotFound, GithubTooLarge, type GithubClient } from '../auth/github.js'
import { importFromGithub, ImportError, parseRepoRef } from './github-import.js'

type Entry = { name: string; body?: string | Uint8Array; type?: 'file' | 'symlink' | 'link' | 'directory'; linkname?: string }

async function makeTarball(entries: Entry[], opts: { globalHeader?: boolean } = {}): Promise<Uint8Array> {
  const pack = tar.pack()
  const chunks: Buffer[] = []
  pack.on('data', c => chunks.push(c as Buffer))
  const done = new Promise<void>(res => pack.on('end', () => res()))
  if (opts.globalHeader) {
    // GitHub tarballs start with a real pax global header (typeflag 'g') carrying the commit sha.
    const rec = ' comment=0123456789abcdef\n'
    const payload = Buffer.from(`${String(rec.length + 2)}${rec}`)
    const block = Buffer.alloc(512)
    block.write('pax_global_header', 0)
    block.write('0000666\0', 100)
    block.write(payload.length.toString(8).padStart(11, '0') + '\0', 124)
    block.write('0'.repeat(11) + '\0', 136)
    block.write('        ', 148)
    block.write('g', 156)
    block.write('ustar\0' + '00', 257)
    block.write(block.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    chunks.push(block, Buffer.concat([payload, Buffer.alloc(512 - payload.length)]))
  }
  for (const e of entries) {
    const type = e.type ?? 'file'
    if (type === 'file') pack.entry({ name: e.name, type: 'file' }, e.body ?? '')
    else pack.entry({ name: e.name, type, linkname: e.linkname }, undefined as never)
  }
  pack.finalize()
  await done
  return new Uint8Array(gzipSync(Buffer.concat(chunks)))
}

const fakeGh = (tarball: Uint8Array | Error): GithubClient => ({
  downloadTarball: async () => { if (tarball instanceof Error) throw tarball; return tarball },
} as unknown as GithubClient)
const ref = { owner: 'octo', repo: 'app' }

describe('parseRepoRef', () => {
  test.each([
    ['octo/app', { owner: 'octo', repo: 'app' }],
    ['octo/app#dev', { owner: 'octo', repo: 'app', ref: 'dev' }],
    ['https://github.com/octo/app/tree/dev', { owner: 'octo', repo: 'app', ref: 'dev' }],
    ['https://github.com/octo/app/tree/feat/x', { owner: 'octo', repo: 'app', ref: 'feat/x' }],
    ['octo/app.git', { owner: 'octo', repo: 'app' }],
    ['https://www.github.com/octo/app.git/', { owner: 'octo', repo: 'app' }],
    ['http://github.com/octo/app/', { owner: 'octo', repo: 'app' }],
    ['  https://github.com/octo/app  ', { owner: 'octo', repo: 'app' }],
    ['nope', null],
    ['', null],
    ['https://gitlab.com/octo/app', null],
    ['https://github.com/octo', null],
    ['octo/..', null],
    ['octo/.', null],
    ['-octo/app', null],
    ['oc to/app', null],
    ['octo/app#a..b', null],
    ['octo/app#a b', null],
    [`octo/app#${'x'.repeat(201)}`, null],
    [`${'o'.repeat(40)}/app`, null],
    [`octo/${'r'.repeat(101)}`, null],
  ])('%s', (i, o) => expect(parseRepoRef(i)).toEqual(o))
})

describe('importFromGithub', () => {
  test('strips top folder, skips node_modules, binaries and big files', async () => {
    const tb = await makeTarball([
      { name: 'app-main/src/a.ts', body: 'export const a = 1' },
      { name: 'app-main/node_modules/x.js', body: 'x' },
      { name: 'app-main/logo.png', body: new Uint8Array([0x89, 0x50, 0, 1, 2]) },
      { name: 'app-main/big.txt', body: 'a'.repeat(1_000_001) },
    ], { globalHeader: true })
    const res = await importFromGithub(fakeGh(tb), ref)
    expect(Object.keys(res.files)).toEqual(['src/a.ts'])
    expect(res.files['src/a.ts']).toBe('export const a = 1')
    expect(res.skipped).toBe(3)
    expect(res.title).toBe('app')
  })

  test('skips directories, symlinks, hardlinks and traversal entries', async () => {
    const tb = await makeTarball([
      { name: 'app-main/', type: 'directory' },
      { name: 'app-main/src/a.ts', body: 'ok' },
      { name: 'app-main/link', type: 'symlink', linkname: '/etc/passwd' },
      { name: 'app-main/hard', type: 'link', linkname: 'app-main/src/a.ts' },
      { name: 'app-main/../../etc/x', body: 'evil' },
    ])
    const res = await importFromGithub(fakeGh(tb), ref)
    expect(res.files).toEqual({ 'src/a.ts': 'ok' })
    expect(res.skipped).toBe(1)
  })

  test('2001 files -> too-large', async () => {
    const entries = Array.from({ length: 2001 }, (_, i) => ({ name: `app-main/f${i}.txt`, body: 'x' }))
    await expect(importFromGithub(fakeGh(await makeTarball(entries)), ref)).rejects.toMatchObject({ code: 'too-large' })
  })

  test('more than 10 MB of text -> too-large', async () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ name: `app-main/f${i}.txt`, body: 'a'.repeat(999_999) }))
    await expect(importFromGithub(fakeGh(await makeTarball(entries)), ref)).rejects.toMatchObject({ code: 'too-large' })
  })

  test('only ignored/binary files -> no-text-files', async () => {
    const tb = await makeTarball([{ name: 'app-main/node_modules/x.js', body: 'x' }])
    await expect(importFromGithub(fakeGh(tb), ref)).rejects.toMatchObject({ code: 'no-text-files' })
  })

  test('404 -> not-found', async () => {
    const p = importFromGithub(fakeGh(new GithubNotFound()), ref)
    await expect(p).rejects.toBeInstanceOf(ImportError)
    await expect(p).rejects.toMatchObject({ code: 'not-found' })
  })

  test('oversized download -> too-large', async () => {
    await expect(importFromGithub(fakeGh(new GithubTooLarge()), ref)).rejects.toMatchObject({ code: 'too-large' })
  })

  test('garbage body -> not-found style failure is an ImportError', async () => {
    await expect(importFromGithub(fakeGh(new Uint8Array([1, 2, 3])), ref)).rejects.toBeInstanceOf(ImportError)
  })
})
