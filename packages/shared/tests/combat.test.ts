import { describe, expect, it } from 'vitest';
import {
  ActorCombat,
  type ActorContext,
  allocateStat,
  autoAllocate,
  checkAdvance,
  checkLearn,
  COLLISION_NONE,
  COLLISION_SOLID,
  type CollisionGrid,
  type CombatIntent,
  CombatWorld,
  type Combatant,
  computeCombatStats,
  createMotorState,
  createStartingProgress,
  DEFAULT_MOVEMENT,
  DODGE_COOLDOWN,
  Equipment,
  expForKill,
  getJobDef,
  IDLE_COMBAT_INTENT,
  Inventory,
  itemRegistry,
  learnSkill,
  levelFactor,
  mitigation,
  monsterCombatStats,
  passiveMods,
  rollDamage,
  sanitizeSkillBook,
  SIM_DT,
  StatusSet,
  stepMotor,
  type WeaponStats,
} from '../src';

const FLOOR_ROW = 20;
const flat: CollisionGrid = {
  collisionAt: (_tx: number, ty: number) => (ty >= FLOOR_ROW ? COLLISION_SOLID : COLLISION_NONE),
};
const FLOOR_Y = FLOOR_ROW * 16;

function weapon(id: string): WeaponStats {
  const w = itemRegistry.get(id)?.weapon;
  if (!w) throw new Error(id);
  return w;
}

