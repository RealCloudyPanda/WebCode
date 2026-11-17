import express from 'express'

export function createApp() {
  const app = express()
  app.use(express.json())

  const items = []

  app.get('/', (_req, res) => {
    res.json({ message: 'Hello from Webcode!' })
  })

  app.get('/items', (_req, res) => {
    res.json(items)
  })

  app.post('/items', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (!name) return res.status(400).json({ error: 'name is required' })
    const item = { id: items.length + 1, name }
    items.push(item)
    res.status(201).json(item)
  })

  return app
}
