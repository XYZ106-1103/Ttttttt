/**
 * An AI adventurer: a stable identity (profile), a full Character that plays by the same rules as
 * the player, a goal, memories and the runtime state of its brain.
 */
import { Character, type CharacterSnapshot } from '../actors/Character';
import type { MovementConfig } from '../data/movement';
import { deriveSeed, Rng } from '../math/rng';
import type { Goal } from './goals';
import { Memory } from './memory';
import type { PathFollower } from './nav/pathfind';
import {
  type Archetype,
  ARCHETYPES,
  type GeneratedName,
  generateName,
  generatePersonality,
  type Personality,
  pickArchetype,
  preferredJob,
  TRAITS,
} from './personality';

export interface AdventurerProfile {
  /** Stable id used in saves and relationships ("adv-07"). */
  readonly key: string;
  readonly index: number;
  readonly seed: number;
  readonly name: GeneratedName;
  /** Seed for the procedural appearance (client-side `randomAppearance`). */
  readonly appearanceSeed: number;
  readonly personality: Personality;
  readonly archetype: Archetype;
  readonly preferredJob: string;
  /** Hidden execution skill 0..1: reaction time, dodge accuracy. */
  readonly skill: number;
  readonly nightOwl: boolean;
  readonly dislikesCaves: boolean;
  /** Home tile column (in the starting village). */
  readonly homeX: number;
}

export type ActionId =
  | 'fight'
  | 'flee'
  | 'rest'
  | 'gather'
  | 'mine'
  | 'seek'
  | 'explore'
  | 'return'
  | 'socialize'
  | 'wander';

export const ACTION_IDS: readonly ActionId[] = [
  'fight',
  'flee',
  'rest',
  'gather',
  'mine',
  'seek',
  'explore',
  'return',
  'socialize',
  'wander',
];

/** Coarse activity of an adventurer simulated off-screen. */
export type AbstractActivity = 'town' | 'hunt' | 'mine' | 'gather' | 'travel' | 'rest';

export interface Bark {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly until: number;
}

export interface FrameFx {
  jumped: boolean;
  landed: boolean;
  landingSpeed: number;
  stepped: number;
}

export function generateProfile(
  worldSeed: number,
  index: number,
  homeCenter: number,
  taken: Set<string>,
): AdventurerProfile {
  const seed = deriveSeed(worldSeed, `adventurer:${index}`);
  const rng = new Rng(seed);
  const personality = generatePersonality(rng);
  const name = generateName(rng, taken);
  taken.add(name.ko);
  return {
    key: `adv-${String(index).padStart(2, '0')}`,
    index,
    seed,
    name,
    appearanceSeed: deriveSeed(seed, 'look'),
    personality,
    archetype: pickArchetype(personality, rng),
    preferredJob: preferredJob(personality, rng),
    skill: 0.3 + rng.next() * 0.65,
    nightOwl: rng.chance(0.25 + personality.courage * 0.3),
    dislikesCaves: rng.chance(personality.caution * 0.6),
    homeX: homeCenter + rng.int(-26, 26),
  };
}

export interface AdventurerSave {
  readonly key: string;
  readonly character: CharacterSnapshot;
  readonly x: number;
  readonly y: number;
  readonly goal: Goal | null;
  readonly memory: unknown;
  readonly activity: AbstractActivity;
}

export class Adventurer {
  readonly character: Character;
  readonly memory = new Memory();
  goal: Goal | null = null;
  tier: 'active' | 'abstract' = 'abstract';
  readonly rng: Rng;

  // --- Brain runtime (active tier) --------------------------------------------------------
  action: ActionId = 'wander';
  actionSince = 0;
  scores: Partial<Record<ActionId, number>> = {};
  targetMonster: number | null = null;
  targetTile: { tx: number; ty: number } | null = null;
  travelX: number | null = null;
  follower: PathFollower | null = null;
  pathGoal = -1;
  repathAt = 0;
  thinkAt = 0;
  houseAt = 0;
  perceiveAt = 0;
  dodgeAt = -1;
  chargeUntil = 0;
  skillAt = 0;
  stuckFor = 0;
  greetedAt = -1000;
  lastX = 0;
  bark: Bark | null = null;
  nextBarkAt = 0;
  respawnAt = -Infinity;
  /** Accumulated motor events for the renderer (reset when consumed). */
  readonly fx: FrameFx = { jumped: false, landed: false, landingSpeed: 0, stepped: 0 };

  // --- Abstract tier ------------------------------------------------------------------------
  activity: AbstractActivity = 'town';
  activityUntil = -Infinity;
  abstractTimer = 0;

  constructor(
    readonly profile: AdventurerProfile,
    id: number,
    x: number,
    y: number,
    movement: MovementConfig,
  ) {
    this.character = new Character(id, 'adventurer', profile.name.ko, x, y, movement);
    this.character.giveStartingItems();
    this.rng = new Rng(deriveSeed(profile.seed, 'brain'));
  }

  get key(): string {
    return this.profile.key;
  }

  say(key: string, now: number, params?: Record<string, string | number>, force = false): void {
    if (!force && now < this.nextBarkAt) return;
    this.bark = { key, params, until: now + 3.2 };
    this.nextBarkAt = now + 7 + this.rng.range(0, 6) * (1 - this.profile.personality.sociability);
  }

  toJSON(): AdventurerSave {
    return {
      key: this.key,
      character: this.character.exportSnapshot(),
      x: this.character.motor.x,
      y: this.character.motor.y,
      goal: this.goal,
      memory: this.memory.toJSON(),
      activity: this.activity,
    };
  }

  load(s: AdventurerSave): void {
    this.character.importSnapshot(s.character);
    if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      this.character.motor.x = s.x;
      this.character.motor.y = s.y;
    }
    this.memory.load(s.memory);
    this.goal = sanitizeGoal(s.goal);
    this.activity = (['town', 'hunt', 'mine', 'gather', 'travel', 'rest'] as const).includes(
      s.activity,
    )
      ? s.activity
      : 'town';
  }
}

function sanitizeGoal(g: unknown): Goal | null {
  if (!g || typeof g !== 'object') return null;
  const o = g as Record<string, unknown>;
  const since = Number(o.since) || 0;
  switch (o.kind) {
    case 'level':
      return Number.isFinite(Number(o.target))
        ? { kind: 'level', target: Number(o.target), since }
        : null;
    case 'item':
      return typeof o.itemId === 'string'
        ? { kind: 'item', itemId: o.itemId, count: Math.max(1, Number(o.count) || 1), since }
        : null;
    case 'explore':
      return Number.isFinite(Number(o.targetX))
        ? { kind: 'explore', targetX: Number(o.targetX), since }
        : null;
    case 'slay':
      return typeof o.monsterId === 'string'
        ? {
            kind: 'slay',
            monsterId: o.monsterId,
            count: Number(o.count) || 5,
            progress: Number(o.progress) || 0,
            since,
          }
        : null;
  }
  return null;
}

export { ARCHETYPES, TRAITS };
