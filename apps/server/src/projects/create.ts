import * as Y from 'yjs'
import { docStats, LIMITS, previewText, seedDoc, type LinkAccess } from '@webcode/shared'
import type { Sql } from '../db/db.js'
import { storeDoc, totalStoredBytes } from '../db/docs.js'
import { insertProject, touchMember, type Project } from '../db/projects.js'

/** Error with an HTTP status and an `ApiError` code; the routes map it straight to a response. */
export class ApiFailure extends Error {
  constructor(public status: 400 | 409 | 429 | 503, public code: string, message?: string) {
    super(message ?? code)
  }
}

export const TOO_LARGE = 'This project is too large for Webcode'
export const SITE_FULL = 'Webcode is full right now'

export type Owner = { userId: string } | { guestId: string }
export type CreateOpts = { title: string; template: string; linkAccess: LinkAccess; isDemoCopy?: boolean; expiresAt?: Date | null }

export async function createProjectFromFiles(
  deps: { sql: Sql }, owner: Owner, files: Record<string, string>, opts: CreateOpts,
): Promise<Project> {
  const { sql } = deps
  const entries = Object.entries(files)
  if (entries.length > LIMITS.maxFiles) throw new ApiFailure(400, 'too-large', TOO_LARGE)
  for (const [, content] of entries) {
    if (Buffer.byteLength(content, 'utf8') > LIMITS.maxFileBytes) throw new ApiFailure(400, 'too-large', TOO_LARGE)
  }
  const doc = new Y.Doc()
  try {
    seedDoc(doc, files, opts.title)
  } catch {
    throw new ApiFailure(400, 'invalid', 'Invalid file path')
  }
  const { storedBytes } = docStats(doc)
  if (storedBytes > LIMITS.maxProjectBytes) throw new ApiFailure(400, 'too-large', TOO_LARGE)
  if ((await totalStoredBytes(sql)) + storedBytes > LIMITS.siteCapBytes) throw new ApiFailure(503, 'site-full', SITE_FULL)

  const state = Y.encodeStateAsUpdate(doc)
  const project = await insertProject(sql, {
    ownerId: 'userId' in owner ? owner.userId : null,
    ownerGuestId: 'guestId' in owner ? owner.guestId : null,
    title: opts.title, template: opts.template, linkAccess: opts.linkAccess,
    isDemoCopy: opts.isDemoCopy, expiresAt: opts.expiresAt,
  })
  await storeDoc(sql, project.id, state, previewText(files), opts.title)
  if ('userId' in owner) await touchMember(sql, project.id, owner.userId)
  return project
}
