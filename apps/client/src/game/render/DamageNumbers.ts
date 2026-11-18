import type Phaser from 'phaser';
import { DIGIT_STYLES, digitFrame } from '../art/fx/CombatFxArt';
import { TEX } from './textureKeys';

export type NumberStyle = 'dmg' | 'crit' | 'hurt' | 'heal' | 'mana' | 'dot';

interface Floating {
  readonly c: Phaser.GameObjects.Container;
  age: number;
  readonly life: number;
  readonly x: number;
  readonly y: number;
  readonly pop: boolean;
  readonly drift: number;
}

const MAX = 80;

/** Bitmap damage numbers that pop, rise and fade (unlit overlay so they read in dark caves). */
export class DamageNumbers {
  private readonly live: Floating[] = [];
  private readonly recent = new Map<string, { at: number; n: number }>();
  private time = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
  ) {}

  spawn(value: number, x: number, y: number, style: NumberStyle, key = ''): void {
    const text =
      (style === 'heal' || style === 'mana' ? '+' : '') + String(Math.max(0, Math.round(value)));
    const st = DIGIT_STYLES[style] ?? DIGIT_STYLES.dmg;
    const glyphW = 5 * (st?.scale ?? 1) + 2;
    const advance = glyphW - (st?.scale === 2 ? 2 : 1);
    // Stack numbers that hit the same target in quick succession.
    const r = this.recent.get(key);
    const n = key && r && this.time - r.at < 0.35 ? r.n + 1 : 0;
    if (key) this.recent.set(key, { at: this.time, n });
    const c = this.scene.make.container({ x, y: y - n * (st?.scale === 2 ? 15 : 9) }, false);
    const width = advance * text.length;
    [...text].forEach((ch, i) => {
      const img = this.scene.make.image(
        { x: i * advance - width / 2, y: 0, key: TEX.combat, frame: digitFrame(style, ch) },
        false,
      );
      img.setOrigin(0, 1);
      c.add(img);
    });
    c.setDepth(style === 'crit' ? 46 : 45);
    this.layer.add(c);
    this.live.push({
      c,
      age: 0,
      life: style === 'crit' ? 1.1 : 0.85,
      x,
      y: c.y,
      pop: style === 'crit',
      drift: ((n % 3) - 1) * 3,
    });
    while (this.live.length > MAX) this.live.shift()?.c.destroy();
  }

  update(dt: number): void {
    this.time += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i] as Floating;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.c.destroy();
        this.live.splice(i, 1);
        continue;
      }
      const rise = 1 - Math.pow(1 - Math.min(1, f.age / 0.35), 3);
      f.c.setPosition(
        Math.round(f.x + f.drift * rise),
        Math.round(f.y - 14 * rise - Math.max(0, t - 0.5) * 10),
      );
      const s = f.pop ? 1 + Math.max(0, 0.6 - f.age * 4) : 1;
      f.c.setScale(s >= 1.3 ? 1.5 : s > 1.05 ? 1.25 : 1);
      f.c.setAlpha(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }
    if (this.recent.size > 64) this.recent.clear();
  }

  destroy(): void {
    for (const f of this.live) f.c.destroy();
    this.live.length = 0;
  }
}
