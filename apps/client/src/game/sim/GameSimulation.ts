import type { ClientSim } from './ClientSim';
import {
  type ActionIntent,
  type Character,
  type ActorEvent,
  type AdventurerDirector,
  type BrainEvent,
  type CombatEvent,
  type CombatWorld,
  type CraftResult,
  type DropEntity,
  type Drop,
  type DropSystem,
  type Economy,
  type EquipFail,
  type EquipSlotId,
  expToNextLevel,
  type HeldMode,
  IDLE_ACTION,
  type LearnFail,
  type MonsterEvent,
  type MonsterManager,
  type MotorInput,
  type MovementConfig,
  type NewsItem,
  type Player,
  type PlayerPickup,
  type PlayerSave,
  type PlayerSlot,
  type SaleRecord,
  type SaveBundle,
  type SimNotice,
  type Society,
  type SocialEvent,
  type SpokenLine,
  type StatKey,
  type TownServices,
  type UseAction,
  type UseFailReason,
  type UseIntent,
  type UseOutcome,
  type World,
  type WorldClock,
  type WorldMeta,
  WorldSim,
  type WorldSocietySave,
} from '@world/shared';

export {
  RESPAWN_DELAY,
  DEATH_EXP_PENALTY,
  SAFE_RADIUS,
  WARM_UP_MINUTES,
  SKILL_BAR_SIZE,
  monsterOwner,
} from '@world/shared';
export { IDLE_ACTION };
export type { ActionIntent, DropEntity, UseIntent, SimNotice, Player };
export type PickupEvent = PlayerPickup;
export type { ConsumeFail } from '@world/shared';

/** Things that happened since the renderer last consumed events (local-player view). */
export interface SimEvents {
  uses: UseOutcome[];
  pickups: PickupEvent[];
  failed: UseFailReason | null;
  combat: CombatEvent[];
  monster: MonsterEvent[];
  actor: ActorEvent[];
  levelUps: number[];
  exp: { amount: number; x: number; y: number }[];
  notices: SimNotice[];
  /** Other characters' (adventurers') actions/uses/level-ups for the renderer. */
  aiActor: { id: number; event: ActorEvent }[];
  aiUses: { id: number; out: UseOutcome }[];
  aiLevelUps: { id: number; level: number }[];
  ai: BrainEvent[];
  /** Conversation lines spoken by active adventurers. */
  spoken: SpokenLine[];
  /** World news since last read. */
  news: NewsItem[];
  /** Adventurers asking the player to team up. */
  invites: { from: string; purpose: string }[];
  /** The player's market listings that sold. */
  sales: SaleRecord[];
  /** Social outcomes (party/guild changes, trades). */
  social: SocialEvent[];
  /** Other players' actions, uses and level-ups (online play). */
  peerActor: { id: number; event: ActorEvent }[];
  peerUses: { id: number; out: UseOutcome }[];
  peerLevelUps: { id: number; level: number }[];
}

export function newSimEvents(): SimEvents {
  return {
    uses: [],
    pickups: [],
    failed: null,
    combat: [],
    monster: [],
    actor: [],
    levelUps: [],
    exp: [],
    notices: [],
    aiActor: [],
    aiUses: [],
    aiLevelUps: [],
    ai: [],
    spoken: [],
    news: [],
    invites: [],
    sales: [],
    social: [],
    peerActor: [],
    peerUses: [],
    peerLevelUps: [],
  };
}

export interface SimulationOptions {
  seed: number;
  worldId: string;
  playerName: string;
  startHour?: number;
  dayLengthSeconds?: number;
  save?: SaveBundle;
  /** Natural monster spawning (default true). */
  monsters?: boolean;
  /** Number of AI adventurers (default 30, 0 disables them). */
  adventurers?: number;
  /** Simulate some adventurer life before a new world starts (default true). */
  warmUp?: boolean;
}

/** Key of the offline local player. */
export const LOCAL_PLAYER = 'player';
const NO_OFFSET = { x: 0, y: 0 } as const;

/**
 * Offline (single-player) simulation: the shared WorldSim with one local player, plus the
 * single-player command API and event view the renderer and UI use. Online play runs the same
 * WorldSim on the server instead.
 */
