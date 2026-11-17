import { describe, expect, it } from 'vitest'
import { isIgnoredPath, normalizePath } from '@webcode/shared'
import { TEMPLATES, loadTemplate, type TemplateName } from './index'

const NAMES: (TemplateName | 'demo')[] = ['blank', 'react-app', 'node-api', 'ts-library', 'demo']

describe('TEMPLATES', () => {
  it('lists the four user-facing templates', () => {
    expect(TEMPLATES).toEqual([
      { name: 'blank', label: 'Blank', sub: '' },
      { name: 'react-app', label: 'React app', sub: 'Vite + TypeScript' },
      { name: 'node-api', label: 'Node API', sub: 'Express' },
      { name: 'ts-library', label: 'TS library', sub: 'with tests' },
    ])
  })
})

describe.each(NAMES)('loadTemplate(%s)', (name) => {
  it('returns normalized, non-ignored, sorted paths under 200 KB', async () => {
    const files = await loadTemplate(name)
    const paths = Object.keys(files)
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) {
      expect(normalizePath(p)).toBe(p)
      expect(isIgnoredPath(p)).toBe(false)
    }
    expect(paths).toEqual([...paths].sort())
    const bytes = Object.values(files).reduce((n, c) => n + Buffer.byteLength(c, 'utf8'), 0)
    expect(bytes).toBeLessThan(200 * 1024)
  })

  it('has package.json with test and dev/start scripts (non-blank)', async () => {
    const files = await loadTemplate(name)
    const pkg = JSON.parse(files['package.json']!)
    if (name === 'blank') return
    expect(pkg.scripts.test).toBeTruthy()
    expect(pkg.scripts.dev ?? pkg.scripts.start).toBeTruthy()
    expect(Object.keys(files).some((p) => /lock/.test(p))).toBe(false)
  })
})

it('blank is package.json + index.js + README.md', async () => {
  expect(Object.keys(await loadTemplate('blank'))).toEqual(['README.md', 'index.js', 'package.json'])
})

it('demo has todos module, 3 tests and the demo README', async () => {
  const files = await loadTemplate('demo')
  expect(files['src/todos.ts']).toContain('export function addTodo')
  expect(files['test/todos.test.ts']!.match(/\bit\(/g)).toHaveLength(3)
  expect(files['README.md']).toMatch(/^# Demo/)
  expect(files['README.md']).toContain('This is your demo copy')
})
