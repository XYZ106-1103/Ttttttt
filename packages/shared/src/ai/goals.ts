/**
 * Long-term goals and how adventurers pick them. Archetype and personality weight the options;
 * goals feed the utility brain (bonus for actions that serve the current goal).
 */
import type { Character } from '../actors/Character';
import { getJobDef } from '../data/classes';
import { ITEM_DEFS, type ItemDef } from '../data/items';
import { MONSTER_DEFS } from '../data/monsters';
import type { Rng } from '../math/rng';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { gearScore, weaponsOfType } from './knowledge';
import type { Archetype, Personality } from './personality';

export type Goal =
  | { readonly kind: 'level'; readonly target: number; readonly since: number }
  | {
      readonly kind: 'item';
      readonly itemId: string;
      readonly count: number;
      readonly since: number;
    }
  | { readonly kind: 'explore'; readonly targetX: number; readonly since: number }
  | {
      readonly kind: 'slay';
      readonly monsterId: string;
      readonly count: number;
      progress: number;
      readonly since: number;
    };

/** Goals older than this are reconsidered (seconds of world time). */
export const GOAL_TIMEOUT = 20 * 60;

function owns(c: Character, itemId: string): number {
  let n = c.inventory.count(itemId);
  for (const st of Object.values(c.equipment.snapshot())) if (st?.itemId === itemId) n++;
  return n;
}

/** Next weapon upgrade for the character's job weapon type, if any is within reach. */
export function nextWeapon(c: Character): ItemDef | null {
  const type = getJobDef(c.jobId).weapons[0] ?? 'sword';
  const types = c.jobId === 'novice' ? (['sword'] as const) : ([type] as const);
  let bestHave = 0;
  for (let i = 0; i < c.inventory.size; i++) {
    const def = itemRegistry.get(c.inventory.get(i)?.itemId ?? '');
    if (def?.weapon && types.includes(def.weapon.type as never))
      bestHave = Math.max(bestHave, gearScore(def));
  }
  for (const t of types) {
    for (const w of weaponsOfType(t)) {
      if ((w.weapon?.reqLevel ?? 1) > c.level + 2) continue;
      if (gearScore(w) > bestHave && owns(c, w.id) === 0) return w;
    }
  }
  return null;
}

/** Next armor/trinket upgrade for an empty or weaker slot. */
export function nextArmor(c: Character): ItemDef | null {
  const worn = c.equipment.snapshot();
  const candidates = ITEM_DEFS.filter(
    (d) => d.equip && d.equip.category !== 'accessory' && d.equip.reqLevel <= c.level + 1,
  );
  let best: ItemDef | null = null;
  let bestGain = 0;
  for (const d of candidates) {
    const slot = d.equip?.category;
    const cur = slot ? worn[slot as 'head' | 'body' | 'feet'] : null;
    const gain = gearScore(d) - gearScore(cur ? itemRegistry.get(cur.itemId) : undefined);
    if (gain > bestGain && owns(c, d.id) === 0) {
      best = d;
      bestGain = gain;
    }
  }
  return best;
}

function nextTool(c: Character, type: 'pickaxe' | 'axe'): ItemDef | null {
  let have = 0;
  for (let i = 0; i < c.inventory.size; i++) {
    const def = itemRegistry.get(c.inventory.get(i)?.itemId ?? '');
    if (def?.tool?.type === type) have = Math.max(have, def.tool.power);
  }
  return (
    ITEM_DEFS.filter((d) => d.tool?.type === type && (d.tool?.power ?? 0) > have).sort(
      (a, b) => (a.tool?.power ?? 0) - (b.tool?.power ?? 0),
    )[0] ?? null
  );
}

/** A monster of the character's tier worth hunting. */
function tierMonster(c: Character, rng: Rng): string {
  const fit = MONSTER_DEFS.filter(
    (m) => m.spawn && m.level <= c.level + 2 && m.level >= c.level - 6,
  );
  return (fit.length ? rng.pick(fit) : MONSTER_DEFS[0])?.id ?? 'dew_slime';
}

export function chooseGoal(
  c: Character,
  p: Personality,
  archetype: Archetype,
  rng: Rng,
  now: number,
  worldWidthTiles: number,
): Goal {
  const options: [Goal, number][] = [];
  const level: Goal = { kind: 'level', target: c.level + (c.level < 10 ? 2 : 1), since: now };
  const weapon = nextWeapon(c);
  const armor = nextArmor(c);
  const pick = nextTool(c, 'pickaxe');
  const potions = c.inventory.count('healing_potion');
  const tx = Math.floor(c.motor.x / 16);
  const explore: Goal = {
    kind: 'explore',
    targetX: Math.max(40, Math.min(worldWidthTiles - 40, tx + rng.sign() * rng.int(120, 320))),
    since: now,
  };
  const slay: Goal = {
    kind: 'slay',
    monsterId: tierMonster(c, rng),
    count: rng.int(5, 12),
    progress: 0,
    since: now,
  };
  const w = (base: number, trait: number) => base * (0.6 + trait * 0.8);
  switch (archetype) {
    case 'hunter':
      options.push([level, w(1, p.competitiveness)], [slay, w(0.6, p.aggression)]);
      if (weapon)
        options.push([{ kind: 'item', itemId: weapon.id, count: 1, since: now }, w(0.9, p.greed)]);
      if (armor)
        options.push([{ kind: 'item', itemId: armor.id, count: 1, since: now }, w(0.5, p.caution)]);
      break;
    case 'artisan':
      if (pick)
        options.push([{ kind: 'item', itemId: pick.id, count: 1, since: now }, w(1, p.greed)]);
      if (armor)
        options.push([{ kind: 'item', itemId: armor.id, count: 1, since: now }, w(0.9, p.caution)]);
      if (weapon)
        options.push([{ kind: 'item', itemId: weapon.id, count: 1, since: now }, w(0.6, p.greed)]);
      if (potions < 4)
        options.push([
          { kind: 'item', itemId: 'healing_potion', count: 6, since: now },
          w(0.6, p.caution),
        ]);
      options.push([level, w(0.4, p.competitiveness)]);
      break;
    case 'explorer':
      options.push(
        [explore, w(1, p.curiosity)],
        [slay, w(0.5, p.courage)],
        [level, w(0.5, p.competitiveness)],
      );
      if (weapon)
        options.push([{ kind: 'item', itemId: weapon.id, count: 1, since: now }, w(0.4, p.greed)]);
      break;
  }
  let total = 0;
  for (const [, wt] of options) total += wt;
  let r = rng.next() * total;
  for (const [g, wt] of options) {
    r -= wt;
    if (r <= 0) return g;
  }
  return level;
}

export function goalDone(g: Goal, c: Character): boolean {
  switch (g.kind) {
    case 'level':
      return c.level >= g.target;
    case 'item':
      return owns(c, g.itemId) >= g.count;
    case 'explore':
      return Math.abs(c.motor.x / 16 - g.targetX) < 4;
    case 'slay':
      return g.progress >= g.count;
  }
}