export class GameSimulation implements ClientSim {
  readonly core: WorldSim;
  readonly local: PlayerSlot;
  readonly events: SimEvents = newSimEvents();
  readonly online = false;
  readonly selfKey = LOCAL_PLAYER;

  constructor(options: SimulationOptions) {
    this.core = new WorldSim({
      seed: options.seed,
      worldId: options.worldId,
      startHour: options.startHour,
      dayLengthSeconds: options.dayLengthSeconds,
      save: options.save,
      monsters: options.monsters,
      adventurers: options.adventurers,
      warmUp: options.warmUp,
    });
    this.local = this.core.addPlayer(
      LOCAL_PLAYER,
      options.playerName,
      options.save?.player ?? null,
    );
    this.local.admin = true;
  }

  // --- World access (read by renderers and UI) ---------------------------------------------

  get world(): World {
    return this.core.world;
  }
  get clock(): WorldClock {
    return this.core.clock;
  }
  get movement(): MovementConfig {
    return this.core.movement;
  }
  get worldId(): string {
    return this.core.worldId;
  }
  get combat(): CombatWorld {
    return this.core.combat;
  }
  get monsters(): MonsterManager {
    return this.core.monsters;
  }
  get adventurers(): AdventurerDirector {
    return this.core.adventurers;
  }
  get dropSystem(): DropSystem {
    return this.core.dropSystem;
  }
  get drops(): readonly DropEntity[] {
    return this.core.drops;
  }
  get economy(): Economy {
    return this.core.economy;
  }
  get society(): Society {
    return this.core.society;
  }
  get time(): number {
    return this.core.time;
  }
  get tickCount(): number {
    return this.core.tickCount;
  }
  get monstersEnabled(): boolean {
    return this.core.monstersEnabled;
  }
  set monstersEnabled(on: boolean) {
    this.core.monstersEnabled = on;
  }
  get player(): Player {
    return this.local.character;
  }
  get town(): TownServices {
    return this.local.town;
  }
  get explored(): Set<number> {
    return this.local.explored;
  }
  get playTime(): number {
    return this.local.playTime;
  }
  /** Offline there are no other players. */
  peers(): readonly Player[] {
    return [];
  }
  peerLook(): number {
    return 0;
  }
  characterByKey(key: string): Character | null {
    if (key === LOCAL_PLAYER) return this.player;
    return this.core.adventurers.byKey(key)?.character ?? null;
  }
  renderOffset(): { x: number; y: number } {
    return NO_OFFSET;
  }

  // --- Simulation ---------------------------------------------------------------------------

  /** Advance the world clock only (title screen). */
  tickAmbient(dt: number): void {
    this.core.tickAmbient(dt);
  }

  /** Advance one fixed step with the local player's movement, item-use and combat intents. */
  tick(
    dt: number,
    input: MotorInput,
    use: UseIntent | null = null,
    action: ActionIntent = IDLE_ACTION,
  ): void {
    this.local.intent = { move: input, use, action };
    this.core.tick(dt);
    this.collectEvents();
  }

  /** Sort world events into the local player's view. */
  private collectEvents(): void {
    const w = this.core.worldEvents;
    const e = this.events;
    const me = this.player.id;
    for (const u of w.uses) {
      if (u.id === me) e.uses.push(u.out);
      else e.aiUses.push(u);
    }
    for (const a of w.actor) {
      if (a.id === me) e.actor.push(a.event);
      else e.aiActor.push(a);
    }
    for (const l of w.levelUps) if (l.id !== me) e.aiLevelUps.push(l);
    for (const c of w.combat) e.combat.push(c);
    for (const m of w.monster) e.monster.push(m);
    for (const a of w.ai) e.ai.push(a);
    for (const s of w.spoken) e.spoken.push(s);
    for (const n of w.news) e.news.push(n);
    for (const s of w.social) e.social.push(s);
    w.uses.length = 0;
    w.actor.length = 0;
    w.levelUps.length = 0;
    w.combat.length = 0;
    w.monster.length = 0;
    w.ai.length = 0;
    w.spoken.length = 0;
    w.news.length = 0;
    w.social.length = 0;
    const p = this.local.events;
    for (const x of p.pickups) e.pickups.push(x);
    for (const x of p.exp) e.exp.push(x);
    for (const x of p.levelUps) e.levelUps.push(x);
    for (const x of p.notices) e.notices.push(x);
    for (const x of p.sales) e.sales.push(x);
    for (const x of p.invites) e.invites.push(x);
    if (p.failed) e.failed = p.failed;
    p.pickups.length = 0;
    p.exp.length = 0;
    p.levelUps.length = 0;
    p.notices.length = 0;
    p.sales.length = 0;
    p.invites.length = 0;
    p.failed = null;
  }

