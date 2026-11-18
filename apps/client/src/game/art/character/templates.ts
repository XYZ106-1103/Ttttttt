/**
 * Hand-authored pixel templates for the parts that need deliberate pixel placement.
 * Keys: s skin, t skin shade, e eye dark, w eye highlight, i iris, m mouth, r blush,
 * c cloth, d cloth shade, f cloth light, k accent, g belt, b buckle.
 */

/** 16×15 head silhouette, facing right, bald (hair is procedural, face features are placed by
 * coordinate in the composer). */
export const HEAD = [
  '.....ssssss.....',
  '...ssssssssss...',
  '..ssssssssssss..',
  '.ssssssssssssss.',
  '.ssssssssssssss.',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'ssssssssssssssss',
  'tsssssssssssssss',
  'tsssssssssssssss',
  '.tssssssssssssss',
  '..tssssssssssss.',
  '...ttssssssss...',
  '.....tttttt.....',
];

/** Face features (head-relative): [x, y, key]. Near eye is 2×3, far eye 1×3. */
export const FACE: readonly (readonly [number, number, string])[] = [
  [8, 7, 'e'],
  [8, 8, 'i'],
  [8, 9, 'i'],
  [12, 7, 'e'],
  [13, 7, 'e'],
  [12, 8, 'w'],
  [13, 8, 'i'],
  [12, 9, 'i'],
  [13, 9, 'i'],
  [12, 11, 'm'],
  [14, 10, 'r'],
  [15, 10, 'r'],
  [6, 10, 'r'],
];

/** Eyes closed (blink) overlay rows 7..9 → only row 8 drawn as a lash line. */
export const BLINK_PIXELS: readonly (readonly [number, number])[] = [
  [8, 8],
  [12, 8],
  [13, 8],
];
export const EYE_PIXELS: readonly (readonly [number, number])[] = [
  [8, 7],
  [8, 8],
  [8, 9],
  [12, 7],
  [13, 7],
  [12, 8],
  [13, 8],
  [12, 9],
  [13, 9],
];

/** 10×13 tunic torso, facing right. */
export const TORSO = [
  '..fcccccc.',
  '.fcckkcccd',
  'fcccckcccd',
  'fccccccccd',
  'fccccccccd',
  'fccccccccd',
  'fccccccccd',
  'fccccccccd',
  'gggggggbgg',
  'fccccccccd',
  'fccccccccd',
  'fcdcccdccd',
  '.dd..dd.d.',
];
