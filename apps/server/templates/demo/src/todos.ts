export type Todo = { id: number; title: string; done: boolean }

export function addTodo(list: Todo[], title: string): Todo[] {
  const trimmed = title.trim()
  if (!trimmed) return list
  const id = list.reduce((max, t) => Math.max(max, t.id), 0) + 1
  return [...list, { id, title: trimmed, done: false }]
}

export function toggleTodo(list: Todo[], id: number): Todo[] {
  return list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
}
