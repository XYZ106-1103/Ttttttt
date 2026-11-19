/**
 * Relationship vocabulary shared by the AI, the UI and dialogue: what a relation record means,
 * and how well two personalities get along.
 */
import type { Relation } from '../ai/memory';
import { type Personality, TRAITS } from '../ai/personality';

export type RelationLabel =
  'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'rival' | 'enemy';

export const FRIEND_AFFINITY = 0.3;
export const CLOSE_AFFINITY = 0.65;
export const RIVAL_AFFINITY = -0.25;
export const ENEMY_AFFINITY = -0.6;

export function relationLabel(r: Relation | undefined): RelationLabel {
  if (!r || (r.met === 0 && r.talks === 0 && r.affinity === 0)) return 'stranger';
  if (r.affinity <= ENEMY_AFFINITY) return 'enemy';
  if (r.affinity <= RIVAL_AFFINITY) return 'rival';
  if (r.affinity >= CLOSE_AFFINITY) return 'close_friend';
  if (r.affinity >= FRIEND_AFFINITY) return 'friend';
  return 'acquaintance';
}

/**
 * How well two personalities get along (-1..1): similar people and friendly people click; two
 * highly competitive people tend to become rivals.
 */
export function compatibility(a: Personality, b: Personality): number {
  let diff = 0;
  for (const t of TRAITS) diff += Math.abs(a[t] - b[t]);
  const similarity = 1 - diff / TRAITS.length;
  const warmth = (a.friendliness + b.friendliness) / 2 - 0.5;
  const clash = a.competitiveness * b.competitiveness - 0.3;
  const temper = a.aggression * b.aggression - 0.3;
  const v = (similarity - 0.62) * 1.6 + warmth * 0.9 - clash * 0.9 - temper * 0.4;
  return Math.max(-1, Math.min(1, v));
}
