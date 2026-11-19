/**
 * What each player is told about the world: the entities within their interest area (a window
 * around them), their own motor state for prediction, and the events they should see.
 */
import {
  type Adventurer,
  type Character,
  CF_ALIVE,
  CF_BLINK,
  CF_CHARGING,
  CF_DODGING,
  CF_GROUNDED,
  CF_HURT,
  ENT_ADVENTURER,
  ENT_DROP,
  ENT_MONSTER,
  ENT_PLAYER,
  ENT_PROJECTILE,
  ENT_ZONE,
  type EntityView,
  INTEREST_TILES_X,
  INTEREST_TILES_Y,
  MF_ALIVE,
  MF_STUNNED,
  MF_VULNERABLE,
  type PlayerSlot,
  type SelfState,
  type Snapshot,
  TILE_SIZE,
  type WorldEvents,
  type WorldSim,
} from '@world/shared';

export interface View {
  readonly x: number;
  readonly y: number;
}

const RX = INTEREST_TILES_X * TILE_SIZE;
const RY = INTEREST_TILES_Y * TILE_SIZE;

export function inView(v: View, x: number, y: number): boolean {
  return Math.abs(x - v.x) <= RX && Math.abs(y - v.y) <= RY;
}

function characterFlags(c: Character, now: number): number {
  let f = 0;
  if (c.motor.grounded) f |= CF_GROUNDED;
  if (c.alive) f |= CF_ALIVE;
  if (c.combat.dodgeUntil > now) f |= CF_DODGING;
  if (c.heldWeapon()?.type === 'bow' && !Number.isNaN(c.combat.chargeStart)) f |= CF_CHARGING;
  if (now < c.staggerUntil) f |= CF_HURT;
  if (c.alive && now < c.invulnUntil && now - c.lastHitAt < 1.2 && c.combat.dodgeUntil <= now)
    f |= CF_BLINK;
  return f;
}

function characterView(
  kind: typeof ENT_PLAYER | typeof ENT_ADVENTURER,
  c: Character,
  now: number,
  extra: { name: string; look: number; action: string; aimX: number; aimY: number },
): EntityView {
  const m = c.motor;
  return {
    kind,
    id: c.id,
    key: c.key,
    name: extra.name,
    look: extra.look,
    x: m.x,
    y: m.y,
    vx: m.vx,
    vy: m.vy,
    facing: m.facing,
    flags: characterFlags(c, now),
    hp: c.hp,
    maxHp: c.stats.maxHp,
    level: c.level,
    job: c.jobId,
    held: c.inventory.get(c.selectedSlot)?.itemId ?? '',
    action: extra.action,
    aimX: extra.aimX,
    aimY: extra.aimY,
  };
}

function adventurerAim(a: Adventurer): { aimX: number; aimY: number } {
  const t = a.targetTile;
  return t
    ? { aimX: t.tx * TILE_SIZE + 8, aimY: t.ty * TILE_SIZE + 8 }
    : { aimX: a.character.motor.x + a.character.motor.facing * 30, aimY: a.character.motor.y - 22 };
}

export function selfState(c: Character): SelfState {
  const m = c.motor;
  return {
    x: m.x,
    y: m.y,
    vx: m.vx,
    vy: m.vy,
    facing: m.facing,
    grounded: m.grounded,
    jumping: m.jumping,
    alive: c.alive,
    coyoteTimer: m.coyoteTimer,
    jumpBufferTimer: m.jumpBufferTimer,
    dropTimer: m.dropTimer,
    airTime: m.airTime,
  };
}

/** An entity's view with its position (for interest filtering) and owner (players). */
export interface WorldEntity {
  readonly view: EntityView;
  readonly x: number;
  readonly y: number;
  /** Player key for player entities (a player is not sent to themself). */
  readonly key: string | null;
}

