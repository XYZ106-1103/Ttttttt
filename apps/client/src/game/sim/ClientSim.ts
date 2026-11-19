import type {
  ActionIntent,
  AdventurerDirector,
  Character,
  CombatWorld,
  CraftResult,
  DropEntity,
  Economy,
  EquipFail,
  EquipSlotId,
  HeldMode,
  LearnFail,
  MonsterManager,
  MotorInput,
  MovementConfig,
  Player,
  Society,
  StatKey,
  TownServices,
  UseAction,
  UseFailReason,
  UseIntent,
  World,
  WorldClock,
} from '@world/shared';
import type { SimEvents } from './GameSimulation';

/**
 * What the renderer, presenters and UI read and call: implemented by the offline
 * `GameSimulation` (the whole world runs locally) and the online `OnlineSimulation` (a replica of
 * the server's world, with the local player predicted and every command sent to the server).
 */
export interface ClientSim {
  readonly online: boolean;
  /** Society key of the local player ('player' offline, 'pc:<id>' online). */
  readonly selfKey: string;
  readonly world: World;
  readonly clock: WorldClock;
  readonly movement: MovementConfig;
  readonly worldId: string;
  readonly combat: CombatWorld;
  readonly monsters: MonsterManager;
  readonly adventurers: AdventurerDirector;
  readonly drops: readonly DropEntity[];
  readonly economy: Economy;
  readonly society: Society;
  readonly time: number;
  readonly tickCount: number;
  monstersEnabled: boolean;
  readonly player: Player;
  readonly town: TownServices;
  readonly explored: Set<number>;
  readonly playTime: number;
  readonly events: SimEvents;

  /** Other players in view (online). */
  peers(): readonly Player[];
  /** Appearance seed of another player. */
  peerLook(key: string): number;
  /** The local player, another player in view or an adventurer, by society key. */
  characterByKey(key: string): Character | null;
  /** Visual smoothing of prediction corrections for the local player (pixels). */
  renderOffset(): { readonly x: number; readonly y: number };

  tickAmbient(dt: number): void;
  tick(dt: number, input: MotorInput, use?: UseIntent | null, action?: ActionIntent): void;

  heldMode(): HeldMode;
  requestRespawn(): boolean;
  preview(tx: number, ty: number): { action: UseAction; ok: boolean; reason?: UseFailReason };
  hitProgressAt(tx: number, ty: number): number;
  consume(index: number): boolean;
  quickUse(kind: 'heal' | 'mana'): boolean;
  selectSlot(i: number): void;
  clickInventory(index: number, button: 'left' | 'right'): void;
  clickEquipment(slot: EquipSlotId): EquipFail | null;
  returnCursor(): void;
  craft(recipeId: string, times?: number): CraftResult;
  allocateStat(stat: StatKey, amount?: number): boolean;
  autoAllocate(): boolean;
  learnSkill(skillId: string): LearnFail | null;
  setSkillSlot(slot: number, skillId: string | null): void;
  advanceJob(jobId: string): boolean;
  devSetLevel(level: number): void;
  devGold(amount: number): void;
  devSpawn(monsterId: string): boolean;
  devGive(itemId: string, count: number): boolean;
  respawnPlayer(): void;
  placePlayer(x: number, y: number): boolean;
  expToNext(): number;
}