  // --- Local player commands ----------------------------------------------------------------

  heldMode(): HeldMode {
    return this.core.heldMode(LOCAL_PLAYER);
  }
  requestRespawn(): boolean {
    return this.core.requestRespawn(LOCAL_PLAYER);
  }
  preview(tx: number, ty: number): { action: UseAction; ok: boolean; reason?: UseFailReason } {
    return this.core.preview(LOCAL_PLAYER, tx, ty);
  }
  hitProgressAt(tx: number, ty: number): number {
    return this.core.hitProgressAt(LOCAL_PLAYER, tx, ty);
  }
  consume(index: number): boolean {
    const ok = this.core.consume(LOCAL_PLAYER, index);
    this.collectEvents();
    return ok;
  }
  quickUse(kind: 'heal' | 'mana'): boolean {
    const ok = this.core.quickUse(LOCAL_PLAYER, kind);
    this.collectEvents();
    return ok;
  }
  spawnDrops(drops: readonly Drop[], owner: number | null = null): void {
    this.core.spawnDrops(drops, owner);
  }
  selectSlot(i: number): void {
    this.core.selectSlot(LOCAL_PLAYER, i);
  }
  clickInventory(index: number, button: 'left' | 'right'): void {
    this.core.clickInventory(LOCAL_PLAYER, index, button);
  }
  clickEquipment(slot: EquipSlotId): EquipFail | null {
    return this.core.clickEquipment(LOCAL_PLAYER, slot);
  }
  returnCursor(): void {
    this.core.returnCursor(LOCAL_PLAYER);
  }
  craft(recipeId: string, times = 1): CraftResult {
    return this.core.craft(LOCAL_PLAYER, recipeId, times);
  }
  allocateStat(stat: StatKey, amount = 1): boolean {
    return this.core.allocateStat(LOCAL_PLAYER, stat, amount);
  }
  autoAllocate(): boolean {
    return this.core.autoAllocate(LOCAL_PLAYER);
  }
  learnSkill(skillId: string): LearnFail | null {
    return this.core.learnSkill(LOCAL_PLAYER, skillId);
  }
  setSkillSlot(slot: number, skillId: string | null): void {
    this.core.setSkillSlot(LOCAL_PLAYER, slot, skillId);
  }
  advanceJob(jobId: string): boolean {
    const ok = this.core.advanceJob(LOCAL_PLAYER, jobId);
    this.collectEvents();
    return ok;
  }
  devSetLevel(level: number): void {
    this.core.devSetLevel(LOCAL_PLAYER, level);
    this.collectEvents();
  }
  devGold(amount: number): void {
    this.core.devGold(LOCAL_PLAYER, amount);
  }
  devSpawn(monsterId: string): boolean {
    return this.core.devSpawn(LOCAL_PLAYER, monsterId);
  }
  devGive(itemId: string, count: number): boolean {
    return this.core.devGive(LOCAL_PLAYER, itemId, count);
  }
  respawnPlayer(): void {
    this.core.respawnPlayer(LOCAL_PLAYER);
    this.collectEvents();
  }
  placePlayer(x: number, y: number): boolean {
    return this.core.placePlayer(LOCAL_PLAYER, x, y);
  }
  expToNext(): number {
    return expToNextLevel(this.player.progress.level);
  }

  // --- Saving -------------------------------------------------------------------------------

  exportMeta(_seed?: number): WorldMeta {
    return this.core.exportMeta();
  }
  exportPlayer(): PlayerSave {
    const save = this.core.exportPlayer(LOCAL_PLAYER);
    if (!save) throw new Error('local player missing');
    return save;
  }
  exportAdventurers(): ReturnType<AdventurerDirector['toJSON']> {
    return this.core.exportAdventurers();
  }
  exportSociety(): WorldSocietySave {
    return this.core.exportSociety();
  }
}
