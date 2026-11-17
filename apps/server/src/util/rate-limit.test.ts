import { expect, test } from 'vitest'
import { RateLimiter } from './rate-limit.js'

test('rate limiter', () => {
  const l = new RateLimiter()
  for (let i = 0; i < 5; i++) expect(l.hit('ip', 5, 3_600_000, 0)).toBe(true)
  expect(l.hit('ip', 5, 3_600_000, 1)).toBe(false)
  expect(l.hit('ip', 5, 3_600_000, 3_600_001)).toBe(true)
})

test('rate limiter keys are independent', () => {
  const l = new RateLimiter()
  expect(l.hit('a', 1, 1000, 0)).toBe(true)
  expect(l.hit('a', 1, 1000, 1)).toBe(false)
  expect(l.hit('b', 1, 1000, 1)).toBe(true)
})
