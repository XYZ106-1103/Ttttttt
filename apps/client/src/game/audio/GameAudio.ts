/**
 * What the world sounds like: turns simulation events (offline or replicated from the server)
 * into positioned effects, picks the music theme for where the player is and what is happening,
 * and keeps the ambience in step. Reads events only — presenters consume them afterwards.
 */
import { type ActorEvent, biomeAt, GOLD_DROP, TILE_SIZE, type UseOutcome } from '@world/shared';
import type { FrameEvents } from '../entities/FrameEvents';
import type { ClientSim } from '../sim/ClientSim';
import type { AudioEngine, PlayOptions } from './AudioEngine';
import type { ThemeId } from './music';
import type { SfxName } from './sfx';

const STONE = new Set([
  'stone',
  'mossy_stone',
  'copper_ore',
  'iron_ore',
  'stone_bricks',
  'sandstone',
  'basalt',
  'obsidian',
  'ice',
  'silver_ore',
  'gold_ore',
  'frostite_ore',
  'magmite_ore',
  'crystal_ore',
]);
const WOOD = new Set(['wood_platform', 'wood_planks', 'wood_beam']);
/** A boss this close (pixels) takes over the music. */
const BOSS_RANGE = 60 * TILE_SIZE;
/** Tiles below the surface where the world counts as a cave. */
const CAVE_DEPTH = 10;
/** A new music context must hold this long before the theme changes (seconds). */
const THEME_HOLD = 2.5;

type Pos = { x: number; y: number } | null;

