import { useState } from 'react'
import { step } from './counter'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main>
      <h1>Hello from Webcode</h1>
      <p>Edit <code>src/App.tsx</code> and the preview updates.</p>
      <div className="row">
        <button onClick={() => setCount((c) => step(c, -1))}>-</button>
        <span className="count">{count}</span>
        <button onClick={() => setCount((c) => step(c, 1))}>+</button>
      </div>
    </main>
  )
}
