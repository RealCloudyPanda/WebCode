import { useState, type FormEvent } from 'react'
import { addTodo, toggleTodo, type Todo } from './todos'

const initial: Todo[] = [
  { id: 1, title: 'Press Run to see this app', done: true },
  { id: 2, title: 'Edit src/todos.ts', done: false },
  { id: 3, title: 'Press Test to run the tests', done: false },
]

export default function App() {
  const [todos, setTodos] = useState(initial)
  const [title, setTitle] = useState('')

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTodos((list) => addTodo(list, title))
    setTitle('')
  }

  const remaining = todos.filter((t) => !t.done).length

  return (
    <main>
      <h1>Todos</h1>
      <form onSubmit={onSubmit}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          aria-label="New todo"
        />
        <button className="primary" type="submit">Add</button>
      </form>
      <ul>
        {todos.map((t) => (
          <li key={t.id} className={t.done ? 'done' : ''}>
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => setTodos((list) => toggleTodo(list, t.id))}
              aria-label={t.title}
            />
            <span>{t.title}</span>
          </li>
        ))}
      </ul>
      <p className="summary">{remaining} left</p>
    </main>
  )
}
