/** Deterministic flicker in [1 - amount, 1] — shared by light propagation and glow sprites. */
export function flicker(timeSec: number, seed: number, amount: number): number {
  const s = (seed % 1000) * 0.37;
  const n = 0.5 + 0.5 * Math.sin(timeSec * 11.3 + s) * Math.sin(timeSec * 6.7 + s * 1.7);
  return 1 - amount * n;
}
