/**
 * The adventurer brain — three layers, all in-house game logic (no external AI services):
 *  1. Strategy  (every ~20 s): pick / keep a long-term goal (goals.ts) and plan its needs.
 *  2. Tactics   (every 0.5 s): Utility AI — score every action from the situation, personality,
 *               goal and memory, then commit to the best one (with hysteresis).
 *  3. Execution (every tick): the chosen action's behaviour produces a CharacterIntent — the same
 *               kind of input the player's keyboard and mouse produce.
 */
import type { Character } from '../actors/Character';
import type { DropEntity } from '../actors/DropSystem';
import {
  bestPotion,
  type CharacterIntent,
  IDLE_ACTION,
  type ActionIntent,
} from '../actors/stepCharacter';
import { skillsForJob } from '../combat/progression';
import type { CombatWorld } from '../combat/CombatWorld';
import { TILE_SIZE } from '../constants';
import { getJobDef } from '../data/classes';
import { JOB_STARTER_WEAPONS } from '../data/items';
import { getSkillDef, scaled } from '../data/skills';
import { getStatusDef } from '../data/statuses';
import { claimedByOther, type Monster } from '../monsters/Monster';
import { IDLE_INPUT, type MotorInput } from '../physics/CharacterMotor';
import { isRegionSolid } from '../physics/TileCollider';
import { craft } from '../sandbox/crafting';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { COLLISION_NONE, tileRegistry } from '../world/TileRegistry';
import type { World } from '../world/World';
import type { ActionId, Adventurer } from './Adventurer';
import { chooseGoal, GOAL_TIMEOUT, goalDone } from './goals';
import { gearScore, type Need, planItem } from './knowledge';
import type { NavGrid } from './nav/NavGrid';
import { findPath, PathFollower } from './nav/pathfind';
import { fleeThreshold, potionThreshold } from './personality';

export interface BrainEnv {
  readonly world: World;
  readonly nav: NavGrid;
  readonly combat: CombatWorld;
  readonly monsters: readonly Monster[];
  readonly drops: readonly DropEntity[];
  readonly player: Character | null;
  readonly now: number;
  readonly dt: number;
  /** Tile columns of the protected starting village. */
  readonly safeFrom: number;
  readonly safeTo: number;
  readonly night: boolean;
  /** Path searches still allowed this tick (shared budget). */
  pathBudget: number;
  /** Notable things for the presentation layer and memories. */
  readonly events: BrainEvent[];
}

export type BrainEvent =
  | { readonly type: 'job'; readonly key: string; readonly jobId: string }
  | { readonly type: 'crafted'; readonly key: string; readonly itemId: string }
  | { readonly type: 'goal'; readonly key: string };

const RANGE: Record<string, number> = { sword: 26, dagger: 22, bow: 170, staff: 150 };
const PERCEPTION = 34 * TILE_SIZE;
const HYSTERESIS = 0.12;

function center(c: Character): { x: number; y: number } {
  return { x: c.motor.x, y: c.motor.y - c.motor.height / 2 };
}

function monsterCenter(m: Monster): { x: number; y: number } {
  return { x: m.motor.x, y: m.motor.y - m.motor.height / 2 };
}

function telegraphing(m: Monster): boolean {
  return (
    m.anim === 'windup' || m.anim.endsWith('_windup') || m.anim === 'swoop' || m.anim === 'charge'
  );
}

// --- Inventory housekeeping ---------------------------------------------------------------------

