/** In-memory sliding-window rate limiter. */
export class RateLimiter {
  private hits = new Map<string, number[]>()

  /** Records a hit; returns false when the key is over `limit` within `windowMs`. */
  hit(key: string, limit: number, windowMs: number, now: number = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(t => t > now - windowMs)
    if (recent.length >= limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(now)
    this.hits.set(key, recent)
    return true
  }
}