function makePlayer(id: number, x: number, weaponId: string | null = 'training_sword'): Combatant {
  const motor = createMotorState(x, FLOOR_Y, DEFAULT_MOVEMENT);
  motor.grounded = true;
  const progress = createStartingProgress();
  const stats = computeCombatStats({
    progress,
    job: getJobDef('novice'),
    weapon: weaponId ? weapon(weaponId) : null,
    gear: [],
    mods: {},
  });
  return {
    id,
    team: 'player',
    kind: 'player',
    body: motor,
    hp: stats.maxHp,
    mp: stats.maxMp,
    alive: true,
    level: 1,
    stats,
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

function makeDummy(id: number, x: number, hp = 10000, y = FLOOR_Y): Combatant {
  const motor = createMotorState(x, y, { ...DEFAULT_MOVEMENT, bodyWidth: 16, bodyHeight: 16 });
  motor.grounded = true;
  return {
    id,
    team: 'monster',
    kind: 'monster',
    body: motor,
    hp,
    mp: 0,
    alive: true,
    level: 1,
    stats: monsterCombatStats({ hp, attack: 10, defense: 0 }),
    statuses: new StatusSet(),
    invulnUntil: 0,
    perfectUntil: 0,
    staggerUntil: 0,
    knockbackResist: 0,
    hurtIframes: 0,
    immune: new Set(),
    vulnerable: 1,
    lastHitAt: -10,
    facing: -1,
  };
}

/** Run an actor for `seconds` with an intent function; returns damage events seen. */
function run(
  ac: ActorCombat,
  combat: CombatWorld,
  self: Combatant,
  seconds: number,
  intentAt: (t: number) => Partial<CombatIntent>,
  extra: Partial<ActorContext> = {},
  t0 = 0,
) {
  let now = t0;
  const damages: number[] = [];
  const ticks = Math.round(seconds / SIM_DT);
  for (let i = 0; i < ticks; i++) {
    const intent: CombatIntent = {
      ...IDLE_COMBAT_INTENT,
      aimX: self.body.x + 100,
      aimY: self.body.y - 22,
      ...intentAt(now),
    };
    const o = ac.update(
      {
        self,
        combat,
        grid: flat,
        weapon: self.stats.attackSpeed ? weapon('training_sword') : null,
        canAttack: true,
        skillLevel: () => 0,
        now,
        dt: SIM_DT,
        ...extra,
      },
      intent,
    );
    const motor = self.body as ReturnType<typeof createMotorState>;
    if (o.vx !== null) motor.vx = o.vx;
    if (o.vy !== null) motor.vy = o.vy;
    stepMotor(
      motor,
      {
        moveX: o.vx !== null ? Math.sign(o.vx) : 0,
        jumpHeld: false,
        jumpPressed: false,
        down: false,
        speedMul: o.vx !== null ? Math.abs(o.vx) / DEFAULT_MOVEMENT.runSpeed : o.moveMul,
        gravityMul: o.gravityMul,
      },
      flat,
      DEFAULT_MOVEMENT,
      SIM_DT,
    );
    combat.step(SIM_DT, now);
    for (const e of combat.events) if (e.type === 'damage') damages.push(e.amount);
    combat.events.length = 0;
    now += SIM_DT;
  }
  return { damages, now };
}

describe('damage formula', () => {
  it('mitigates by defense, never below 1, and penalizes fighting higher levels', () => {
    expect(mitigation(0)).toBe(1);
    expect(mitigation(100)).toBeCloseTo(0.5);
    expect(levelFactor(5, 3)).toBe(1);
    expect(levelFactor(1, 6)).toBeCloseTo(0.8);
    expect(levelFactor(1, 40)).toBe(0.4);
    const r = rollDamage(
      {
        power: 0.1,
        multiplier: 1,
        attackerLevel: 1,
        targetLevel: 1,
        targetDefense: 500,
        targetDamageTaken: 1,
        critRate: 0,
        critDamage: 0.5,
      },
      () => 0.5,
    );
    expect(r.amount).toBe(1);
  });

  it('crits multiply by 1 + critDamage', () => {
    const base = {
      power: 100,
      multiplier: 1,
      attackerLevel: 1,
      targetLevel: 1,
      targetDefense: 0,
      targetDamageTaken: 1,
      critDamage: 0.5,
    };
    const normal = rollDamage({ ...base, critRate: 0 }, () => 0.5);
    const crit = rollDamage({ ...base, critRate: 1 }, () => 0.5);
    expect(crit.crit).toBe(true);
    expect(crit.amount).toBe(Math.round(normal.amount * 1.5));
  });

  it('reduces experience for out-leveled monsters', () => {
    expect(expForKill(10, 3, 1)).toBe(10);
    expect(expForKill(10, 10, 1)).toBe(6);
    expect(expForKill(10, 99, 1)).toBe(1);
  });
});

describe('combat stats', () => {
  const progress = { level: 10, stats: { str: 40, dex: 10, int: 5, vit: 5, luk: 5 } };
  it('scales physical weapons by their stat pair and staves by INT', () => {
    const sword = computeCombatStats({
      progress,
      job: getJobDef('warrior'),
      weapon: weapon('copper_sword'),
      gear: [],
      mods: {},
    });
    expect(sword.attack).toBeCloseTo(18 * (1 + (40 * 4 + 10) / 100));
    const staff = computeCombatStats({
      progress,
      job: getJobDef('warrior'),
      weapon: weapon('oak_staff'),
      gear: [],
      mods: {},
    });
    expect(staff.magic).toBeGreaterThan(staff.attack * 0.5);
    expect(staff.magic).toBeCloseTo(11 * (1 + (5 * 4 + 5) / 100));
  });

  it('applies gear, job HP multiplier and percentage mods', () => {
    const plain = computeCombatStats({
      progress,
      job: getJobDef('novice'),
      weapon: null,
      gear: [],
      mods: {},
    });
    const warrior = computeCombatStats({
      progress,
      job: getJobDef('warrior'),
      weapon: null,
      gear: [],
      mods: {},
    });
    expect(warrior.maxHp).toBeGreaterThan(plain.maxHp);
    const geared = computeCombatStats({
      progress,
      job: getJobDef('novice'),
      weapon: null,
      gear: [{ defense: 10, maxHp: 50, str: 5 }],
      mods: { attackPct: 0.2, moveSpeedPct: 0.1 },
    });
    expect(geared.defense).toBeCloseTo(plain.defense + 10);
    expect(geared.totals.str).toBe(45);
    expect(geared.moveSpeed).toBeCloseTo(1.1);
    expect(geared.attack).toBeGreaterThan(plain.attack * 1.2);
  });
});

describe('status effects', () => {
  it('ticks damage over time, expires, and reports stun', () => {
    const s = new StatusSet();
    expect(s.apply('poison', 0, 3, { power: 50 })).toBe(true);
    expect(s.apply('nope', 0, 3)).toBe(false);
    expect(s.apply('stun', 0, 1, { immune: new Set(['stun']) })).toBe(false);
    const ticks = [...s.step(1, 100), ...s.step(2, 100), ...s.step(3, 100), ...s.step(4, 100)];
    expect(ticks.length).toBe(3);
    expect(ticks[0]?.amount).toBe(10);
    expect(s.has('poison', 4)).toBe(false);
    s.apply('freeze', 4, 1);
    expect(s.stunned(4.5)).toBe(true);
    expect(s.stunned(5.5)).toBe(false);
  });

  it('scales buff modifiers by magnitude and caps durations', () => {
    const s = new StatusSet();
    s.apply('rage', 0, 999, { magnitude: 20 });
    expect(s.mods(1).attackPct).toBeCloseTo(0.2);
    expect(s.has('rage', 119)).toBe(true);
    expect(s.has('rage', 121)).toBe(false);
  });
});

describe('CombatWorld', () => {
  it('hits each target once per window, respects maxTargets and kills', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    const a = makeDummy(2, 120, 5);
    const b = makeDummy(3, 125, 10000);
    combat.add(p);
    combat.add(a);
    combat.add(b);
    combat.openWindow(
      { owner: p, power: 100, multiplier: 1, tag: 't' },
      { type: 'arc', radius: 40, halfAngle: 1.2 },
      { damage: 1, knockback: 100 },
      { until: 1, aim: 0, facing: 1, maxTargets: 2 },
    );
    for (let i = 0; i < 10; i++) combat.step(SIM_DT, i * SIM_DT);
    const dmg = combat.events.filter((e) => e.type === 'damage');
    expect(dmg.length).toBe(2);
    expect(a.alive).toBe(false);
    expect(combat.events.some((e) => e.type === 'death' && e.targetId === 2)).toBe(true);
    expect(b.body.vx).toBeGreaterThan(0);
  });

  it('re-hits on interval windows', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    const d = makeDummy(2, 110);
    combat.add(p);
    combat.add(d);
    combat.openWindow(
      { owner: p, power: 10, multiplier: 1, tag: 't' },
      { type: 'circle', radius: 40 },
      { damage: 1, knockback: 0 },
      { until: 0.6, interval: 0.2, aim: 0, facing: 1 },
    );
    for (let i = 0; i <= 36; i++) combat.step(SIM_DT, i * SIM_DT);
    expect(combat.events.filter((e) => e.type === 'damage').length).toBe(4);
  });

  it('i-frames block hits; a hit inside the perfect window grants perfect focus', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    const m = makeDummy(2, 110);
    combat.add(p);
    combat.add(m);
    p.invulnUntil = 1;
    p.perfectUntil = 0.1;
    const atk = { owner: m, power: 50, multiplier: 1, tag: 'x' };
    expect(combat.applyHit(atk, p, { damage: 1, knockback: 0 }, -1, 'contact', 0.05)).toBe(false);
    expect(combat.events.some((e) => e.type === 'dodge' && e.perfect)).toBe(true);
    expect(p.statuses.has('perfect_focus', 0.5)).toBe(true);
    expect(combat.applyHit(atk, p, { damage: 1, knockback: 0 }, -1, 'contact', 0.5)).toBe(false);
    expect(
      combat.applyHit(atk, p, { damage: 1, knockback: 150, lift: 100 }, -1, 'contact', 1.5),
    ).toBe(true);
    expect(p.invulnUntil).toBeCloseTo(2.2);
    expect(p.body.vx).toBeLessThan(0);
  });

  it('projectiles fly, stop at walls, pierce and explode', () => {
    const wall: CollisionGrid = {
      collisionAt: (tx: number, ty: number) =>
        ty >= FLOOR_ROW || tx === 30 ? COLLISION_SOLID : COLLISION_NONE,
    };
    const combat = new CombatWorld(wall, 3);
    const p = makePlayer(1, 100);
    const d1 = makeDummy(2, 200);
    const d2 = makeDummy(3, 260);
    combat.add(p);
    combat.add(d1);
    combat.add(d2);
    const atk = { owner: p, power: 20, multiplier: 1, tag: 'a' };
    combat.spawnProjectile(atk, 'arrow_pierce', 110, FLOOR_Y - 8, 0, { damage: 1, knockback: 0 });
    for (let i = 0; i < 60; i++) combat.step(SIM_DT, i * SIM_DT);
    const hits = combat.events
      .filter((e) => e.type === 'damage')
      .map((e) => (e.type === 'damage' ? e.targetId : 0));
    expect(hits).toEqual([2, 3]);
    expect(combat.events.some((e) => e.type === 'projectileEnd' && e.hitTile)).toBe(true);
    expect(combat.projectiles.length).toBe(0);

    combat.events.length = 0;
    const d3 = makeDummy(4, 400);
    const d4 = makeDummy(5, 420);
    combat.add(d3);
    combat.add(d4);
    combat.remove(2);
    combat.remove(3);
    combat.spawnProjectile(atk, 'fireball', 340, FLOOR_Y - 8, 0, { damage: 1, knockback: 0 });
    for (let i = 0; i < 60; i++) combat.step(SIM_DT, 1 + i * SIM_DT);
    expect(combat.events.some((e) => e.type === 'explode')).toBe(true);
    const ids = new Set(
      combat.events
        .filter((e) => e.type === 'damage')
        .map((e) => (e.type === 'damage' ? e.targetId : 0)),
    );
    expect(ids.has(4) && ids.has(5)).toBe(true);
  });

  it('zones tick on their interval after a delay', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    const d = makeDummy(2, 300);
    combat.add(p);
    combat.add(d);
    combat.spawnZone(
      { owner: p, power: 10, multiplier: 1, tag: 'z' },
      300,
      FLOOR_Y - 10,
      {
        kind: 'zone',
        at: 0,
        where: 'aim',
        radius: 40,
        duration: 1,
        interval: 0.25,
        delay: 0.5,
        visual: 'v',
        damage: 1,
        knockback: 0,
      },
      0,
    );
    for (let i = 0; i < 30; i++) combat.step(SIM_DT, i * SIM_DT);
    expect(combat.events.filter((e) => e.type === 'damage').length).toBe(0);
    for (let i = 30; i < 120; i++) combat.step(SIM_DT, i * SIM_DT);
    expect(combat.events.filter((e) => e.type === 'damage').length).toBe(5);
  });
});