function bestSlot(c: Character, pick: (id: string) => number): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < c.inventory.size; i++) {
    const st = c.inventory.get(i);
    if (!st) continue;
    const s = pick(st.itemId);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

function weaponScore(c: Character, itemId: string): number {
  const def = itemRegistry.get(itemId);
  if (!def?.weapon || def.weapon.reqLevel > c.level) return 0;
  const job = getJobDef(c.jobId);
  const fits =
    c.jobId === 'novice'
      ? def.weapon.type === 'sword' || def.weapon.type === 'dagger'
      : job.weapons.includes(def.weapon.type);
  return gearScore(def) * (fits ? 2 : 0.4) + 1;
}

function toolScore(itemId: string, type: 'pickaxe' | 'axe'): number {
  const t = itemRegistry.get(itemId)?.tool;
  return t?.type === type ? t.power : 0;
}

/** Keep weapon, pickaxe, axe and potions in fixed hotbar slots 0..3. */
function organizeHotbar(c: Character): void {
  const wants: [number, (id: string) => number][] = [
    [0, (id) => weaponScore(c, id)],
    [1, (id) => toolScore(id, 'pickaxe')],
    [2, (id) => toolScore(id, 'axe')],
    [3, (id) => (id === 'healing_potion' ? 1 : 0)],
  ];
  for (const [slot, score] of wants) {
    const from = bestSlot(c, score);
    if (from >= 0 && from !== slot) {
      const here = c.inventory.get(slot);
      if (here && score(here.itemId) >= score(c.inventory.get(from)?.itemId ?? '')) continue;
      c.inventory.move(from, slot);
    }
  }
}

function equipBest(c: Character): void {
  for (let i = 0; i < c.inventory.size; i++) {
    const def = itemRegistry.get(c.inventory.get(i)?.itemId ?? '');
    if (!def?.equip || def.equip.reqLevel > c.level) continue;
    const slot = c.equipment.slotFor(def.id);
    if (!slot) continue;
    const worn = c.equipment.get(slot);
    if (!worn || gearScore(def) > gearScore(itemRegistry.get(worn.itemId))) c.equipFromInventory(i);
  }
}

function skillPriority(id: string): number {
  const def = getSkillDef(id);
  if (!def) return 0;
  if (def.job === 'novice') return 0.3;
  if (def.type === 'passive') return 0.8;
  if (def.type === 'buff') return 0.6;
  return 1;
}

function learnSkills(c: Character): void {
  for (let guard = 0; guard < 50 && c.progress.skillPoints > 0; guard++) {
    const options = skillsForJob(c.jobId)
      .filter((s) => (c.skills[s.id] ?? 0) < s.maxLevel && s.reqLevel <= c.level)
      .sort(
        (a, b) =>
          (c.skills[a.id] ?? 0) / skillPriority(a.id) - (c.skills[b.id] ?? 0) / skillPriority(b.id),
      );
    let learned = false;
    for (const s of options) {
      if (c.learn(s.id) === null) {
        learned = true;
        break;
      }
    }
    if (!learned) break;
  }
  const actives = Object.keys(c.skills)
    .filter((id) => getSkillDef(id)?.type !== 'passive' && (c.skills[id] ?? 0) > 0)
    .sort((a, b) => skillPriority(b) - skillPriority(a) || (c.skills[b] ?? 0) - (c.skills[a] ?? 0))
    .slice(0, 4);
  actives.forEach((id, i) => {
    if (c.skillBar[i] !== id) c.setSkillSlot(i, id);
  });
}

/** Stats, skills, job, gear, crafting — what a player does in menus. Returns notable events. */
export function housekeeping(
  a: Adventurer,
  now: number,
  events: BrainEvent[],
  worldWidthTiles: number,
): void {
  const c = a.character;
  if (c.progress.statPoints > 0) c.autoAllocate();
  if (c.jobId === 'novice' && c.level >= 10 && c.advance(a.profile.preferredJob)) {
    const gift = JOB_STARTER_WEAPONS[c.jobId];
    if (gift) c.inventory.add(gift, 1);
    a.memory.add({ t: now, kind: 'job', detail: c.jobId, importance: 0.95 });
    events.push({ type: 'job', key: a.key, jobId: c.jobId });
    a.say('job', now, { job: c.jobId }, true);
  }
  learnSkills(c);
  // Crafting toward the goal (and a potion reserve).
  const crafted = (itemId: string) => {
    events.push({ type: 'crafted', key: a.key, itemId });
    a.memory.add({
      t: now,
      kind: 'crafted',
      detail: itemId,
      importance: itemRegistry.get(itemId)?.rarity === 'common' ? 0.3 : 0.7,
    });
  };
  if (a.goal?.kind === 'item') {
    const plan = planItem((id) => c.inventory.count(id), a.goal.itemId, a.goal.count);
    for (const r of plan.craftable) if (craft(c.inventory, r.id, 1).ok) crafted(r.output.item);
  }
  if (c.inventory.count('healing_potion') < 3 && craft(c.inventory, 'healing_potion', 1).ok)
    crafted('healing_potion');
  equipBest(c);
  organizeHotbar(c);
  c.refreshStats(now);
  // Goals.
  if (a.goal && goalDone(a.goal, c)) {
    a.memory.add({
      t: now,
      kind: 'goal_done',
      detail: a.goal.kind === 'item' ? a.goal.itemId : a.goal.kind,
      importance: 0.6,
    });
    events.push({ type: 'goal', key: a.key });
    a.say('goal', now);
    a.goal = null;
  }
  if (!a.goal || now - a.goal.since > GOAL_TIMEOUT) {
    a.goal = chooseGoal(c, a.profile.personality, a.profile.archetype, a.rng, now, worldWidthTiles);
  }
}

// --- Perception ----------------------------------------------------------------------------------

interface Perception {
  threats: Monster[];
  target: Monster | null;
  targetScore: number;
  needs: readonly Need[];
}

function goalNeeds(a: Adventurer): readonly Need[] {
  const g = a.goal;
  if (!g || g.kind !== 'item') return [];
  return planItem((id) => a.character.inventory.count(id), g.itemId, g.count).needs;
}

function perceive(a: Adventurer, env: BrainEnv, needs: readonly Need[]): Perception {
  const c = a.character;
  const me = center(c);
  const p = a.profile.personality;
  const threats: Monster[] = [];
  let target: Monster | null = null;
  let targetScore = 0;
  const wantedMonsters = new Set(
    needs.flatMap((n) => (n.source.kind === 'monster' ? [n.source.monsterId] : [])),
  );
  if (a.goal?.kind === 'slay') wantedMonsters.add(a.goal.monsterId);
  for (const m of env.monsters) {
    if (!m.alive) continue;
    const mc = monsterCenter(m);
    const d = Math.hypot(mc.x - me.x, mc.y - me.y);
    if (d > PERCEPTION) continue;
    const mine = m.targetId === c.id;
    if ((mine && d < 9 * TILE_SIZE) || d < 3 * TILE_SIZE) threats.push(m);
    if (claimedByOther(m, c.id, env.now) && !mine) continue;
    if (m.def.boss && (c.level < m.def.level - 1 || p.courage < 0.55)) continue;
    const fit = m.level <= c.level + 1 + p.courage * 3 ? 1 : 0.15;
    const danger = 1 - a.memory.dangerNear(Math.floor(mc.x / TILE_SIZE), env.now) * p.caution;
    const s =
      (1 / (1 + d / (8 * TILE_SIZE))) *
      fit *
      danger *
      (wantedMonsters.has(m.def.id) ? 1.8 : 1) *
      (mine ? 1.6 : 1);
    if (s > targetScore) {
      targetScore = s;
      target = m;
    }
  }
  return { threats, target, targetScore, needs };
}

// --- Utility scoring -----------------------------------------------------------------------------

function inSafeZone(env: BrainEnv, x: number): boolean {
  const tx = Math.floor(x / TILE_SIZE);
  return tx >= env.safeFrom && tx <= env.safeTo;
}

function depthOf(env: BrainEnv, c: Character): number {
  const tx = Math.floor(c.motor.x / TILE_SIZE);
  return Math.floor((c.motor.y - 1) / TILE_SIZE) - env.world.surfaceY(tx);
}

function canMine(c: Character, needs: readonly Need[]): boolean {
  const need = needs.find((n) => n.source.kind === 'tile');
  let power = 0;
  for (let i = 0; i < c.inventory.size; i++) {
    const t = itemRegistry.get(c.inventory.get(i)?.itemId ?? '')?.tool;
    if (t?.type === 'pickaxe') power = Math.max(power, t.power);
  }
  return !!need && need.source.kind === 'tile' && power >= need.source.minPower;
}

/** Utility scores of every action (exported for tests and the AI debugger). */
export function scoreActions(a: Adventurer, env: BrainEnv): Record<ActionId, number> {
  return score(a, env, perceive(a, env, goalNeeds(a)));
}

function score(a: Adventurer, env: BrainEnv, per: Perception): Record<ActionId, number> {
  const c = a.character;
  const p = a.profile.personality;
  const arche = a.profile.archetype;
  const hp = c.hp / Math.max(1, c.stats.maxHp);
  const threatened = per.threats.length > 0;
  const hpFactor = hp > fleeThreshold(p) ? Math.min(1, 0.4 + hp) : 0.1;
  const needTile = per.needs.some((n) => n.source.kind === 'tile');
  const needObject = per.needs.some((n) => n.source.kind === 'object');
  const needMonster = per.needs.some((n) => n.source.kind === 'monster');
  const huntGoal = a.goal?.kind === 'level' || a.goal?.kind === 'slay' || needMonster;
  const player = env.player;
  const pd =
    player && player.alive
      ? Math.abs(player.motor.x - c.motor.x) + Math.abs(player.motor.y - c.motor.y)
      : Infinity;
  const affinity = a.memory.relations.get('player')?.affinity ?? 0;
  const s: Record<ActionId, number> = {
    fight:
      per.target === null
        ? 0
        : per.targetScore *
            (0.45 + p.aggression * 0.55) *
            hpFactor *
            (arche === 'hunter' ? 1.35 : arche === 'artisan' ? 0.8 : 1) *
            (huntGoal ? 1.3 : 1) +
          (threatened ? 0.55 : 0),
    flee: threatened && hp < fleeThreshold(p) ? 1.3 : 0,
    rest: !threatened && hp < 0.75 ? (1 - hp) * (0.7 + p.caution * 0.6) : 0,
    gather: needObject ? 0.55 + (arche === 'artisan' ? 0.2 : 0) : 0,
    mine: needTile && canMine(c, per.needs) ? 0.6 + (arche === 'artisan' ? 0.25 : 0) : 0,
    seek: per.target === null && huntGoal ? 0.42 + (arche === 'hunter' ? 0.15 : 0) : 0,
    explore:
      a.goal?.kind === 'explore' ? 0.6 : p.curiosity * 0.32 + (arche === 'explorer' ? 0.12 : 0),
    return:
      (env.night && !a.profile.nightOwl && depthOf(env, c) < 4 ? 0.55 * (0.5 + p.caution) : 0) +
      (Math.abs(c.motor.x / TILE_SIZE - a.profile.homeX) > 260 ? 0.3 : 0),
    socialize:
      pd < 14 * TILE_SIZE && env.now - a.greetedAt > 90
        ? (0.2 + p.friendliness * 0.45 + affinity * 0.35) * (0.5 + p.sociability)
        : 0,
    wander: 0.14,
  };
  // Light noise so equally placed adventurers do not all act alike.
  for (const k of Object.keys(s) as ActionId[]) if (s[k] > 0) s[k] *= 0.94 + a.rng.next() * 0.12;
  return s;
}

// --- Movement helpers ----------------------------------------------------------------------------

function steerTo(env: BrainEnv, c: Character, x: number, y: number): MotorInput {
  const m = c.motor;
  const dx = x - m.x;
  if (Math.abs(dx) < 3) return IDLE_INPUT;
  const dir = Math.sign(dx);
  const front = m.x + dir * (m.width / 2 + 3);
  const wall = isRegionSolid(env.world, front - 1, m.y - m.height + 2, front + 1, m.y - 17);
  const ftx = Math.floor((m.x + dir * 12) / TILE_SIZE);
  const fty = Math.floor(m.y / TILE_SIZE);
  const gap =
    m.grounded &&
    env.world.collisionAt(ftx, fty) === COLLISION_NONE &&
    env.world.collisionAt(ftx, fty + 1) === COLLISION_NONE;
  const above = y < m.y - 2.5 * TILE_SIZE;
  const jump = m.grounded && (wall || (gap && y <= m.y) || (above && Math.abs(dx) < 3 * TILE_SIZE));
  return { moveX: dir, jumpPressed: jump, jumpHeld: !m.grounded || jump, down: false };
}

/** Move toward a world point using the nav graph when far or blocked. */
function travel(a: Adventurer, env: BrainEnv, x: number, y: number, tolerance = 1): MotorInput {
  const c = a.character;
  const m = c.motor;
  const near = Math.abs(x - m.x) < 6 * TILE_SIZE && Math.abs(y - m.y) < 2 * TILE_SIZE;
  if (near && a.stuckFor < 1) return steerTo(env, c, x, y);
  const nav = env.nav;
  const goalTx = Math.floor(x / TILE_SIZE);
  const goal =
    nav.groundBelow(goalTx, Math.floor(y / TILE_SIZE) - 3, 8) ??
    nav.groundBelow(goalTx, env.world.surfaceY(goalTx) - 4, 10);
  const f = a.follower;
  const needPath =
    goal !== null &&
    (!f || f.failed || f.done || a.pathGoal !== goal || env.now > a.repathAt) &&
    env.pathBudget > 0 &&
    m.grounded;
  if (needPath && goal !== null) {
    const start = nav.nodeAt(m.x, m.y);
    if (start !== null) {
      env.pathBudget--;
      const res = findPath(nav, start, goal, { maxExpansions: 700, tolerance });
      const fol = a.follower ?? new PathFollower(nav);
      fol.set(res.edges, start);
      a.follower = fol;
      a.pathGoal = goal;
      a.repathAt = env.now + (res.complete ? 6 : 2.5);
    }
  }
  const fol = a.follower;
  if (fol && !fol.done && !fol.failed) {
    const input = fol.step(m, env.dt, c.stats.moveSpeed);
    if (fol.failed) a.repathAt = 0;
    return input;
  }
  return steerTo(env, c, x, y);
}

// --- Behaviours ----------------------------------------------------------------------------------

interface Out {
  move: MotorInput;
  use: { tx: number; ty: number } | null;
  action: ActionIntent;
}

function fight(a: Adventurer, env: BrainEnv, per: Perception, out: Out): void {
  const c = a.character;
  const now = env.now;
  const target = per.target ?? per.threats[0] ?? null;
  if (!target) return;
  if (c.selectedSlot !== 0 && c.inventory.get(0)) c.select(0);
  const w = c.usableWeapon();
  const range = RANGE[w?.type ?? 'sword'] ?? 24;
  const me = center(c);
  const tc = monsterCenter(target);
  const dx = tc.x - me.x;
  const dist = Math.abs(dx);
  const aim = { aimX: tc.x, aimY: tc.y };
  let attackHeld = false;
  let attackPressed = false;
  const ranged = range > 60;
  if (dist > range + target.motor.width / 2 || Math.abs(tc.y - me.y) > (ranged ? 90 : 26)) {
    out.move = travel(a, env, target.motor.x, target.motor.y, 1);
  } else if (ranged && dist < range * 0.35 && a.profile.skill > 0.45) {
    out.move = { ...IDLE_INPUT, moveX: -Math.sign(dx) };
  } else {
    out.move = IDLE_INPUT;
  }
  const inRange =
    dist <= range + target.motor.width / 2 + 6 && Math.abs(tc.y - me.y) < (ranged ? 120 : 34);
  if (inRange) {
    if (w?.type === 'bow' && dist > 90 && a.profile.skill > 0.5) {
      // Draw for a charged shot, release when ready.
      if (a.chargeUntil === 0) a.chargeUntil = now + 0.62;
      attackHeld = now < a.chargeUntil;
      if (!attackHeld) a.chargeUntil = 0;
    } else {
      attackHeld = true;
      attackPressed = true;
    }
  }
  let skillSlot: number | null = null;
  if (now > a.skillAt) {
    a.skillAt = now + 0.35 + (1 - a.profile.skill) * 0.4;
    const crowd = env.monsters.filter(
      (m) => m.alive && Math.hypot(m.motor.x - c.motor.x, m.motor.y - c.motor.y) < 70,
    ).length;
    for (let i = 0; i < c.skillBar.length; i++) {
      const id = c.skillBar[i];
      const def = id ? getSkillDef(id) : undefined;
      if (!id || !def) continue;
      const lvl = c.skillLevel(id);
      if (c.combat.cooldownLeft(id, now) > 0 || c.mp < scaled(def.mp, lvl) + 4) continue;
      if (def.type === 'buff') {
        const st = def.status ? getStatusDef(def.status) : undefined;
        if (st && !c.statuses.has(st.id, now)) {
          skillSlot = i;
          break;
        }
        continue;
      }
      const aoe = def.action?.events.some(
        (e) => e.kind === 'zone' || (e.kind === 'hit' && e.shape.type === 'circle'),
      );
      if (def.id === 'mage_blink' || def.id === 'archer_evasive_shot') {
        if (per.threats.length > 0 && c.hp / c.stats.maxHp < 0.5) {
          skillSlot = i;
          break;
        }
        continue;
      }
      if ((aoe && crowd >= 2) || (!aoe && inRange)) {
        skillSlot = i;
        break;
      }
    }
  }
  // Dodge telegraphed attacks, with human-like reaction time and accuracy.
  let dodge = false;
  const danger = per.threats.find((m) => telegraphing(m) && Math.abs(m.motor.x - c.motor.x) < 110);
  if (danger) {
    if (a.dodgeAt < 0) a.dodgeAt = now + 0.12 + (1 - a.profile.skill) * 0.35;
    if (now >= a.dodgeAt) {
      a.dodgeAt = -1;
      if (a.rng.chance(0.25 + a.profile.skill * 0.6)) {
        dodge = true;
        out.move = { ...IDLE_INPUT, moveX: -Math.sign(danger.motor.x - c.motor.x) || 1 };
      }
    }
  } else a.dodgeAt = -1;
  const hp = c.hp / Math.max(1, c.stats.maxHp);
  const quickHeal =
    hp < potionThreshold(a.profile.personality) &&
    bestPotion(c, 'heal') >= 0 &&
    now >= c.potionCooldownUntil;
  out.action = { attackPressed, attackHeld, ...aim, skillSlot, dodge, quickHeal, quickMana: false };
}

function flee(a: Adventurer, env: BrainEnv, per: Perception, out: Out): void {
  const c = a.character;
  const threat = per.threats[0];
  const homeX = a.profile.homeX * TILE_SIZE;
  const dir = threat
    ? -Math.sign(threat.motor.x - c.motor.x) || 1
    : Math.sign(homeX - c.motor.x) || 1;
  const tx = c.motor.x + dir * 30 * TILE_SIZE;
  out.move = travel(a, env, tx, c.motor.y, 2);
  const hp = c.hp / Math.max(1, c.stats.maxHp);
  const near = threat && Math.abs(threat.motor.x - c.motor.x) < 50;
  out.action = {
    ...IDLE_ACTION,
    aimX: c.motor.x + dir * 50,
    aimY: c.motor.y - 20,
    dodge: !!near && a.rng.chance(0.05 + a.profile.skill * 0.1),
    quickHeal: hp < 0.5 && bestPotion(c, 'heal') >= 0 && env.now >= c.potionCooldownUntil,
  };
}

/** Find a harvestable object (tree for wood, plants for fiber) near the adventurer. */
function findObject(
  a: Adventurer,
  env: BrainEnv,
  keys: (key: string) => boolean,
): { tx: number; ty: number } | null {
  const c = a.character;
  const cx0 = Math.floor(c.motor.x / TILE_SIZE / 32);
  const cy0 = Math.floor(c.motor.y / TILE_SIZE / 32);
  let best: { tx: number; ty: number } | null = null;
  let bd = Infinity;
  for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
    for (let cx = cx0 - 2; cx <= cx0 + 2; cx++) {
      if (!env.world.inChunkBounds(cx, cy)) continue;
      for (const o of env.world.objectsInChunk(cx, cy)) {
        if (!keys(o.key) || (o.tx >= env.safeFrom && o.tx <= env.safeTo)) continue;
        const d =
          Math.abs(o.tx * TILE_SIZE - c.motor.x) + Math.abs(o.ty * TILE_SIZE - c.motor.y) * 2;
        if (d < bd) {
          bd = d;
          best = { tx: o.tx, ty: o.key.startsWith('tree_') ? o.ty - 1 : o.ty };
        }
      }
    }
  }
  return best;
}

