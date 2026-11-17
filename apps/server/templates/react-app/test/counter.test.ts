import { describe, expect, it } from 'vitest'
import { step } from '../src/counter'

describe('step', () => {
  it('adds the delta', () => {
    expect(step(1, 1)).toBe(2)
  })

  it('never goes below zero', () => {
    expect(step(0, -1)).toBe(0)
  })
})