describe('ActorCombat', () => {
  it('chains a three-hit sword combo while the button is held, then restarts', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    combat.add(p);
    combat.add(makeDummy(2, 125));
    const ac = new ActorCombat();
    const ids: string[] = [];
    let now = 0;
    for (let i = 0; i < 160; i++) {
      run(ac, combat, p, SIM_DT, () => ({ attackHeld: true }), {}, now);
      now += SIM_DT;
      for (const e of ac.events) if (e.type === 'action') ids.push(e.action.id);
      ac.events.length = 0;
    }
    expect(ids.slice(0, 4)).toEqual(['sword_1', 'sword_2', 'sword_3', 'sword_1']);
  });

  it('uses the air attack in the air and plunges when aiming down', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    p.body.y = FLOOR_Y - 120;
    p.body.grounded = false;
    combat.add(p);
    const ac = new ActorCombat();
    run(ac, combat, p, SIM_DT, () => ({ attackPressed: true }));
    expect(ac.action?.def.id).toBe('sword_air');
    const p2 = makePlayer(3, 300);
    p2.body.y = FLOOR_Y - 160;
    p2.body.grounded = false;
    const target = makeDummy(4, 300, 10000, FLOOR_Y);
    combat.add(p2);
    combat.add(target);
    const ac2 = new ActorCombat();
    const res = run(ac2, combat, p2, 0.6, (t) => ({
      attackPressed: t < SIM_DT,
      aimX: 300,
      aimY: FLOOR_Y + 50,
    }));
    expect(res.damages.length).toBeGreaterThan(0);
    expect(p2.body.vy).toBeLessThan(400);
  });

  it('charges bows on hold and fires a charged arrow on release', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100, 'oak_bow');
    combat.add(p);
    const ac = new ActorCombat();
    const ctx = { weapon: weapon('oak_bow') };
    run(ac, combat, p, 0.7, () => ({ attackHeld: true }), ctx);
    expect(ac.events.some((e) => e.type === 'charge')).toBe(true);
    run(ac, combat, p, 0.1, () => ({ attackHeld: false }), ctx, 0.7);
    expect(combat.projectiles.some((pr) => pr.def.id === 'arrow_charged')).toBe(true);
  });

  it('validates skills: learned, weapon, MP, cooldown; spends MP and starts the cooldown', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100, 'copper_sword');
    combat.add(p);
    const ac = new ActorCombat();
    const levels: Record<string, number> = { warrior_power_strike: 1 };
    const base: Partial<ActorContext> = {
      weapon: weapon('copper_sword'),
      skillLevel: (id: string) => levels[id] ?? 0,
    };
    const ctx = (now: number): ActorContext => ({
      self: p,
      combat,
      grid: flat,
      weapon: weapon('copper_sword'),
      canAttack: true,
      skillLevel: (id: string) => levels[id] ?? 0,
      now,
      dt: SIM_DT,
    });
    expect(ac.checkCast(ctx(0), 'warrior_rage')).toBe('not_learned');
    expect(ac.checkCast({ ...ctx(0), weapon: weapon('oak_bow') }, 'warrior_power_strike')).toBe(
      'wrong_weapon',
    );
    p.mp = 1;
    expect(ac.checkCast(ctx(0), 'warrior_power_strike')).toBe('no_mp');
    p.mp = 50;
    run(ac, combat, p, SIM_DT, () => ({ skill: 'warrior_power_strike' }), base);
    expect(p.mp).toBe(42);
    expect(ac.action?.def.id).toBe('warrior_power_strike');
    expect(ac.cooldownLeft('warrior_power_strike', 0.1)).toBeGreaterThan(0);
  });

  it('buff skills apply their status with scaled magnitude', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    combat.add(p);
    const ac = new ActorCombat();
    run(ac, combat, p, 0.5, (t) => ({ skill: t < SIM_DT ? 'warrior_rage' : null }), {
      skillLevel: (id: string) => (id === 'warrior_rage' ? 3 : 0),
    });
    expect(p.statuses.get('rage')?.magnitude).toBeCloseTo(14);
  });

  it('dodges with i-frames, a cooldown and one air dodge per jump', () => {
    const combat = new CombatWorld(flat, 3);
    const p = makePlayer(1, 100);
    combat.add(p);
    const ac = new ActorCombat();
    const x0 = p.body.x;
    run(ac, combat, p, 0.3, (t) => ({ dodge: t < SIM_DT, moveX: 1 }));
    expect(p.body.x - x0).toBeGreaterThan(80);
    expect(p.invulnUntil).toBeGreaterThan(0.2);
    expect(ac.dodgeCooldownUntil).toBeCloseTo(DODGE_COOLDOWN, 1);
    // air dodge once
    p.body.grounded = false;
    p.body.y = FLOOR_Y - 200;
    const r1 = run(ac, combat, p, 0.05, (t) => ({ dodge: t < 0.62 }), {}, 0.6);
    expect(ac.airDodgeUsed).toBe(true);
    const before = ac.dodgeCooldownUntil;
    run(ac, combat, p, 0.05, () => ({ dodge: true }), {}, r1.now + 0.7);
    expect(ac.dodgeCooldownUntil).toBe(before);
  });
});