function workAt(
  a: Adventurer,
  env: BrainEnv,
  tile: { tx: number; ty: number },
  slot: number,
  out: Out,
): boolean {
  const c = a.character;
  if (c.selectedSlot !== slot) c.select(slot);
  const tx = tile.tx * TILE_SIZE + TILE_SIZE / 2;
  const ty = tile.ty * TILE_SIZE + TILE_SIZE / 2;
  const me = center(c);
  const reach =
    (itemRegistry.get(c.inventory.get(slot)?.itemId ?? '')?.tool?.reach ?? 5) * TILE_SIZE - 6;
  if (Math.hypot(tx - me.x, ty - me.y) > reach) {
    out.move = travel(
      a,
      env,
      tx - Math.sign(tx - c.motor.x) * 2 * TILE_SIZE,
      (tile.ty + 1) * TILE_SIZE,
      2,
    );
    return false;
  }
  out.move = IDLE_INPUT;
  out.use = tile;
  out.action = { ...IDLE_ACTION, aimX: tx, aimY: ty };
  return true;
}

function gather(a: Adventurer, env: BrainEnv, per: Perception, out: Out): void {
  const wantsWood = per.needs.some((n) => n.source.kind === 'object' && n.source.tool === 'axe');
  if (!a.targetTile || env.world.objectAt(a.targetTile.tx, a.targetTile.ty) === null) {
    a.targetTile = findObject(a, env, (k) =>
      wantsWood ? k.startsWith('tree_') : k === 'tall_grass' || k === 'grass_tuft' || k === 'bush',
    );
  }
  if (!a.targetTile) {
    a.action = 'explore';
    return;
  }
  workAt(a, env, a.targetTile, wantsWood ? 2 : 3, out);
}

