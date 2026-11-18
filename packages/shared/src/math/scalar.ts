/** Scalar helpers used throughout simulation and rendering code. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01(inverseLerp(edge0, edge1, value));
  return t * t * (3 - 2 * t);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

/** Floor division that behaves correctly for negative numbers. */
export function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

/** Positive modulo (result always in [0, divisor)). */
export function mod(value: number, divisor: number): number {
  const r = value % divisor;
  return r < 0 ? r + divisor : r;
}

/** Frame-rate independent exponential smoothing factor for a given half-life in seconds. */
export function dampFactor(halfLife: number, dt: number): number {
  if (halfLife <= 0) return 1;
  return 1 - Math.pow(0.5, dt / halfLife);
}

/** Exponential approach toward a target, frame-rate independent. */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  return lerp(current, target, dampFactor(halfLife, dt));
}
