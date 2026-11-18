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
  private readonly rng = new Rng(77);
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
    worldLayer.add([this.dust, this.leaves, this.debrisEmitter]);

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
