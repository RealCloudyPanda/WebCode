import { expect, test } from 'vitest'
import { signGuest, verifyGuest } from './guest.js'

test('rejects a tampered guest cookie', () => {
  const v = signGuest({ guestId: 'g1', name: 'Jess' }, 's')
  expect(verifyGuest(v, 's')).toEqual({ guestId: 'g1', name: 'Jess' })
  const [payload, sig] = v.split('.')
  const forged = Buffer.from(JSON.stringify({ guestId: 'g2', name: 'Jess' })).toString('base64url')
  expect(verifyGuest(`${forged}.${sig}`, 's')).toBeNull()
  expect(verifyGuest(`${payload}.${sig}x`, 's')).toBeNull()
  expect(verifyGuest(v, 'other')).toBeNull()
  expect(verifyGuest('garbage', 's')).toBeNull()
  expect(verifyGuest('', 's')).toBeNull()
})
