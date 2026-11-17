import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

describe('API', () => {
  it('says hello', async () => {
    const res = await request(createApp()).get('/')
    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Hello from Webcode!')
  })

  it('creates and lists items', async () => {
    const app = createApp()
    const created = await request(app).post('/items').send({ name: 'first' })
    expect(created.status).toBe(201)
    const list = await request(app).get('/items')
    expect(list.body).toEqual([{ id: 1, name: 'first' }])
  })

  it('rejects an empty name', async () => {
    const res = await request(createApp()).post('/items').send({})
    expect(res.status).toBe(400)
  })
})
