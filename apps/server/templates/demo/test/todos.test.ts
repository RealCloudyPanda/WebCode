import { describe, expect, it } from 'vitest'
import { addTodo, type Todo } from '../src/todos'

describe('addTodo', () => {
  it('appends a new, unfinished todo', () => {
    const list = addTodo([], 'Write tests')
    expect(list).toEqual([{ id: 1, title: 'Write tests', done: false }])
  })

  it('trims the title and ignores blank ones', () => {
    expect(addTodo([], '  Ship it  ')[0]?.title).toBe('Ship it')
    expect(addTodo([], '   ')).toEqual([])
  })

  it('does not mutate the original list and gives unique ids', () => {
    const original: Todo[] = [{ id: 4, title: 'One', done: false }]
    const next = addTodo(original, 'Two')
    expect(original).toHaveLength(1)
    expect(next.map((t) => t.id)).toEqual([4, 5])
  })
})
