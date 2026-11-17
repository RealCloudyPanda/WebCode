export function step(count: number, delta: number): number {
  return Math.max(0, count + delta)
}
