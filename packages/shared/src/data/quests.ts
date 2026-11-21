/**
 * Quests: a story chain that walks a new adventurer from the village slimes to the volcano's
 * tyrant, plus daily bounties picked from a level-scaled pool. Pure data — progress tracking is
 * in quests/QuestLog.ts and rewards are paid by the simulation.
 */
import type { BiomeId } from './biomes';
import { getMonsterDef, MONSTER_DEFS } from './monsters';

export type QuestObjective =
  | { readonly kind: 'kill'; readonly target: string; readonly count: number }
  /** Have the items when turning in (they are handed over). */
  | { readonly kind: 'collect'; readonly item: string; readonly count: number }
  | { readonly kind: 'craft'; readonly item: string; readonly count: number }
  /** Enhance any piece of gear to at least this level. */
  | { readonly kind: 'enhance'; readonly count: number }
  /** Stand on the surface of a biome. */
  | { readonly kind: 'reach'; readonly biome: BiomeId; readonly count: 1 };

export interface QuestReward {
  readonly exp: number;
  readonly gold: number;
  readonly items: readonly { readonly item: string; readonly count: number }[];
}

export interface QuestDef {
  readonly id: string;
  readonly kind: 'story' | 'bounty';
  readonly nameKey: string;
  readonly descKey: string;
  readonly minLevel: number;
  /** Story quest that must be finished first. */
  readonly prereq: string | null;
  readonly objectives: readonly QuestObjective[];
  readonly reward: QuestReward;
}

const story = (
  id: string,
  minLevel: number,
  prereq: string | null,
  objectives: QuestObjective[],
  reward: QuestReward,
): QuestDef => ({
  id,
  kind: 'story',
  nameKey: `quest.${id}`,
  descKey: `quest.${id}.desc`,
  minLevel,
  prereq,
  objectives,
  reward,
});

const kill = (target: string, count: number): QuestObjective => ({ kind: 'kill', target, count });
const items = (...list: [string, number][]) => list.map(([item, count]) => ({ item, count }));

export const STORY_QUESTS: readonly QuestDef[] = [
  story('first_steps', 1, null, [kill('dew_slime', 5)], {
    exp: 60,
    gold: 30,
    items: items(['healing_potion', 5]),
  }),
  story(
    'tools_of_the_trade',
    2,
    'first_steps',
    [{ kind: 'craft', item: 'copper_pickaxe', count: 1 }],
    {
      exp: 120,
      gold: 50,
      items: items(['torch', 10]),
    },
  ),
  story('beetle_trouble', 3, 'tools_of_the_trade', [kill('thornback', 6)], {
    exp: 220,
    gold: 80,
    items: items(['enhance_stone', 3]),
  }),
  story('sharpen_up', 5, 'beetle_trouble', [{ kind: 'enhance', count: 3 }], {
    exp: 320,
    gold: 120,
    items: items(['enhance_stone', 4]),
  }),
  story('into_the_dark', 7, 'sharpen_up', [kill('cave_bat', 6), kill('cave_slime', 6)], {
    exp: 600,
    gold: 200,
    items: items(['healing_potion', 5], ['mana_potion', 5]),
  }),
  story('heart_of_stone', 12, 'into_the_dark', [kill('corestone_golem', 1)], {
    exp: 1500,
    gold: 500,
    items: items(['enhance_stone', 6]),
  }),
  story(
    'cold_frontier',
    14,
    'heart_of_stone',
    [{ kind: 'reach', biome: 'tundra', count: 1 }, kill('frost_slime', 8)],
    {
      exp: 1800,
      gold: 400,
      items: items(['frostite_ore', 6]),
    },
  ),
  story('the_frost_giant', 22, 'cold_frontier', [kill('frost_giant', 1)], {
    exp: 5000,
    gold: 900,
    items: items(['enhance_stone', 8], ['frost_core', 1]),
  }),
  story(
    'ember_road',
    26,
    'the_frost_giant',
    [{ kind: 'reach', biome: 'volcano', count: 1 }, kill('magma_slime', 8)],
    {
      exp: 6000,
      gold: 900,
      items: items(['magmite_ore', 8]),
    },
  ),
  story('the_magma_tyrant', 30, 'ember_road', [kill('magma_tyrant', 1)], {
    exp: 12000,
    gold: 2000,
    items: items(['crystal_shard', 5], ['enhance_stone', 10]),
  }),
];

/** Gathering bounties: [item, count, minimum level, gold per unit]. */
const GATHER: readonly [string, number, number, number][] = [
  ['wood', 30, 1, 2],
  ['copper_ore', 20, 2, 6],
  ['iron_ore', 15, 8, 12],
  ['silver_ore', 10, 18, 18],
  ['gold_ore', 8, 22, 28],
];

function bountyFor(m: (typeof MONSTER_DEFS)[number]): QuestDef {
  const count = m.level >= 20 ? 6 : 8;
  return {
    id: `bounty_${m.id}`,
    kind: 'bounty',
    nameKey: 'quest.bounty.kill',
    descKey: 'quest.bounty.kill.desc',
    minLevel: Math.max(1, m.level - 2),
    prereq: null,
    objectives: [kill(m.id, count)],
    reward: {
      exp: Math.round(m.exp * count * 1.5),
      gold: m.level * count * 3,
      items: m.level >= 10 ? items(['enhance_stone', 1 + Math.floor(m.level / 12)]) : [],
    },
  };
}

export const BOUNTY_QUESTS: readonly QuestDef[] = [
  ...MONSTER_DEFS.filter((m) => m.spawn && !m.boss).map(bountyFor),
  ...GATHER.map(([item, count, minLevel, gold]): QuestDef => ({
    id: `bounty_${item}`,
    kind: 'bounty',
    nameKey: 'quest.bounty.collect',
    descKey: 'quest.bounty.collect.desc',
    minLevel,
    prereq: null,
    objectives: [{ kind: 'collect', item, count }],
    reward: { exp: minLevel * 40 + 40, gold: gold * count, items: [] },
  })),
];

export const QUEST_DEFS: readonly QuestDef[] = [...STORY_QUESTS, ...BOUNTY_QUESTS];

const byId = new Map(QUEST_DEFS.map((q) => [q.id, q]));

export function getQuestDef(id: string): QuestDef | undefined {
  return byId.get(id);
}

/** Daily bounties offered at once. */
export const BOUNTIES_PER_DAY = 3;
/** Quests one character can carry at once. */
export const MAX_ACTIVE_QUESTS = 6;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Today's bounties for a character: chosen from those near their level, stable for the whole
 * in-game day and different between characters.
 */
export function dailyBounties(key: string, day: number, level: number): QuestDef[] {
  const pool = BOUNTY_QUESTS.filter((q) => {
    const monster = q.objectives[0]?.kind === 'kill' ? getMonsterDef(q.objectives[0].target) : null;
    const top = monster ? monster.level : q.minLevel;
    return q.minLevel <= level && top >= level - 10;
  }).sort((a, b) => hash(`${key}:${day}:${a.id}`) - hash(`${key}:${day}:${b.id}`));
  return pool.slice(0, BOUNTIES_PER_DAY);
}
