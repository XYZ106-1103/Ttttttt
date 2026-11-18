import {
  createMotorState,
  createStartingProgress,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  deriveStats,
  expToNextLevel,
  isRegionSolid,
  type CharacterProgress,
  type MotorInput,
  type MotorState,
  type MovementConfig,
  OverworldGenerator,
  stepMotor,
  World,
  WorldClock,
} from '@world/shared';

export interface PlayerCharacter {
  name: string;
  jobId: string;
  progress: CharacterProgress;
  hp: number;
  mp: number;
  motor: MotorState;
  /** Feet position before the latest tick (render interpolation). */
  prevX: number;
  prevY: number;
}

export interface SimulationOptions {
  seed: number;
  playerName: string;
  startHour?: number;
  dayLengthSeconds?: number;
}

/**
 * The local simulation: world, clock and the player's character. Contains no rendering code;
 * PHASE 6 moves the authoritative copy to the server and this becomes the client-side predictor.
 */
export class GameSimulation {
  readonly world: World;
  readonly clock: WorldClock;
  readonly movement: MovementConfig;
  readonly player: PlayerCharacter;
  tickCount = 0;

  constructor(options: SimulationOptions) {
    this.world = new World(new OverworldGenerator({ seed: options.seed, ...DEFAULT_OVERWORLD }));
    this.clock = new WorldClock({
      startHour: options.startHour ?? 8,
      dayLengthSeconds: options.dayLengthSeconds ?? 24 * 60,
    });
    this.movement = DEFAULT_MOVEMENT;
    const spawn = this.world.spawnPoint();
    const progress = createStartingProgress();
    const derived = deriveStats(progress);
    this.player = {
      name: options.playerName,
      jobId: 'novice',
      progress,
      hp: derived.maxHp,
      mp: derived.maxMp,
      motor: createMotorState(spawn.x, spawn.y, this.movement),
      prevX: spawn.x,
      prevY: spawn.y,
    };
    this.player.motor.grounded = true;
  }

  /** Advance the world clock only (title screen). */
  tickAmbient(dt: number): void {
    this.clock.advance(dt);
    this.tickCount++;
  }

  /** Advance one fixed step with the player's input. */
  tick(dt: number, input: MotorInput): void {
    const p = this.player;
    p.prevX = p.motor.x;
    p.prevY = p.motor.y;
    stepMotor(p.motor, input, this.world, this.movement, dt);
    this.clock.advance(dt);
    this.tickCount++;
  }

  respawnPlayer(): void {
    const spawn = this.world.spawnPoint();
    this.placePlayer(spawn.x, spawn.y);
  }

  /** Place the player's feet at a world position if the body fits there. */
  placePlayer(x: number, y: number): boolean {
    const m = this.player.motor;
    const half = m.width / 2;
    if (
      x - half < 0 ||
      x + half > this.world.widthPixels ||
      y - m.height < 0 ||
      y > this.world.heightPixels
    ) {
      return false;
    }
    if (isRegionSolid(this.world, x - half, y - m.height, x + half, y)) return false;
    m.x = x;
    m.y = y;
    m.vx = 0;
    m.vy = 0;
    m.grounded = true;
    this.player.prevX = x;
    this.player.prevY = y;
    return true;
  }

  expToNext(): number {
    return expToNextLevel(this.player.progress.level);
  }
}
