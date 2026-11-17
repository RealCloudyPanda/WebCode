export const COLLAB_COLORS: readonly string[] = [
  '#f28b82',
  '#81c995',
  '#fdd663',
  '#c58af9',
  '#78d9ec',
  '#fcad70',
  '#ff8bcb',
  '#a8dab5',
];

export function pickColor(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return COLLAB_COLORS[(h >>> 0) % COLLAB_COLORS.length]!;
}
