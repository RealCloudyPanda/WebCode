import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { TemplateInfo } from '@webcode/shared'

export type TemplateName = 'blank' | 'react-app' | 'node-api' | 'ts-library'

export const TEMPLATES: TemplateInfo[] = [
  { name: 'blank', label: 'Blank', sub: '' },
  { name: 'react-app', label: 'React app', sub: 'Vite + TypeScript' },
  { name: 'node-api', label: 'Node API', sub: 'Express' },
  { name: 'ts-library', label: 'TS library', sub: 'with tests' },
]

// src/templates -> ../../templates (works from src/ under tsx; override for a compiled dist/).
export const TEMPLATES_DIR =
  process.env.TEMPLATES_DIR ?? fileURLToPath(new URL('../../templates', import.meta.url))

const KNOWN = new Set<string>([...TEMPLATES.map((t) => t.name), 'demo'])

async function walk(root: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(root, r)))
    else if (e.isFile()) out.push(r)
  }
  return out
}

export async function loadTemplate(name: TemplateName | 'demo'): Promise<Record<string, string>> {
  if (!KNOWN.has(name)) throw new Error(`Unknown template: ${name}`)
  const root = path.join(TEMPLATES_DIR, name)
  const files: Record<string, string> = {}
  for (const p of (await walk(root)).sort()) files[p] = await readFile(path.join(root, p), 'utf8')
  return files
}
