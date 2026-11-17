import { createHmac, timingSafeEqual } from 'node:crypto'

export type Guest = { guestId: string; name: string }

const mac = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest('base64url')

/** `base64url(json).base64url(hmac)`; shared by the guest and oauth-state cookies. */
export function signValue(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${payload}.${mac(payload, secret)}`
}

export function verifyValue(signed: string, secret: string): unknown {
  const dot = signed.indexOf('.')
  if (dot < 1) return null
  const payload = signed.slice(0, dot)
  const given = Buffer.from(signed.slice(dot + 1))
  const expected = Buffer.from(mac(payload, secret))
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) } catch { return null }
}

export function signGuest(g: Guest, secret: string): string {
  return signValue({ guestId: g.guestId, name: g.name }, secret)
}

export function verifyGuest(value: string, secret: string): Guest | null {
  const v = verifyValue(value, secret) as Partial<Guest> | null
  if (!v || typeof v.guestId !== 'string' || typeof v.name !== 'string' || !v.guestId) return null
  return { guestId: v.guestId, name: v.name }
}