/** Exposed ore tile of the wanted kind near the adventurer. */
function findOre(env: BrainEnv, c: Character, tileId: number): { tx: number; ty: number } | null {
  const ctx = Math.floor(c.motor.x / TILE_SIZE);
  const cty = Math.floor((c.motor.y - 20) / TILE_SIZE);
  let best: { tx: number; ty: number } | null = null;
  let bd = Infinity;
  for (let ty = cty - 10; ty <= cty + 10; ty++) {
    for (let tx = ctx - 14; tx <= ctx + 14; tx++) {
      if (env.world.getFg(tx, ty) !== tileId) continue;
      const exposed =
        env.world.collisionAt(tx - 1, ty) === COLLISION_NONE ||
        env.world.collisionAt(tx + 1, ty) === COLLISION_NONE ||
        env.world.collisionAt(tx, ty - 1) === COLLISION_NONE;
      if (!exposed) continue;
      const d = Math.abs(tx - ctx) + Math.abs(ty - cty) * 1.5;
      if (d < bd) {
        bd = d;
        best = { tx, ty };
      }
    }
  }
  return best;
}

/** Dig a staircase down (or sideways) toward a depth, mining what blocks the way. */
function dig(a: Adventurer, env: BrainEnv, targetDepth: number, out: Out): void {
  const c = a.character;
  const m = c.motor;
  if (inSafeZone(env, m.x)) {
    const side =
      Math.abs(m.x / TILE_SIZE - env.safeFrom) < Math.abs(m.x / TILE_SIZE - env.safeTo)
        ? env.safeFrom - 6
        : env.safeTo + 6;
    out.move = travel(a, env, side * TILE_SIZE, m.y, 2);
    return;
  }
  if (c.selectedSlot !== 1) c.select(1);
  const dir = a.profile.homeX * TILE_SIZE < m.x ? 1 : -1;
  const tx = Math.floor(m.x / TILE_SIZE);
  const ty = Math.round(m.y / TILE_SIZE) - 1;
  const depth = depthOf(env, c);
  const solid = (x: number, y: number) =>
    env.world.collisionAt(x, y) !== COLLISION_NONE &&
    (env.world.tiles.get(env.world.getFg(x, y))?.durability ?? 0) > 0;
  const order: [number, number][] = [
    [tx + dir, ty - 2],
    [tx + dir, ty - 1],
    [tx + dir, ty],
  ];
  if (depth < targetDepth) order.push([tx + dir, ty + 1]);
  for (const [x, y] of order) {
    if (solid(x, y)) {
      out.use = { tx: x, ty: y };
      out.action = { ...IDLE_ACTION, aimX: x * TILE_SIZE + 8, aimY: y * TILE_SIZE + 8 };
      out.move = IDLE_INPUT;
      return;
    }
  }
  out.move = { ...IDLE_INPUT, moveX: dir };
}

