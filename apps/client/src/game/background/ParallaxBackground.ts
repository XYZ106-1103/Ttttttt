import Phaser from 'phaser';
import { Rng } from '@world/shared';
import type { ParallaxLayerArt } from '../art/background/BackgroundArt';
import { alpha as alphaOf, blue, green, red } from '../art/color';
import type { ViewRect } from '../render/ChunkRenderer';
import { CLOUD_VARIANTS, cloudKey, TEX } from '../render/textureKeys';
import { lerpRgb, skyAt, type SkyState } from './skyPalette';

interface LayerView {
  art: ParallaxLayerArt;
  sprite: Phaser.GameObjects.TileSprite;
  fill: Phaser.GameObjects.Rectangle;
}

interface Cloud {
  image: Phaser.GameObjects.Image;
  baseX: number;
  y: number;
  factor: number;
  speed: number;
}

const CLOUD_SPAN = 2600;
/** Screen fraction where the horizon sits when the camera is level with the surface. */
const HORIZON_FRAC = 0.64;

function multiplyRgb(color: number, tint: number): number {
  const r = Math.round((((color >> 16) & 255) * ((tint >> 16) & 255)) / 255);
  const g = Math.round((((color >> 8) & 255) * ((tint >> 8) & 255)) / 255);
  const b = Math.round(((color & 255) * (tint & 255)) / 255);
  return (r << 16) | (g << 8) | b;
}

/** 0xAABBGGRR (pixel-canvas color) → 0xRRGGBB. */
function toRgb(c: number): number {
  return (red(c) << 16) | (green(c) << 8) | blue(c);
}

/**
 * Multi-layer parallax sky and landscape, rendered by the background camera in internal
 * (art-pixel) screen coordinates. Time of day drives the sky gradient, celestial bodies, stars
 * and per-layer atmospheric tint.
 */
