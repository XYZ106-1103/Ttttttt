/**
 * Deterministic hashing and pseudo-random number generation.
 * Everything procedural in the world must derive from these so that a seed reproduces the same world
 * on every client and on the server.
 */

/** 32-bit integer avalanche hash (lowbias32 by Chris Wellons). */
export function hash32(n: number): number {
  let x = n | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash two integers plus a seed into an unsigned 32-bit value. */
export function hash2(x: number, y: number, seed: number): number {
  return hash32(hash32(hash32(seed) ^ (x | 0)) ^ Math.imul(y | 0, 0x27d4eb2d));
}

/** Hash two integers plus a seed into a float in [0, 1). */
export function hash2f(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296;
}

/** Hash one integer plus a seed into a float in [0, 1). */
export function hash1f(x: number, seed: number): number {
  return hash32(hash32(seed) ^ Math.imul(x | 0, 0x9e3779b1)) / 4294967296;
}

/** FNV-1a string hash. Used to turn human-readable seeds ("PROJECT-WORLD") into numbers. */
export function seedFromString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Derive an independent sub-seed (e.g. one per generation pass) from a parent seed and a label. */
export function deriveSeed(seed: number, label: string): number {
  return hash32(seed ^ seedFromString(label));
}

/**
 * Small, fast, seedable PRNG (sfc32). Not cryptographically secure — never use for anything
 * security-related (session tokens, loot validation secrets, ...).
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = hash32(seed ^ 0x9e3779b9);
    this.b = hash32(seed ^ 0x243f6a88);
    this.c = hash32(seed ^ 0xb7e15162);
    this.d = 1;
    // Warm up so that nearby seeds diverge quickly.
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] (inclusive). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Random sign: -1 or 1. */
  sign(): -1 | 1 {
    return this.next() < 0.5 ? -1 : 1;
  }
}