function mine(a: Adventurer, env: BrainEnv, per: Perception, out: Out): void {
  const need = per.needs.find((n) => n.source.kind === 'tile');
  if (!need || need.source.kind !== 'tile') {
    a.action = 'wander';
    return;
  }
  const c = a.character;
  const tileId = tileRegistry.idOf(need.source.tileKey);
  const pick = itemRegistry.get(c.inventory.get(1)?.itemId ?? '')?.tool;
  if (!pick || pick.type !== 'pickaxe' || pick.power < need.source.minPower) {
    a.action = 'wander';
    return;
  }
  if (!a.targetTile || env.world.getFg(a.targetTile.tx, a.targetTile.ty) !== tileId) {
    a.targetTile = findOre(env, c, tileId);
  }
  if (a.targetTile && !inSafeZone(env, a.targetTile.tx * TILE_SIZE)) {
    workAt(a, env, a.targetTile, 1, out);
    if (out.use) a.stuckFor = 0;
    return;
  }
  dig(a, env, need.source.minDepth + 3, out);
}

export function huntingGround(
  a: Adventurer,
  env: { readonly safeFrom: number; readonly safeTo: number },
): number {
  const c = a.character;
  const side = a.profile.homeX >= (env.safeFrom + env.safeTo) / 2 ? 1 : -1;
  const edge = side > 0 ? env.safeTo : env.safeFrom;
  return (edge + side * (8 + (a.profile.index % 5) * 9 + Math.min(40, c.level * 3))) * TILE_SIZE;
}

