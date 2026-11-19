/**
 * The parts of a player's character only that player sees (inventory, progression, cooldowns,
 * buffs). The server captures them; the online client applies them to its local mirror of the
 * character. Both sides use these two functions so the formats cannot drift apart.
 */
import type { Character, CharacterSnapshot } from '../actors/Character';
import type { ItemStack } from '../sandbox/Inventory';
import type { HitProgress } from '../sandbox/interaction';

/**
 * Changes rarely: inventory, equipment, stats, skills (sent when it changes). HP and MP travel
 * with the vitals instead, so regeneration does not resend the whole inventory.
 */
export interface PrivateFull {
  readonly snap: CharacterSnapshot;
  readonly cursor: ItemStack | null;
}

/** Changes constantly: sent with every snapshot. */
export interface Vitals {
  readonly hp: number;
  readonly mp: number;
  readonly exp: number;
  readonly level: number;
  readonly gold: number;
  readonly alive: boolean;
  readonly respawnAt: number;
  readonly potionCd: number;
  readonly dodgeCd: number;
  readonly dodgeUntil: number;
  /** NaN when not charging (sent as -1). */
  readonly chargeStart: number;
  readonly invulnUntil: number;
  readonly lastHitAt: number;
  readonly staggerUntil: number;
  readonly cooldowns: readonly (readonly [string, number])[];
  /** [id, magnitude, until, duration] */
  readonly statuses: readonly (readonly [string, number, number, number])[];
  /** Mining/chopping progress on the current target (crack overlay). */
  readonly hit: HitProgress | null;
}

export function capturePrivate(c: Character): PrivateFull {
  const cur = c.inventory.cursor;
  return {
    snap: { ...c.exportSnapshot(), hp: 0, mp: 0 },
    cursor: cur ? { itemId: cur.itemId, count: cur.count } : null,
  };
}

export function captureVitals(c: Character): Vitals {
  const ac = c.combat;
  return {
    hp: Math.round(c.hp * 10) / 10,
    mp: Math.round(c.mp * 10) / 10,
    exp: c.progress.exp,
    level: c.level,
    gold: c.gold,
    alive: c.alive,
    respawnAt: c.respawnAt,
    potionCd: c.potionCooldownUntil,
    dodgeCd: ac.dodgeCooldownUntil,
    dodgeUntil: ac.dodgeUntil,
    chargeStart: Number.isNaN(ac.chargeStart) ? -1 : ac.chargeStart,
    invulnUntil: c.invulnUntil,
    lastHitAt: c.lastHitAt,
    staggerUntil: c.staggerUntil,
    cooldowns: [...ac.cooldowns.entries()],
    statuses: c.statuses.all.map((s) => [s.def.id, s.magnitude, s.until, s.duration] as const),
    hit: c.hit ? { key: c.hit.key, damage: c.hit.damage, lastHit: c.hit.lastHit } : null,
  };
}

/** Client: overwrite the local mirror's private state from the server's. */
export function applyPrivate(c: Character, p: PrivateFull): void {
  c.importSnapshot(p.snap);
  c.inventory.swapCursor(p.cursor ? { itemId: p.cursor.itemId, count: p.cursor.count } : null);
}

/** Client: overwrite the local mirror's vitals from the server's. */
export function applyVitals(c: Character, v: Vitals, now: number): void {
  if (v.level !== c.level || v.exp !== c.progress.exp) {
    c.progress = { ...c.progress, level: v.level, exp: v.exp };
    c.level = v.level;
    c.version++;
  }
  c.gold = v.gold;
  c.alive = v.alive;
  c.respawnAt = v.respawnAt;
  c.potionCooldownUntil = v.potionCd;
  const ac = c.combat;
  ac.dodgeCooldownUntil = v.dodgeCd;
  ac.dodgeUntil = v.dodgeUntil;
  ac.chargeStart = v.chargeStart < 0 ? Number.NaN : v.chargeStart;
  c.invulnUntil = v.invulnUntil;
  c.lastHitAt = v.lastHitAt;
  c.staggerUntil = v.staggerUntil;
  ac.cooldowns.clear();
  for (const [id, until] of v.cooldowns) ac.cooldowns.set(id, until);
  c.statuses.clear();
  for (const [id, magnitude, until, duration] of v.statuses) {
    if (until <= now) continue;
    c.statuses.apply(id, until - duration, duration, { magnitude });
  }
  c.hit = v.hit ? { key: v.hit.key, damage: v.hit.damage, lastHit: v.hit.lastHit } : null;
  c.refreshStats(now);
  c.hp = v.hp;
  c.mp = v.mp;
}