/** Every replicated entity, built once per replication and shared by all viewers. */
export function collectEntities(sim: WorldSim, looks: ReadonlyMap<string, number>): WorldEntity[] {
  const now = sim.time;
  const out: WorldEntity[] = [];
  for (const s of sim.playerSlots) {
    const c = s.character;
    out.push({
      view: characterView(ENT_PLAYER, c, now, {
        name: c.name,
        look: looks.get(s.key) ?? 0,
        action: '',
        aimX: 0,
        aimY: 0,
      }),
      x: c.motor.x,
      y: c.motor.y,
      key: s.key,
    });
  }
  for (const a of sim.adventurers.active) {
    const c = a.character;
    out.push({
      view: characterView(ENT_ADVENTURER, c, now, {
        name: '',
        look: 0,
        action: a.action,
        ...adventurerAim(a),
      }),
      x: c.motor.x,
      y: c.motor.y,
      key: null,
    });
  }
  for (const m of sim.monsters.monsters) {
    let flags = 0;
    if (m.alive) flags |= MF_ALIVE;
    if (m.vulnerable > 1) flags |= MF_VULNERABLE;
    if (m.statuses.stunned(now)) flags |= MF_STUNNED;
    out.push({
      view: {
        kind: ENT_MONSTER,
        id: m.id,
        def: m.def.id,
        anim: m.anim,
        x: m.motor.x,
        y: m.motor.y,
        vx: m.motor.vx,
        vy: m.motor.vy,
        facing: m.facing,
        flags,
        hp: m.hp,
        maxHp: m.stats.maxHp,
        deadTime: m.deadTime,
        statuses: m.statuses.all.filter((s) => s.until > now).map((s) => s.def.id),
      },
      x: m.motor.x,
      y: m.motor.y,
      key: null,
    });
  }
  for (const d of sim.drops)
    out.push({
      view: {
        kind: ENT_DROP,
        id: d.id,
        item: d.itemId,
        count: d.count,
        x: d.x,
        y: d.y,
        magnet: d.magnet,
      },
      x: d.x,
      y: d.y,
      key: null,
    });
  for (const p of sim.combat.projectiles) {
    if (!p.alive) continue;
    out.push({
      view: { kind: ENT_PROJECTILE, id: p.id, def: p.def.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy },
      x: p.x,
      y: p.y,
      key: null,
    });
  }
  for (const z of sim.combat.zones) {
    if (z.until <= now) continue;
    out.push({
      view: {
        kind: ENT_ZONE,
        id: z.id,
        tag: z.visual,
        x: z.x,
        y: z.y,
        radius: z.radius,
        left: z.until - now,
      },
      x: z.x,
      y: z.y,
      key: null,
    });
  }
  return out;
}

/** Snapshot of the world as seen by one player (entities from `collectEntities`). */
export function buildSnapshot(
  sim: WorldSim,
  viewer: PlayerSlot,
  ack: number,
  all: readonly WorldEntity[],
): Snapshot {
  const me = viewer.character;
  const v: View = { x: me.motor.x, y: me.motor.y };
  const entities: EntityView[] = [];
  for (const e of all) if (e.key !== viewer.key && inView(v, e.x, e.y)) entities.push(e.view);
  return {
    tick: sim.tickCount,
    time: sim.time,
    ack,
    hour: sim.clock.timeOfDay,
    day: sim.clock.day,
    self: selfState(me),
    entities,
  };
}

/** Wire form of world events (actions referenced by id), filtered to what a player can see. */
export interface WireWorldEvents {
  readonly combat: readonly unknown[];
  readonly monster: readonly unknown[];
  readonly actor: readonly { id: number; event: unknown }[];
  readonly uses: readonly unknown[];
  readonly levelUps: readonly { id: number; level: number }[];
  readonly spoken: readonly unknown[];
  readonly news: readonly unknown[];
}

/** Positions of characters/monsters by id, for filtering events by interest area. */
export function positionsOf(sim: WorldSim): Map<number, View> {
  const pos = new Map<number, View>();
  for (const s of sim.playerSlots) pos.set(s.character.id, s.character.motor);
  for (const a of sim.adventurers.active) pos.set(a.character.id, a.character.motor);
  for (const m of sim.monsters.monsters) pos.set(m.id, m.motor);
  return pos;
}

export function filterEvents(
  ev: WorldEvents,
  v: View,
  pos: ReadonlyMap<number, View>,
  spokenBy: (key: string) => View | undefined,
): WireWorldEvents {
  const near = (id: number) => {
    const p = pos.get(id);
    return !!p && inView(v, p.x, p.y);
  };
  return {
    combat: ev.combat.filter((e) =>
      'x' in e ? inView(v, e.x, e.y) : 'targetId' in e ? near(e.targetId) : false,
    ),
    monster: ev.monster.filter((e) =>
      'id' in e ? near(e.id) : 'x' in e ? inView(v, e.x, e.y) : false,
    ),
    actor: ev.actor
      .filter((a) => near(a.id))
      .map((a) =>
        a.event.type === 'action'
          ? { id: a.id, event: { ...a.event, action: a.event.action.id } }
          : { id: a.id, event: a.event },
      ),
    uses: ev.uses
      .filter((u) => inView(v, u.out.tx * TILE_SIZE, u.out.ty * TILE_SIZE))
      .map((u) => ({ id: u.id, out: { ...u.out, drops: [] } })),
    levelUps: ev.levelUps.filter((l) => near(l.id)),
    spoken: ev.spoken.filter((s) => {
      const p = spokenBy(s.speaker);
      return !!p && inView(v, p.x, p.y);
    }),
    news: ev.news,
  };
}
