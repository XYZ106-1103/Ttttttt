import { describe, expect, it } from 'vitest';
import {
  ballisticAngle,
  type BrainContext,
  COLLISION_NONE,
  COLLISION_SOLID,
  type CollisionGrid,
  CombatWorld,
  type Combatant,
  createMonster,
  createMotorState,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  type MonsterEvent,
  MonsterManager,
  monsterCombatStats,
  OverworldGenerator,
  pickSpawn,
  requireMonsterDef,
  Rng,
  rollLoot,
  seedFromString,
  SIM_DT,
  StatusSet,
  stepBrain,
  stepMotor,
  TILE,
  World,
  zoneAt,
} from '../src';

const FLOOR_ROW = 20;
const FLOOR_Y = FLOOR_ROW * 16;
const flat: CollisionGrid = {
  collisionAt: (tx: number, ty: number) =>
    ty >= FLOOR_ROW || tx <= 0 || tx >= 80 ? COLLISION_SOLID : COLLISION_NONE,
};

function target(x: number, y = FLOOR_Y): Combatant {
  const motor = createMotorState(x, y, DEFAULT_MOVEMENT);
  motor.grounded = true;
  return {
    id: 999,
    team: 'player',
    kind: 'player',
    body: motor,
    hp: 1000,
    mp: 0,
    alive: true,
    level: 10,
    stats: { ...monsterCombatStats({ hp: 1000, attack: 10, defense: 0 }) },
    statuses: new StatusSet(),
    invulnUntil: 0,
    perfectUntil: 0,
    staggerUntil: 0,
    knockbackResist: 0,
    hurtIframes: 0.7,
    immune: new Set(),
    vulnerable: 1,
    lastHitAt: -10,
    facing: 1,
  };
}

/** Drive one monster on the flat test grid. */
function simulate(defId: string, x: number, y: number, tgt: Combatant | null, seconds: number) {
  const combat = new CombatWorld(flat, 5);
  const m = createMonster(1, requireMonsterDef(defId), x, y, 7);
  if (m.def.boss) {
    m.brain.mode = 'intro';
    m.brain.timer = 1.6;
  }
  combat.add(m);
  if (tgt) combat.add(tgt);
  const events: MonsterEvent[] = [];
  const rng = new Rng(11);
  let now = 0;
  const xs: number[] = [];
  const anims: string[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    const ctx: BrainContext = { grid: flat, combat, target: tgt, now, dt: SIM_DT, rng, events };
    const input = stepBrain(m, ctx);
    if (input) stepMotor(m.motor, input, flat, m.movement, SIM_DT);
    combat.step(SIM_DT, now);
    xs.push(m.motor.x);
    anims.push(m.anim);
    now += SIM_DT;
  }
  return { m, combat, events, xs, anims };
}