/** Multiply an 0xRRGGBB color by per-channel factors. */
function gradeRgb(c: number, g: readonly [number, number, number]): number {
  const ch = (v: number, k: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (ch((c >> 16) & 255, g[0]) << 16) | (ch((c >> 8) & 255, g[1]) << 8) | ch(c & 255, g[2]);
}

export class ParallaxBackground {
  private readonly skyTex: Phaser.Textures.CanvasTexture;
  private readonly sky: Phaser.GameObjects.Image;
  private readonly stars: Phaser.GameObjects.TileSprite;
  private readonly sun: Phaser.GameObjects.Image;
  private readonly sunGlow: Phaser.GameObjects.Image;
  private readonly moon: Phaser.GameObjects.Image;
  private readonly layers: LayerView[] = [];
  private readonly clouds: Cloud[] = [];
  private viewW = 1;
  private viewH = 1;
  private lastSkyHour = -1;
  private state: SkyState = skyAt(8);

  constructor(
    scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    arts: readonly ParallaxLayerArt[],
    private readonly horizonWorldY: number,
  ) {
    // A restarted scene (new world, online/offline switch) recreates it.
    if (scene.textures.exists(TEX.sky)) scene.textures.remove(TEX.sky);
    const tex = scene.textures.createCanvas(TEX.sky, 1, 128);
    if (!tex) throw new Error('sky texture');
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.skyTex = tex;
    this.sky = scene.make.image({ x: 0, y: 0, key: TEX.sky }, false).setOrigin(0, 0);
    this.stars = scene.make
      .tileSprite({ x: 0, y: 0, width: 16, height: 16, key: TEX.stars }, false)
      .setOrigin(0, 0);
    this.sunGlow = scene.make
      .image({ x: 0, y: 0, key: TEX.glow }, false)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.sun = scene.make.image({ x: 0, y: 0, key: TEX.sun }, false);
    this.moon = scene.make.image({ x: 0, y: 0, key: TEX.moon }, false);
    layer.add([this.sky, this.stars, this.sunGlow, this.sun, this.moon]);

    const rng = new Rng(4242);
    for (let i = 0; i < 9; i++) {
      const image = scene.make
        .image({ x: 0, y: 0, key: cloudKey(i % CLOUD_VARIANTS) }, false)
        .setOrigin(0, 0);
      const factor = rng.range(0.03, 0.1);
      this.clouds.push({
        image,
        baseX: rng.range(0, CLOUD_SPAN),
        y: rng.range(0.05, 0.36),
        factor,
        speed: rng.range(3, 7),
      });
      image.setAlpha(0.95);
      layer.add(image);
    }

    for (const art of arts) {
      const sprite = scene.make
        .tileSprite({ x: 0, y: 0, width: 16, height: art.canvas.height, key: art.key }, false)
        .setOrigin(0, 0);
      const fill = new Phaser.GameObjects.Rectangle(scene, 0, 0, 16, 16, toRgb(art.fill));
      fill.setOrigin(0, 0);
      fill.setFillStyle(toRgb(art.fill), alphaOf(art.fill) / 255);
      layer.add([sprite, fill]);
      this.layers.push({ art, sprite, fill });
    }
  }

  get current(): SkyState {
    return this.state;
  }

  resize(viewW: number, viewH: number): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.sky.setDisplaySize(viewW, viewH);
    this.stars.setSize(viewW, viewH);
    for (const l of this.layers) l.sprite.setSize(viewW, l.art.canvas.height);
  }

  private redrawSky(s: SkyState): void {
    const ctx = this.skyTex.context;
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
    g.addColorStop(0, css(s.top));
    g.addColorStop(0.62, css(lerpRgb(s.top, s.horizon, 0.75)));
    g.addColorStop(0.82, css(s.horizon));
    g.addColorStop(1, css(s.horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1, 128);
    this.skyTex.refresh();
    this.skyTex.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  /** @param view World camera view (world pixels). */
  update(
    view: ViewRect,
    hour: number,
    dt: number,
    timeSec: number,
    /** Biome color grade (linear multipliers). */
    grade: readonly [number, number, number] = [1, 1, 1],
  ): SkyState {
    const s = skyAt(hour);
    const tinted = (c: number): number => gradeRgb(c, grade);
    this.sky.setTint(tinted(0xffffff));
    this.state = s;
    if (Math.abs(hour - this.lastSkyHour) > 0.02) {
      this.redrawSky(s);
      this.lastSkyHour = hour;
    }
    const W = this.viewW;
    const H = this.viewH;
    const camCenterY = view.top + view.height / 2;
    const rel = camCenterY - this.horizonWorldY;

    this.stars.setAlpha(s.stars);
    this.stars.tilePositionX = timeSec * 0.6 + view.left * 0.01;
    this.stars.setVisible(s.stars > 0.01);

    const horizon = H * HORIZON_FRAC - rel * 0.02;
    // Sun: rises at 6:00 east, sets at 18:00.
    const sunT = (hour - 5.5) / 14;
    const sunVisible = sunT > -0.05 && sunT < 1.05;
    this.sun.setVisible(sunVisible);
    this.sunGlow.setVisible(sunVisible);
    if (sunVisible) {
      const sx = W * (0.08 + 0.84 * sunT);
      const sy = horizon - Math.sin(Math.PI * Math.min(1, Math.max(0, sunT))) * H * 0.52 + 6;
      const warm = 1 - Math.sin(Math.PI * Math.min(1, Math.max(0, sunT)));
      this.sun
        .setPosition(Math.round(sx), Math.round(sy))
        .setTint(lerpRgb(0xffffff, 0xffb070, warm));
      this.sunGlow
        .setPosition(sx, sy)
        .setScale(3.2 + warm * 2)
        .setTint(lerpRgb(0xfff2c0, 0xff8a40, warm))
        .setAlpha(0.45 + warm * 0.25);
    }
    const moonT = (((hour - 18 + 24) % 24) - 0.5) / 12.5;
    const moonVisible = moonT > -0.05 && moonT < 1.05;
    this.moon.setVisible(moonVisible);
    if (moonVisible) {
      const mx = W * (0.1 + 0.8 * moonT);
      const my = horizon - Math.sin(Math.PI * Math.min(1, Math.max(0, moonT))) * H * 0.48 + 6;
      this.moon.setPosition(Math.round(mx), Math.round(my)).setAlpha(Math.min(1, 0.4 + s.stars));
    }

    const cloudTint = lerpRgb(lerpRgb(0xffffff, s.horizon, 0.35), s.land, 0.5);
    for (const c of this.clouds) {
      c.baseX += c.speed * dt;
      const span = CLOUD_SPAN;
      let x = (c.baseX - view.left * c.factor) % span;
      if (x < 0) x += span;
      x -= c.image.width;
      c.image.setPosition(
        Math.round(x),
        Math.round(horizon - H * 0.62 + c.y * H * 0.8 - rel * 0.03),
      );
      c.image.setTint(tinted(cloudTint));
      c.image.setVisible(x < W);
    }

    for (const l of this.layers) {
      const tint = lerpRgb(s.land, s.far, l.art.atmosphere);
      const bottom = H * HORIZON_FRAC + l.art.baseOffset - rel * l.art.scrollY;
      const top = Math.round(bottom - l.art.canvas.height);
      l.sprite.setPosition(0, top);
      l.sprite.tilePositionX = Math.round(view.left * l.art.scrollX);
      l.sprite.setTint(tinted(tint));
      const fillTop = Math.max(0, top + l.art.canvas.height);
      l.fill.setPosition(0, fillTop);
      l.fill.setSize(W, Math.max(0, H - fillTop + 2));
      l.fill.setFillStyle(multiplyRgb(toRgb(l.art.fill), tint), 1);
      l.fill.setVisible(fillTop < H);
    }
    return s;
  }

  destroy(): void {
    this.layer.removeAll(true);
  }
}