describe('progression', () => {
  it('allocates stat points and auto-allocates 4:1', () => {
    const p = { ...createStartingProgress(), statPoints: 10 };
    const r = allocateStat(p, 'str', 3);
    expect(r.ok && r.progress.stats.str).toBe(8);
    expect(allocateStat(p, 'str', 11).ok).toBe(false);
    const auto = autoAllocate({ ...createStartingProgress(), statPoints: 25 }, getJobDef('mage'));
    expect(auto.statPoints).toBe(0);
    expect(auto.stats.int + auto.stats.luk).toBe(10 + 25);
    expect(auto.stats.int).toBeGreaterThan(auto.stats.luk * 2);
  });

  it('checks job advancement and skill learning rules', () => {
    expect(checkAdvance('novice', 'warrior', 9)).toBe('level');
    expect(checkAdvance('novice', 'warrior', 10)).toBeNull();
    expect(checkAdvance('warrior', 'mage', 30)).toBe('not_next');
    const prog = { ...createStartingProgress(), level: 11, skillPoints: 2 };
    expect(checkLearn({}, 'warrior_power_strike', 'novice', prog)).toBe('wrong_job');
    expect(checkLearn({}, 'warrior_whirlwind', 'warrior', prog)).toBe('prereq');
    expect(checkLearn({}, 'novice_pebble', 'warrior', prog)).toBeNull();
    const r = learnSkill({}, 'warrior_power_strike', 'warrior', prog);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.book.warrior_power_strike).toBe(1);
    expect(r.progress.skillPoints).toBe(1);
    expect(checkLearn({}, 'warrior_power_strike', 'warrior', { level: 11, skillPoints: 0 })).toBe(
      'no_points',
    );
    expect(passiveMods({ warrior_iron_body: 5 }, 'warrior').maxHpPct).toBeCloseTo(0.1);
    expect(
      sanitizeSkillBook({ warrior_power_strike: 99, bogus: 3, mage_fireball: 2 }, 'warrior'),
    ).toEqual({ warrior_power_strike: 10 });
  });
});