describe('monster brains', () => {
  it('slimes hop toward a nearby player', () => {
    const t = target(300);
    const { xs } = simulate('dew_slime', 420, FLOOR_Y, t, 5);
    expect(xs[xs.length - 1]).toBeLessThan(380);
  });

  it('beetles telegraph before charging, then become vulnerable after hitting a wall', () => {
    const t = target(1000);
    const { events, m, xs, anims } = simulate('thornback', 1150, FLOOR_Y, t, 1.6);
    expect(events.some((e) => e.type === 'telegraph' && e.kind === 'charge')).toBe(true);
    // During the windup it stands still...
    const w0 = anims.indexOf('windup');
    const w1 = anims.lastIndexOf('windup');
    expect(w1 - w0).toBeGreaterThan(20);
    expect(Math.abs((xs[w0 + 5] ?? 0) - (xs[w1] ?? 0))).toBeLessThan(1);
    // ...then charges fast.
    expect(xs[xs.length - 1]).toBeLessThan(1120);
    expect(m.contact).toBeGreaterThan(m.def.contact);
    // Charge into the left wall (no target in front) → daze.
    const wallRun = simulate('thornback', 120, FLOOR_Y, target(60), 3);
    expect(wallRun.events.some((e) => e.type === 'impact')).toBe(true);
  });

  it('bats orbit and swoop at the player', () => {
    const t = target(600);
    const { events } = simulate('cave_bat', 640, FLOOR_Y - 90, t, 6);
    expect(events.some((e) => e.type === 'telegraph' && e.kind === 'swoop')).toBe(true);
  });

  it('wisps keep their distance and cast homing fire', () => {
    const t = target(600);
    let fired = false;
    const combat = new CombatWorld(flat, 5);
    const m = createMonster(1, requireMonsterDef('wisp'), 760, FLOOR_Y - 60, 3);
    combat.add(m);
    combat.add(t);
    const events: MonsterEvent[] = [];
    const rng = new Rng(2);
    for (let i = 0; i < 360; i++) {
      stepBrain(m, { grid: flat, combat, target: t, now: i * SIM_DT, dt: SIM_DT, rng, events });
      if (combat.projectiles.some((p) => p.def.id === 'wisp_fire')) fired = true;
      combat.step(SIM_DT, i * SIM_DT);
    }
    expect(fired).toBe(true);
    expect(events.some((e) => e.type === 'telegraph' && e.kind === 'cast')).toBe(true);
    expect(Math.abs(m.motor.x - 600)).toBeGreaterThan(60);
  });

  it('the golem roars in, uses telegraphed patterns and enrages below half HP', () => {
    const t = target(500);
    const run = simulate('corestone_golem', 640, FLOOR_Y, t, 9);
    const kinds = run.events
      .filter((e) => e.type === 'telegraph')
      .map((e) => (e.type === 'telegraph' ? e.kind : ''));
    expect(kinds.length).toBeGreaterThan(1);
    const spawned = new Set<string>();
    // Count projectiles/windows the golem produced by re-running with inspection.
    const combat = new CombatWorld(flat, 5);
    const m = createMonster(1, requireMonsterDef('corestone_golem'), 640, FLOOR_Y, 7);
    combat.add(m);
    combat.add(t);
    const events: MonsterEvent[] = [];
    const rng = new Rng(4);
    for (let i = 0; i < 1200; i++) {
      const input = stepBrain(m, {
        grid: flat,
        combat,
        target: t,
        now: i * SIM_DT,
        dt: SIM_DT,
        rng,
        events,
      });
      if (input) stepMotor(m.motor, input, flat, m.movement, SIM_DT);
      for (const p of combat.projectiles) spawned.add(p.def.id);
      combat.step(SIM_DT, i * SIM_DT);
      if (i === 600) m.hp = m.stats.maxHp * 0.4;
    }
    expect(spawned.size).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'phase' && e.phase === 1)).toBe(true);
    expect(m.brain.phase).toBe(1);
  });

  it('computes ballistic arcs that land on target', () => {
    const v = 460;
    const g = 900;
    const ang = ballisticAngle(200, 40, v, g);
    expect(ang).not.toBeNull();
    let x = 0;
    let y = 0;
    const vx = Math.cos(ang ?? 0) * v;
    let vy = Math.sin(ang ?? 0) * v;
    let best = Infinity;
    for (let i = 0; i < 400; i++) {
      vy += g * 0.002;
      x += vx * 0.002;
      y += vy * 0.002;
      best = Math.min(best, Math.hypot(x - 200, y - 40));
    }
    expect(best).toBeLessThan(4);
    expect(ballisticAngle(5000, 0, v, g)).toBeNull();
  });
});

describe('spawning and the monster manager', () => {
  const world = new World(
    new OverworldGenerator({ seed: seedFromString('PROJECT-WORLD'), ...DEFAULT_OVERWORLD }),
  );
  const sx = world.generator.spawnTileX;

  it('classifies spawn zones by depth', () => {
    const surf = world.surfaceY(sx + 60);
    expect(zoneAt(world, sx + 60, surf - 2)).toBe('surface');
    expect(zoneAt(world, sx + 60, surf + 2)).toBeNull();
  });

  it('never spawns inside the safe zone and picks valid monsters', () => {
    const rng = new Rng(9);
    let found = 0;
    for (let i = 0; i < 300; i++) {
      const pick = pickSpawn({
        world,
        night: false,
        x: (sx + 10) * 16,
        y: world.surfaceY(sx + 10) * 16,
        safeFrom: sx - 34,
        safeTo: sx + 34,
        rng,
        torchTile: TILE.torch,
      });
      if (!pick) continue;
      found++;
      const tx = Math.floor(pick.x / 16);
      expect(tx < sx - 34 || tx > sx + 34).toBe(true);
      expect(pick.def.spawn?.time).not.toBe('night');
    }
    expect(found).toBeGreaterThan(10);
  });

  it('rolls loot within the configured ranges', () => {
    const rng = new Rng(1);
    const def = requireMonsterDef('corestone_golem');
    const loot = rollLoot(def.drops, rng);
    const core = loot.find((l) => l.itemId === 'corestone');
    expect(core && core.count >= 3 && core.count <= 5).toBe(true);
  });

  it('reports deaths, removes corpses and despawns far monsters', () => {
    const combat = new CombatWorld(world, 2);
    const mgr = new MonsterManager(world, combat, 3);
    const px = (sx + 50) * 16;
    const py = world.surfaceY(sx + 50) * 16;
    const player = target(px, py);
    combat.add(player);
    const m = mgr.spawn('dew_slime', px + 40, py - 20);
    const far = mgr.spawn('dew_slime', px + 100 * 16, world.surfaceY(sx + 150) * 16 - 20);
    combat.kill(m, player.id);
    const settings = { safeFrom: 0, safeTo: 0, night: false, enabled: false };
    let now = 0;
    for (let i = 0; i < 60; i++, now += SIM_DT) mgr.step(SIM_DT, now, [player], settings);
    expect(mgr.deaths).toContain(m);
    for (let i = 0; i < 480; i++, now += SIM_DT) mgr.step(SIM_DT, now, [player], settings);
    expect(mgr.monsters.includes(m)).toBe(false);
    expect(mgr.monsters.includes(far)).toBe(false);
    expect(combat.combatants.has(m.id)).toBe(false);
  });
});
