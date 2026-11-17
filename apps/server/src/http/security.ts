import type { MiddlewareHandler } from 'hono'

export function isolationHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next()
    const apply = (h: Headers) => {
      h.set('Cross-Origin-Opener-Policy', 'same-origin')
      h.set('Cross-Origin-Embedder-Policy', 'require-corp')
      h.set('Cross-Origin-Resource-Policy', 'same-origin')
      h.set('X-Content-Type-Options', 'nosniff')
    }
    try {
      apply(c.res.headers)
    } catch {
      // Responses from fetch()/Response.redirect() have immutable headers: re-wrap.
      const res = c.res
      c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers: new Headers(res.headers) })
      apply(c.res.headers)
    }
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const JSON_METHODS = new Set(['POST', 'PATCH', 'PUT'])

/** CSRF defence: state-changing requests must carry the app's own Origin. */
export function originCheck(publicUrl: string): MiddlewareHandler {
  const allowed = new URL(publicUrl).origin
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()
    if (c.req.header('origin') !== allowed) return c.json({ error: 'bad-origin' }, 403)
    return next()
  }
}

/** POST/PATCH/PUT bodies on /api must be JSON; body-less requests pass. */
export function requireJson(): MiddlewareHandler {
  return async (c, next) => {
    if (!JSON_METHODS.has(c.req.method)) return next()
    const length = c.req.header('content-length')
    const type = c.req.header('content-type')
    const hasBody = length !== undefined
      ? length !== '0'
      : c.req.header('transfer-encoding') !== undefined || type !== undefined
    if (hasBody && !type?.toLowerCase().startsWith('application/json')) {
      return c.json({ error: 'unsupported-media-type' }, 415)
    }
    return next()
  }
}