describe('Equipment', () => {
  it('equips from the inventory with swaps, checks level and slot, sums bonuses', () => {
    const inv = new Inventory();
    const eq = new Equipment();
    inv.add('copper_helmet', 1);
    inv.add('traveler_hood', 1);
    inv.add('thorn_charm', 1);
    inv.add('bat_brooch', 1);
    expect(eq.equipFrom(inv, 0, 1)).toBe('level');
    expect(eq.equipFrom(inv, 1, 1)).toBeNull();
    expect(eq.get('head')?.itemId).toBe('traveler_hood');
    expect(eq.equipFrom(inv, 0, 5)).toBeNull();
    expect(eq.get('head')?.itemId).toBe('copper_helmet');
    expect(inv.get(0)?.itemId).toBe('traveler_hood');
    expect(eq.equipFrom(inv, 2, 10)).toBeNull();
    expect(eq.equipFrom(inv, 3, 10)).toBeNull();
    expect(eq.get('acc1')?.itemId).toBe('thorn_charm');
    expect(eq.get('acc2')?.itemId).toBe('bat_brooch');
    expect(eq.check('copper_helmet', 'body', 99)).toBe('wrong_slot');
    expect(eq.check('dirt', 'head', 99)).toBe('not_equipment');
    const def = eq.bonuses().reduce((s, b) => s + (b.defense ?? 0), 0);
    expect(def).toBe(5);
    expect(eq.unequip(inv, 'head')).toBeNull();
    expect(inv.count('copper_helmet')).toBe(1);
  });

  it('supports cursor clicks and sanitizes loaded data', () => {
    const inv = new Inventory();
    const eq = new Equipment();
    inv.add('traveler_coat', 1);
    inv.click(0, 'left');
    expect(eq.click(inv, 'head', 1)).toBe('wrong_slot');
    expect(eq.click(inv, 'body', 1)).toBeNull();
    expect(inv.cursor).toBeNull();
    expect(eq.click(inv, 'body', 1)).toBeNull();
    expect(inv.cursor?.itemId).toBe('traveler_coat');
    eq.load({
      head: { itemId: 'traveler_coat', count: 1 },
      body: { itemId: 'iron_armor', count: 3 },
    });
    expect(eq.get('head')).toBeNull();
    expect(eq.get('body')).toEqual({ itemId: 'iron_armor', count: 1 });
  });
});
