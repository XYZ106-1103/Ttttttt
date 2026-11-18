import Phaser from 'phaser';
import { Rng } from '@world/shared';
import { combatAnimKey, TEX } from '../render/textureKeys';

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

interface Timed {
  readonly obj: Phaser.GameObjects.Components.Visible &
    Phaser.GameObjects.Components.Alpha &
    Phaser.GameObjects.GameObject;
  age: number;
  readonly life: number;
  readonly tick?: (t: number, obj: Timed['obj']) => void;
}

interface RainZone {
  x: number;
  y: number;
  radius: number;
  until: number;
  start: number;
  next: number;
}

interface LabelText {
  readonly text: Phaser.GameObjects.Text;
  readonly x: number;
  readonly y: number;
  age: number;
  readonly life: number;
}

export type SlashKind = 'slash' | 'slam' | 'spin' | 'thrust';

/**
 * Combat visual effects: weapon trails, impacts, explosions, skill visuals, afterimages,
 * telegraph markers, status particles and floating labels. Pure presentation.
 */
export class CombatFx {
  private readonly timed: Timed[] = [];
  private readonly rains: RainZone[] = [];
  private readonly labels: LabelText[] = [];
  private readonly sparks: Emitter;
  private readonly motes: Emitter;
  private readonly debris: Emitter;
  private readonly rng = new Rng(4242);
  private zoom = 2;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly overlayLayer: Phaser.GameObjects.Layer,
    private readonly labelLayer: Phaser.GameObjects.Layer,
  ) {
    const P = Phaser.GameObjects.Particles.ParticleEmitter;
    this.sparks = new P(scene, 0, 0, TEX.fx, {
      frame: 'spark',
      lifespan: { min: 180, max: 420 },
      speed: { min: 60, max: 220 },
      scale: { start: 1, end: 0.2 },
      alpha: { start: 1, end: 0 },
      gravityY: 300,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.motes = new P(scene, 0, 0, TEX.combat, {
      frame: ['mote', 'ember', 'snow', 'bubble'],
      lifespan: { min: 500, max: 1100 },
      speedY: { min: -60, max: -20 },
      speedX: { min: -20, max: 20 },
      alpha: { start: 1, end: 0 },
      emitting: false,
    });
    this.debris = new P(scene, 0, 0, TEX.fx, {
      frame: 'pixel',
      lifespan: { min: 300, max: 700 },
      speed: { min: 50, max: 160 },
      angle: { min: 200, max: 340 },
      gravityY: 500,
      scale: { min: 1, max: 2.2 },
      alpha: { start: 1, end: 0.1 },
      emitting: false,
    });
    this.sparks.setDepth(44);
    this.motes.setDepth(43);
    this.debris.setDepth(23);
    overlayLayer.add([this.sparks, this.motes]);
    worldLayer.add(this.debris);
  }

  setZoom(z: number): void {
    this.zoom = z;
  }

  private addTimed(obj: Timed['obj'], life: number, tick?: Timed['tick']): void {
    this.timed.push({ obj, age: 0, life, tick });
  }

  private animSprite(
    name: string,
    x: number,
    y: number,
    depth: number,
    add = true,
  ): Phaser.GameObjects.Sprite {
    const s = this.scene.make.sprite({ x, y, key: TEX.combat, frame: `${name}_0` }, false);
    s.setDepth(depth);
    if (add) s.setBlendMode(Phaser.BlendModes.ADD);
    this.overlayLayer.add(s);
    s.play(combatAnimKey(name));
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }

  /** Weapon trail along the aim direction from the character center. */
  slash(kind: SlashKind, x: number, y: number, aim: number, tint: number, reverse = false): void {
    const off = kind === 'spin' ? 0 : kind === 'thrust' ? 16 : 10;
    const s = this.animSprite(kind, x + Math.cos(aim) * off, y + Math.sin(aim) * off, 30);
    s.setTint(tint);
    if (kind !== 'spin') s.setRotation(aim);
    if (reverse) s.setFlipY(true);
    if (kind === 'thrust') s.setOrigin(0.15, 0.5);
  }

  spark(x: number, y: number, crit: boolean, tint = 0xffe08a): void {
    const s = this.animSprite(crit ? 'crit' : 'hit', x, y, 44);
    s.setRotation(this.rng.range(0, Math.PI));
    this.sparks.setParticleTint(tint);
    this.sparks.emitParticleAt(x, y, crit ? 10 : 5);
  }

  explosion(x: number, y: number, radius: number): void {
    const s = this.animSprite('explode', x, y, 32, false);
    s.setScale(Math.max(1, Math.round(radius / 22)));
    this.sparks.setParticleTint(0xffb347);
    this.sparks.emitParticleAt(x, y, 12);
  }

  frost(x: number, y: number, radius: number): void {
    const s = this.animSprite('frost', x, y, 31);
    s.setScale(Math.max(1, Math.round((radius * 2) / 64)));
    this.motes.emitParticleAt(x, y, 0);
    for (let i = 0; i < 10; i++) {
      this.motes.setParticleTint(0xffffff);
      this.motes.emitParticleAt(
        x + this.rng.range(-radius, radius),
        y + this.rng.range(-radius * 0.5, radius * 0.5),
        1,
      );
    }
  }

  ring(x: number, y: number, scale: number, tint: number): void {
    const s = this.animSprite('ring', x, y, 31);
    s.setScale(scale).setTint(tint);
  }

  debrisBurst(x: number, y: number, color: number, count: number): void {
    this.debris.setParticleTint(color);
    for (let i = 0; i < count; i++)
      this.debris.emitParticleAt(x + this.rng.range(-4, 4), y + this.rng.range(-4, 4), 1);
  }

  motesAt(x: number, y: number, tint: number, count: number, spread = 6): void {
    this.motes.setParticleTint(tint);
    for (let i = 0; i < count; i++)
      this.motes.emitParticleAt(
        x + this.rng.range(-spread, spread),
        y + this.rng.range(-spread, spread),
        1,
      );
  }

  /** Golden light pillar + rising motes (level up). */
  pillar(x: number, y: number): void {
    const img = this.scene.make.image({ x, y, key: TEX.combat, frame: 'pillar' }, false);
    img.setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(42);
    this.overlayLayer.add(img);
    this.addTimed(img, 1.4, (t, o) => {
      o.setAlpha(t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      (o as Phaser.GameObjects.Image).setScale(1 + (1 - t) * 0.3, 1);
    });
    this.motesAt(x, y - 30, 0xffe9a8, 24, 14);
  }

  /** Fading copy of a character frame (dodges, dashes, blinks). */
  afterimage(
    snap: { key: string; frame: string; x: number; y: number; flipX: boolean },
    tint: number,
    life = 0.28,
  ): void {
    const img = this.scene.make.image(
      { x: snap.x, y: snap.y, key: snap.key, frame: snap.frame },
      false,
    );
    img.setOrigin(0.5, 1).setFlipX(snap.flipX).setTintFill(tint).setAlpha(0.55).setDepth(18);
    this.overlayLayer.add(img);
    this.addTimed(img, life, (t, o) => o.setAlpha(0.55 * (1 - t)));
  }

  /** Ground warning marker for delayed attacks. */
  marker(x: number, y: number, life: number): void {
    const s = this.scene.make.sprite({ x, y, key: TEX.combat, frame: 'marker_0' }, false);
    s.setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setDepth(29);
    s.play(combatAnimKey('marker'));
    this.overlayLayer.add(s);
    this.addTimed(s, life, (t, o) => o.setAlpha(0.5 + 0.5 * Math.abs(Math.sin(t * 18))));
  }

  /** Arrows raining on a zone (visual only; damage is simulated). */
  arrowRain(x: number, y: number, radius: number, start: number, until: number): void {
    this.rains.push({ x, y, radius, start, until, next: start });
  }

  stuckArrow(x: number, y: number, angle: number): void {
    const img = this.scene.make.image({ x, y, key: TEX.combat, frame: 'arrow' }, false);
    img.setOrigin(0.85, 0.5).setRotation(angle).setDepth(22);
    this.worldLayer.add(img);
    this.addTimed(img, 1.6, (t, o) => o.setAlpha(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3));
  }

  /** Floating label text in screen-crisp pixels (EXP, LEVEL UP, PERFECT). */
  label(x: number, y: number, text: string, color: string, size = 12, life = 1.1): void {
    const t = this.scene.make.text(
      {
        x: 0,
        y: 0,
        text,
        style: {
          fontFamily: 'Galmuri11, monospace',
          fontSize: `${size}px`,
          color,
          stroke: '#120c1c',
          strokeThickness: 3,
        },
      },
      false,
    );
    t.setOrigin(0.5, 1).setDepth(60);
    this.labelLayer.add(t);
    this.labels.push({ text: t, x, y, age: 0, life });
  }

  update(dt: number, now: number): void {
    for (let i = this.timed.length - 1; i >= 0; i--) {
      const e = this.timed[i] as Timed;
      e.age += dt;
      const t = e.age / e.life;
      if (t >= 1 || !e.obj.active) {
        e.obj.destroy();
        this.timed.splice(i, 1);
        continue;
      }
      e.tick?.(t, e.obj);
    }
    for (let i = this.rains.length - 1; i >= 0; i--) {
      const r = this.rains[i] as RainZone;
      if (now > r.until) {
        this.rains.splice(i, 1);
        continue;
      }
      while (now >= r.next) {
        r.next += 0.045;
        if (r.next < r.start) continue;
        const x = r.x + this.rng.range(-r.radius, r.radius);
        const img = this.scene.make.image(
          { x: x - 30, y: r.y - 150, key: TEX.combat, frame: 'arrow' },
          false,
        );
        const ang = Math.atan2(150, 30);
        img.setRotation(ang).setDepth(25);
        this.worldLayer.add(img);
        const sx = img.x;
        const sy = img.y;
        this.addTimed(img, 0.22, (t, o) => {
          const im = o as Phaser.GameObjects.Image;
          im.setPosition(sx + 30 * t, sy + 150 * t);
          if (t > 0.9) im.setAlpha((1 - t) * 10);
        });
      }
    }
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i] as LabelText;
      l.age += dt;
      const t = l.age / l.life;
      if (t >= 1) {
        l.text.destroy();
        this.labels.splice(i, 1);
        continue;
      }
      const rise = 1 - Math.pow(1 - Math.min(1, l.age / 0.5), 3);
      l.text.setPosition(Math.round(l.x * this.zoom), Math.round((l.y - 18 * rise) * this.zoom));
      l.text.setAlpha(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }

  destroy(): void {
    for (const e of this.timed) e.obj.destroy();
    for (const l of this.labels) l.text.destroy();
    this.timed.length = 0;
    this.labels.length = 0;
    this.sparks.destroy();
    this.motes.destroy();
    this.debris.destroy();
  }
}
