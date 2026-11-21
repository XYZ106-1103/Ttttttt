import Phaser from 'phaser';
import { Rng } from '@world/shared';
import type { ViewRect } from '../render/ChunkRenderer';
import { TEX } from '../render/textureKeys';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/**
 * Pixel particle effects. Movement dust is lit (world layer); fireflies and embers are emissive
 * (overlay layer, additive) so they glow at night.
 */
export class ParticleFx {
  private readonly dust: Emitter;
  private readonly leaves: Emitter;
  private readonly fireflies: Emitter;
  private readonly embers: Emitter;
  private readonly debrisEmitter: Emitter;
  private readonly snow: Emitter;
  private readonly ash: Emitter;
  private readonly rng = new Rng(77);
  private weatherAcc = 0;
  private runTimer = 0;
  private leafTimer = 0;
  private flyTimer = 0;
  private emberTimer = 0;

  constructor(
    scene: Phaser.Scene,
    worldLayer: Phaser.GameObjects.Layer,
    overlayLayer: Phaser.GameObjects.Layer,
  ) {
    const P = Phaser.GameObjects.Particles.ParticleEmitter;
    this.dust = new P(scene, 0, 0, TEX.fx, {
      frame: ['dust_0', 'dust_1', 'dust_2'],
      lifespan: { min: 280, max: 520 },
      speedX: { min: -35, max: 35 },
      speedY: { min: -36, max: -8 },
      gravityY: 30,
      scale: { start: 1, end: 0.4 },
      alpha: { start: 0.85, end: 0 },
      emitting: false,
    });
    this.dust.setDepth(21);
    this.leaves = new P(scene, 0, 0, TEX.fx, {
      frame: ['leaf_0', 'leaf_1', 'leaf_2'],
      lifespan: { min: 4500, max: 7000 },
      speedX: { min: 8, max: 26 },
      speedY: { min: 4, max: 14 },
      gravityY: 6,
      rotate: { min: 0, max: 360 },
      alpha: { start: 1, end: 0.2 },
      emitting: false,
    });
    this.leaves.setDepth(39);
    this.debrisEmitter = new P(scene, 0, 0, TEX.fx, {
      frame: 'pixel',
      lifespan: { min: 280, max: 620 },
      speed: { min: 40, max: 130 },
      angle: { min: 200, max: 340 },
      gravityY: 420,
      scale: { min: 1, max: 2 },
      alpha: { start: 1, end: 0.2 },
      emitting: false,
    });
    this.debrisEmitter.setDepth(23);
    // Weather: snowflakes drift down with a sway; ash flakes sink slowly, embers rise.
    this.snow = new P(scene, 0, 0, TEX.fx, {
      frame: 'pixel',
      lifespan: { min: 5000, max: 8000 },
      speedX: { min: -14, max: 6 },
      speedY: { min: 18, max: 34 },
      scale: { min: 1, max: 2 },
      alpha: { start: 0.95, end: 0.4 },
      tint: 0xffffff,
      emitting: false,
    });
    this.snow.setDepth(45);
    this.ash = new P(scene, 0, 0, TEX.fx, {
      frame: 'pixel',
      lifespan: { min: 5000, max: 8000 },
      speedX: { min: -8, max: 10 },
      speedY: { min: 6, max: 16 },
      scale: { min: 1, max: 2 },
      alpha: { start: 0.8, end: 0.2 },
      tint: [0x6a6266, 0x8a8286, 0x4e484a],
      emitting: false,
    });
    this.ash.setDepth(45);
    worldLayer.add([this.dust, this.leaves, this.debrisEmitter, this.snow, this.ash]);

    this.fireflies = new P(scene, 0, 0, TEX.fx, {
      frame: 'firefly',
      lifespan: { min: 3000, max: 5200 },
      speedX: { min: -10, max: 10 },
      speedY: { min: -8, max: 6 },
      alpha: {
        onEmit: () => 0,
        onUpdate: (_p: Phaser.GameObjects.Particles.Particle, _k: string, t: number) =>
          Math.sin(t * Math.PI) * (0.65 + 0.35 * Math.sin(t * 40)),
      },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.embers = new P(scene, 0, 0, TEX.fx, {
      frame: 'spark',
      lifespan: { min: 700, max: 1300 },
      speedX: { min: -10, max: 10 },
      speedY: { min: -48, max: -22 },
      scale: { start: 1, end: 0.3 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    overlayLayer.add([this.fireflies, this.embers]);
  }

  /**
   * Weather over the view: snowfall in the frost plains and on the peaks, ash and rising embers
   * over the volcano. `intensity` 0..1 fades it at biome borders; nothing falls underground.
   */
  weather(dt: number, view: ViewRect, kind: 'none' | 'snow' | 'ash', intensity: number): void {
    if (kind === 'none' || intensity <= 0.02) return;
    this.weatherAcc += dt * intensity * (kind === 'snow' ? 70 : 40);
    while (this.weatherAcc >= 1) {
      this.weatherAcc -= 1;
      const x = view.left + this.rng.range(-40, view.width + 40);
      const y = view.top + this.rng.range(-20, view.height * 0.35);
      if (kind === 'snow') this.snow.emitParticleAt(x, y, 1);
      else {
        this.ash.emitParticleAt(x, y, 1);
        if (this.rng.chance(0.12))
          this.embers.emitParticleAt(x, view.top + view.height * this.rng.range(0.6, 1), 1);
      }
    }
  }

  /** Tile- or object-colored debris burst (mining, chopping, breaking). */
  debris(x: number, y: number, color: number, count: number): void {
    this.debrisEmitter.setParticleTint(color);
    for (let i = 0; i < count; i++) {
      this.debrisEmitter.emitParticleAt(x + this.rng.range(-5, 5), y + this.rng.range(-5, 5), 1);
    }
  }

  footDust(x: number, y: number, count: number, spread = 4): void {
    for (let i = 0; i < count; i++)
      this.dust.emitParticleAt(x + this.rng.range(-spread, spread), y - 1, 1);
  }

  /** Called every frame with the player's state. */
  updatePlayer(dt: number, x: number, y: number, vx: number, grounded: boolean): void {
    if (grounded && Math.abs(vx) > 120) {
      this.runTimer -= dt;
      if (this.runTimer <= 0) {
        this.runTimer = 0.14;
        this.dust.emitParticleAt(x - Math.sign(vx) * 5, y - 1, 1);
      }
    } else this.runTimer = 0;
  }

  /** Ambient particles: falling leaves near trees, fireflies at night, campfire embers. */
  updateAmbient(
    dt: number,
    view: ViewRect,
    night: number,
    treeTops: readonly { x: number; y: number }[],
    fires: readonly { x: number; y: number }[],
  ): void {
    this.leafTimer -= dt;
    if (this.leafTimer <= 0 && treeTops.length > 0) {
      this.leafTimer = this.rng.range(0.35, 0.9);
      const t = this.rng.pick(treeTops);
      this.leaves.emitParticleAt(t.x + this.rng.range(-22, 22), t.y + this.rng.range(-10, 20), 1);
    }
    if (night > 0.35) {
      this.flyTimer -= dt;
      if (this.flyTimer <= 0) {
        this.flyTimer = 0.18 / night;
        this.fireflies.emitParticleAt(
          view.left + this.rng.range(0, view.width),
          view.top + view.height * this.rng.range(0.35, 0.95),
          1,
        );
      }
    }
    this.emberTimer -= dt;
    if (this.emberTimer <= 0) {
      this.emberTimer = 0.12;
      for (const f of fires) this.embers.emitParticleAt(f.x + this.rng.range(-4, 4), f.y - 4, 1);
    }
  }
}
