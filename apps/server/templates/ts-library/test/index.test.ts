import { describe, expect, it } from 'vitest'
import { clamp, slugify } from '../src/index'

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Hello, Webcode World!')).toBe('hello-webcode-world')
  })
})

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(15, 0, 10)).toBe(10)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(5, 0, 10)).toBe(5)
  })
})