export class GameAudio {
  private candidate: ThemeId | null = null;
  private candidateFor = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly sim: ClientSim,
  ) {}

  private at(pos: Pos, volume = 1): PlayOptions {
    return pos ? { x: pos.x, y: pos.y, volume } : { volume };
  }

  private play(name: SfxName, opts?: PlayOptions): void {
    this.engine.play(name, opts);
  }

  /** Position of a character or monster by id (for events that only carry an id). */
  private posOf(id: number): Pos {
    const sim = this.sim;
    const a = sim.adventurers.byCharacter(id);
    if (a) return { x: a.character.motor.x, y: a.character.motor.y - 20 };
    const p = sim.peers().find((x) => x.id === id);
    if (p) return { x: p.motor.x, y: p.motor.y - 20 };
    const m = sim.monsters.monsters.find((x) => x.id === id);
    return m ? { x: m.motor.x, y: m.motor.y - 10 } : null;
  }

  private material(tileId: number): 'stone' | 'wood' | 'dirt' {
    const key = this.sim.world.tiles.get(tileId)?.key ?? '';
    return STONE.has(key) ? 'stone' : WOOD.has(key) ? 'wood' : 'dirt';
  }

  private useSound(out: UseOutcome, pos: Pos, volume: number): void {
    const o = this.at(pos ?? { x: out.tx * TILE_SIZE + 8, y: out.ty * TILE_SIZE + 8 }, volume);
    if (out.action === 'place') return this.play('place', o);
    if (out.hitObject) {
      const tree = out.hitObject.key.startsWith('tree_');
      if (tree) return this.play(out.broke ? 'tree_fall' : 'chop', o);
      return this.play(
        out.broke ? 'break' : out.hitObject.key === 'rock' ? 'mine_stone' : 'mine_dirt',
        o,
      );
    }
    if (out.broke) return this.play('break', o);
    const mat = this.material(out.brokenTile ?? this.sim.world.getFg(out.tx, out.ty));
    this.play(mat === 'stone' ? 'mine_stone' : mat === 'wood' ? 'chop' : 'mine_dirt', o);
  }

  private actorSound(e: ActorEvent, pos: Pos, volume: number): void {
    const o = this.at(pos, volume);
    switch (e.type) {
      case 'action': {
        const id = e.action.id;
        switch (e.action.anim) {
          case 'slam':
            return this.play('swing_heavy', o);
          case 'shoot':
            return this.play(id.includes('pebble') ? 'swing' : 'bow', o);
          case 'dash':
            return this.play('dodge', o);
          case 'cast':
          case 'raise':
            if (id.includes('fire')) return this.play('fireball', o);
            if (id.includes('frost')) return this.play('frost', o);
            if (id.includes('second_wind') || id.includes('heal')) return this.play('heal', o);
            if (id.includes('mana')) return this.play('mana', o);
            return this.play('magic', o);
          default:
            return this.play('swing', o);
        }
      }
      case 'dodge':
        return this.play('dodge', o);
      case 'charge':
        return this.play('bow_draw', o);
      case 'teleport':
        return this.play('blink', o);
      case 'castFail':
        if (!pos) this.play('error');
        return;
    }
  }

  /** Read this frame's events (before the presenters consume them). */
  consume(frame: FrameEvents): void {
    const sim = this.sim;
    const ev = sim.events;
    const me = sim.player.id;
    for (const u of ev.uses) this.useSound(u, null, 1);
    for (const u of [...ev.aiUses, ...ev.peerUses]) this.useSound(u.out, this.posOf(u.id), 0.7);
    for (const pk of ev.pickups) this.play(pk.itemId === GOLD_DROP ? 'coin' : 'pickup');
    if (ev.failed) this.play('error');
    for (const e of ev.actor) this.actorSound(e, null, 1);
    for (const a of [...ev.aiActor, ...ev.peerActor])
      this.actorSound(a.event, this.posOf(a.id), 0.6);
    for (const e of ev.combat) {
      switch (e.type) {
        case 'damage': {
          if (e.targetId === me) {
            this.play('hurt');
            break;
          }
          const pos = { x: e.x, y: e.y };
          const monster = sim.monsters.monsters.some((m) => m.id === e.targetId);
          const mine = e.attackerId === me;
          if (e.source === 'dot') break;
          this.play(e.crit ? 'crit' : 'hit', this.at(pos, mine ? 1 : 0.55));
          if (monster) this.play('monster_hit', this.at(pos, mine ? 0.8 : 0.45));
          break;
        }
        case 'heal':
          if (e.targetId === me) this.play(e.mana ? 'mana' : 'heal');
          break;
        case 'death': {
          if (e.targetId === me) break;
          const boss = sim.monsters.monsters.find((m) => m.id === e.targetId)?.def.boss;
          this.play(boss ? 'explosion' : 'monster_die', this.at({ x: e.x, y: e.y }));
          break;
        }
        case 'dodge':
          if (e.perfect) this.play('perfect');
          break;
        case 'projectileEnd':
          if (e.hitTile) this.play('thunk', this.at({ x: e.x, y: e.y }, 0.7));
          break;
        case 'explode':
          this.play(
            e.visual === 'fireball' || e.visual === 'meteor' ? 'fireball' : 'explosion',
            this.at({ x: e.x, y: e.y }),
          );
          break;
        default:
          break;
      }
    }
    for (const e of ev.monster) {
      switch (e.type) {
        case 'telegraph':
          this.play('telegraph', this.at(this.posOf(e.id), 0.7));
          break;
        case 'impact':
          this.play('quake', this.at({ x: e.x, y: e.y }, 0.5 + e.power * 0.5));
          break;
        case 'phase':
          this.play('roar', this.at(this.posOf(e.id)));
          break;
        case 'blink':
          this.play('blink', this.at({ x: e.fromX, y: e.fromY }, 0.6));
          break;
        default:
          break;
      }
    }
    if (ev.levelUps.length > 0) this.play('level_up');
    for (const l of [...ev.aiLevelUps, ...ev.peerLevelUps])
      this.play('level_up', this.at(this.posOf(l.id), 0.35));
    for (const n of ev.notices) {
      switch (n.kind) {
        case 'jobChanged':
          this.play('job_change');
          break;
        case 'died':
          this.play('death');
          break;
        case 'respawned':
          this.play('respawn');
          break;
        case 'bossSpawned':
          this.play('boss_spawn');
          break;
        case 'bossDefeated':
          this.play('victory');
          break;
        case 'castFail':
        case 'consumeFail':
        case 'weaponLevel':
          this.play('error');
          break;
        case 'consumed':
          this.play('drink');
          break;
        case 'questDone':
          this.play('victory');
          break;
        case 'enhanced':
          this.play(
            n.outcome === 'success' ? 'level_up' : n.outcome === 'drop' ? 'break' : 'error',
          );
          break;
      }
    }
    if (ev.sales.length > 0) this.play('coin');
    if (ev.invites.length > 0) this.play('notify');
    // The player's own movement.
    if (frame.jumped) this.play('jump');
    if (frame.landed && frame.landingSpeed > 180)
      this.play('land', { volume: Math.min(1, 0.4 + (frame.landingSpeed - 180) / 500) });
    if (frame.stepped > 0) {
      const m = sim.player.motor;
      const under = sim.world.getFg(Math.floor(m.x / TILE_SIZE), Math.floor((m.y + 2) / TILE_SIZE));
      const mat = this.material(under);
      this.play(mat === 'stone' ? 'step_stone' : mat === 'wood' ? 'step_wood' : 'step', {
        volume: 0.8,
      });
    }
  }

  /** Listener, music theme and ambience for this frame. */
  update(dt: number, mode: 'title' | 'playing', viewCenter: { x: number; y: number }): void {
    const sim = this.sim;
    const engine = this.engine;
    if (mode === 'title') {
      engine.setListener(viewCenter.x, viewCenter.y);
      engine.setTheme('title');
      engine.ambience({ wind: 0.6, crickets: false, cave: false });
      return;
    }
    const m = sim.player.motor;
    engine.setListener(m.x, m.y - 20);
    const tx = Math.floor(m.x / TILE_SIZE);
    const depth = Math.floor(m.y / TILE_SIZE) - sim.world.surfaceY(tx);
    const night = sim.clock.daylight < 0.35;
    const boss = sim.monsters.bossActive;
    let want: ThemeId;
    if (boss && Math.hypot(boss.motor.x - m.x, boss.motor.y - m.y) < BOSS_RANGE) want = 'boss';
    else if (depth > CAVE_DEPTH) want = 'cave';
    else {
      const biome = biomeAt(tx, sim.world.generator.spawnTileX).id;
      if (biome === 'volcano') want = 'volcano';
      else if (
        biome === 'tundra' ||
        (biome === 'mountains' && Math.floor(m.y / TILE_SIZE) < sim.world.heightTiles * 0.3)
      )
        want = 'snow';
      else if (night) want = 'night';
      else if (biome === 'village') want = 'town';
      else want = 'day';
    }
    // Hold before switching so walking along a boundary does not flip the music back and forth.
    if (want !== this.candidate) {
      this.candidate = want;
      this.candidateFor = 0;
    } else this.candidateFor += dt;
    const current = engine.theme;
    if (
      current === null ||
      current === 'title' ||
      want === 'boss' ||
      this.candidateFor >= THEME_HOLD
    )
      engine.setTheme(want);
    engine.ambience({
      wind: depth < 2 ? 1 : Math.max(0, 1 - depth / 8),
      crickets: night && depth < 4,
      cave: depth > CAVE_DEPTH,
    });
  }
}
