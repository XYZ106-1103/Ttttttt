import { CHUNK_SIZE } from '../constants';
import { getObjectDef, OBJECT_DEFS } from '../data/objects';
import { MAX_TILE_ID } from '../data/tiles';
import type { WorldObject } from './types';

/** Bump when the serialized layout changes; loaders migrate or reject older versions. */
export const CHUNK_FORMAT_VERSION = 1;

/**
 * A modified chunk as stored on disk / sent over the network. Tile layers are run-length encoded
 * as flat [value, runLength, value, runLength, ...] arrays — terrain compresses ~20-50×.
 */
export interface SerializedChunk {
  readonly v: number;
  readonly cx: number;
  readonly cy: number;
  readonly fg: readonly number[];
  readonly bg: readonly number[];
  /** Full object list when objects changed; null means "use generated objects". */
  readonly objects: readonly WorldObject[] | null;
}

export function rleEncode(arr: Uint16Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i] ?? 0;
    let run = 1;
    while (i + run < arr.length && arr[i + run] === v && run < 65535) run++;
    out.push(v, run);
    i += run;
  }
  return out;
}

/** Decode into `out`. Returns false (leaving `out` untouched) if the data is malformed. */
export function rleDecode(data: readonly number[], out: Uint16Array): boolean {
  if (data.length % 2 !== 0) return false;
  let total = 0;
  for (let i = 0; i < data.length; i += 2) {
    const v = data[i];
    const run = data[i + 1];
    if (!Number.isInteger(v) || !Number.isInteger(run) || (v as number) < 0 || (run as number) <= 0)
      return false;
    total += run as number;
  }
  if (total !== out.length) return false;
  let p = 0;
  for (let i = 0; i < data.length; i += 2) {
    const v = (data[i] as number) < MAX_TILE_ID ? (data[i] as number) : 0;
    out.fill(v, p, p + (data[i + 1] as number));
    p += data[i + 1] as number;
  }
  return true;
}

const OBJECT_KEYS = new Set(OBJECT_DEFS.map((d) => d.key));

/** Drop objects with unknown keys or out-of-range variants (saves are untrusted input). */
export function sanitizeObjects(list: unknown, cx: number, cy: number): WorldObject[] {
  if (!Array.isArray(list)) return [];
  const out: WorldObject[] = [];
  for (const o of list as Partial<WorldObject>[]) {
    if (!o || typeof o.key !== 'string' || !OBJECT_KEYS.has(o.key)) continue;
    if (!Number.isInteger(o.tx) || !Number.isInteger(o.ty) || !Number.isInteger(o.id)) continue;
    if (
      Math.floor((o.tx as number) / CHUNK_SIZE) !== cx ||
      Math.floor((o.ty as number) / CHUNK_SIZE) !== cy
    )
      continue;
    const def = getObjectDef(o.key);
    out.push({
      id: o.id as number,
      key: o.key,
      variant: Math.max(0, Math.min(def.variants - 1, Number(o.variant) | 0)),
      tx: o.tx as number,
      ty: o.ty as number,
      seed: Number(o.seed) >>> 0,
    });
  }
  return out;
}