function surfacePoint(env: BrainEnv, x: number): { x: number; y: number } {
  const tx = Math.max(2, Math.min(env.world.widthTiles - 3, Math.floor(x / TILE_SIZE)));
  return { x: tx * TILE_SIZE + 8, y: env.world.surfaceY(tx) * TILE_SIZE };
}

/** One tick of an active adventurer's brain. */
export function thinkAdventurer(a: Adventurer, env: BrainEnv): CharacterIntent {
  const c = a.character;
  const now = env.now;
  const out: Out = {
    move: IDLE_INPUT,
    use: null,
    action: { ...IDLE_ACTION, aimX: c.motor.x + c.facing * 40, aimY: c.motor.y - 22 },
  };
  if (!c.alive) return out;

  if (now >= a.houseAt) {
    a.houseAt = now + 1.5 + a.rng.next();
    housekeeping(a, now, env.events, env.world.widthTiles);
  }
  const needs = goalNeeds(a);
  const per = perceive(a, env, needs);

  // Tactics: re-score twice a second, commit with hysteresis.
  if (now >= a.thinkAt) {
    a.thinkAt = now + 0.45 + a.rng.next() * 0.15;
    const s = score(a, env, per);
    a.scores = s;
    let best: ActionId = a.action;
    let bestScore = (s[a.action] ?? 0) + HYSTERESIS;
    for (const k of Object.keys(s) as ActionId[]) {
      if (s[k] > bestScore) {
        best = k;
        bestScore = s[k];
      }
    }
    if (best !== a.action) {
      a.action = best;
      a.actionSince = now;
      a.targetTile = null;
      a.travelX = null;
      if (best === 'flee') {
        a.say('flee', now);
        a.memory.add({
          t: now,
          kind: 'fled',
          x: Math.floor(c.motor.x / TILE_SIZE),
          importance: 0.35,
        });
      }
    }
  }

  // Stuck detection for every movement-based action.
  if (Math.abs(c.motor.x - a.lastX) < 0.2 && out.use === null) a.stuckFor += env.dt;
  else a.stuckFor = Math.max(0, a.stuckFor - env.dt * 2);
  a.lastX = c.motor.x;

  switch (a.action) {
    case 'fight':
      fight(a, env, per, out);
      break;
    case 'flee':
      flee(a, env, per, out);
      break;
    case 'rest':
      out.action = {
        ...out.action,
        quickHeal:
          c.hp / c.stats.maxHp < 0.35 && bestPotion(c, 'heal') >= 0 && now >= c.potionCooldownUntil,
      };
      break;
    case 'gather':
      gather(a, env, per, out);
      break;
    case 'mine':
      mine(a, env, per, out);
      break;
    case 'seek': {
      if (a.travelX === null) a.travelX = huntingGround(a, env);
      const pt = surfacePoint(env, a.travelX);
      out.move = travel(a, env, pt.x, pt.y, 2);
      if (Math.abs(pt.x - c.motor.x) < 3 * TILE_SIZE)
        a.travelX = huntingGround(a, env) + a.rng.range(-12, 12) * TILE_SIZE;
      break;
    }
    case 'explore': {
      const goalX = a.goal?.kind === 'explore' ? a.goal.targetX * TILE_SIZE : null;
      if (a.travelX === null || Math.abs(a.travelX - c.motor.x) < 3 * TILE_SIZE) {
        const dir = goalX !== null ? Math.sign(goalX - c.motor.x) || 1 : a.rng.sign();
        const step = Math.min(50, goalX !== null ? Math.abs(goalX - c.motor.x) / TILE_SIZE : 40);
        a.travelX = c.motor.x + dir * step * TILE_SIZE;
      }
      const pt = surfacePoint(env, a.travelX);
      out.move = travel(a, env, pt.x, pt.y, 2);
      break;
    }
    case 'return': {
      const pt = surfacePoint(env, a.profile.homeX * TILE_SIZE);
      out.move =
        Math.abs(pt.x - c.motor.x) > 2 * TILE_SIZE ? travel(a, env, pt.x, pt.y, 2) : IDLE_INPUT;
      break;
    }
    case 'socialize': {
      const pl = env.player;
      if (!pl || !pl.alive) {
        a.action = 'wander';
        break;
      }
      const dx = pl.motor.x - c.motor.x;
      out.move =
        Math.abs(dx) > 3 * TILE_SIZE
          ? travel(a, env, pl.motor.x - Math.sign(dx) * 2 * TILE_SIZE, pl.motor.y, 1)
          : IDLE_INPUT;
      out.action = { ...out.action, aimX: pl.motor.x, aimY: pl.motor.y - 22 };
      if (Math.abs(dx) <= 4 * TILE_SIZE) {
        const rel = a.memory.relation('player');
        a.say(
          rel.met > 0 ? (rel.affinity > 0.3 ? 'greetFriend' : 'greetAgain') : 'greetNew',
          now,
          undefined,
          true,
        );
        if (rel.met === 0)
          a.memory.add({ t: now, kind: 'met', subject: 'player', importance: 0.5 });
        rel.met++;
        rel.lastSeen = now;
        a.greetedAt = now;
        a.actionSince = now;
        a.thinkAt = now + 2.5;
        a.action = 'wander';
      }
      break;
    }
    case 'wander': {
      if (a.travelX === null || Math.abs(a.travelX - c.motor.x) < 8 || a.stuckFor > 2) {
        a.travelX = c.motor.x + a.rng.range(-10, 10) * TILE_SIZE;
        a.stuckFor = 0;
      }
      if (now - a.actionSince > 1 && a.rng.chance(0.004)) a.actionSince = now + 2;
      out.move = now < a.actionSince ? IDLE_INPUT : steerTo(env, c, a.travelX, c.motor.y);
      break;
    }
  }
  // Give up on a stuck target after a while.
  if (a.stuckFor > 4) {
    a.stuckFor = 0;
    a.targetTile = null;
    a.travelX = null;
    a.follower = null;
    a.thinkAt = 0;
    a.action = 'wander';
  }
  // Keep an idle hand: never hold the pickaxe/axe out while just walking around.
  if (
    out.use === null &&
    a.action !== 'fight' &&
    c.selectedSlot !== 0 &&
    (a.action === 'wander' || a.action === 'socialize' || a.action === 'return')
  )
    c.select(0);
  if (out.action.aimX === 0 && out.action.aimY === 0)
    out.action = { ...out.action, aimX: c.motor.x, aimY: c.motor.y };
  return { move: out.move, use: out.use, action: out.action };
}

/** Does the plan need anything that only mining provides? (used by the abstract simulation) */
export function needsMining(a: Adventurer): boolean {
  return goalNeeds(a).some((n) => n.source.kind === 'tile');
}
