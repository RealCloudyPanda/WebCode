import { Hono } from 'hono'
import { TEMPLATES } from '../../templates/index.js'

export function templateRoutes(): Hono {
  const app = new Hono()
  app.get('/api/templates', c => c.json(TEMPLATES))
  return app
}
