import Phaser from 'phaser';
import { OBJECT_DEFS, tileRegistry } from '@world/shared';
import {
  generateCloud,
  generateMoon,
  generateParallaxLayers,
  generateStars,
  generateSun,
  type ParallaxLayerArt,
} from '../art/background/BackgroundArt';
import type { Appearance } from '../art/character/appearance';
import { composeCharacterSheet, composePortrait } from '../art/character/CharacterComposer';
import { hex, withAlpha } from '../art/color';
import { generateFxAtlas, generateGlow } from '../art/fx/FxArt';
import { generateObjectAtlas, objectFrameCount, objectFrameName } from '../art/objects/ObjectArt';
import { PixelCanvas } from '../art/PixelCanvas';
import type { SpriteAtlas } from '../art/SpriteAtlas';
import { generateTileset, type Tileset, tileFrameRect } from '../art/tiles/TilesetGenerator';
import {
  characterAnimKey,
  characterKey,
  CLOUD_VARIANTS,
  cloudKey,
  objectAnimKey,
  TEX,
} from './textureKeys';

export function toHtmlCanvas(pc: PixelCanvas): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = pc.width;
  canvas.height = pc.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(pc.toBytes(), pc.width, pc.height), 0, 0);
  return canvas;
}

function addCanvasTexture(
  scene: Phaser.Scene,
  key: string,
  pc: PixelCanvas,
): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.addCanvas(key, toHtmlCanvas(pc));
  if (!tex) throw new Error(`Failed to create texture ${key}`);
  return tex;
}

function addAtlas(scene: Phaser.Scene, key: string, atlas: SpriteAtlas): void {
  const tex = addCanvasTexture(scene, key, atlas.canvas);
  for (const f of atlas.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
}

export function registerTileset(scene: Phaser.Scene): Tileset {
  const ts = generateTileset(tileRegistry);
  const tex = addCanvasTexture(scene, TEX.tiles, ts.canvas);
  for (let i = 0; i < ts.frameCount; i++) {
    const r = tileFrameRect(i);
    tex.add(i, 0, r.x, r.y, 16, 16);
  }
  return ts;
}

/**
 * Compose and register a character sprite sheet + animations. Idempotent per id, so AI
 * adventurers (PHASE 4) can call this lazily as they come into view.
 */
export function ensureCharacterTexture(
  scene: Phaser.Scene,
  id: string,
  appearance: Appearance,
): void {
  const key = characterKey(id);
  if (scene.textures.exists(key)) return;
  const sheet = composeCharacterSheet(appearance);
  const tex = addCanvasTexture(scene, key, sheet.canvas);
  for (const f of sheet.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
  for (const anim of sheet.animations) {
    const animKey = characterAnimKey(id, anim.key);
    if (scene.anims.exists(animKey)) scene.anims.remove(animKey);
    scene.anims.create({
      key: animKey,
      frames: anim.frames.map((_, i) => ({ key, frame: `${anim.key}_${i}` })),
      frameRate: anim.frameRate,
      repeat: anim.repeat,
    });
  }
}

export function characterPortraitDataUrl(appearance: Appearance, scale = 3): string {
  const pc = composePortrait(appearance);
  const big = new PixelCanvas(pc.width * scale, pc.height * scale);
  for (let y = 0; y < big.height; y++) {
    for (let x = 0; x < big.width; x++)
      big.set(x, y, pc.get(Math.floor(x / scale), Math.floor(y / scale)));
  }
  return toHtmlCanvas(big).toDataURL('image/png');
}

export function registerObjects(scene: Phaser.Scene): void {
  addAtlas(scene, TEX.objects, generateObjectAtlas());
  for (const def of OBJECT_DEFS) {
    const frames = objectFrameCount(def.key);
    if (frames <= 1) continue;
    for (let v = 0; v < def.variants; v++) {
      const key = objectAnimKey(def.key, v);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: Array.from({ length: frames }, (_, f) => ({
          key: TEX.objects,
          frame: objectFrameName(def.key, v, f),
        })),
        frameRate: def.key === 'campfire' ? 10 : 2.5,
        repeat: -1,
      });
    }
  }
}

export function registerSky(scene: Phaser.Scene): ParallaxLayerArt[] {
  const layers = generateParallaxLayers();
  for (const l of layers) addCanvasTexture(scene, l.key, l.canvas);
  for (let i = 0; i < CLOUD_VARIANTS; i++) addCanvasTexture(scene, cloudKey(i), generateCloud(i));
  addCanvasTexture(scene, TEX.sun, generateSun());
  addCanvasTexture(scene, TEX.moon, generateMoon());
  addCanvasTexture(scene, TEX.stars, generateStars());
  return layers;
}

export function registerFx(scene: Phaser.Scene): void {
  addAtlas(scene, TEX.fx, generateFxAtlas());
  const glow = addCanvasTexture(scene, TEX.glow, generateGlow(64));
  glow.setFilter(Phaser.Textures.FilterMode.LINEAR);
  const shadow = new PixelCanvas(20, 6);
  shadow.fillEllipse(9.5, 2.5, 9.5, 2.6, withAlpha(hex('#000000'), 70));
  shadow.fillEllipse(9.5, 2.5, 6, 1.6, withAlpha(hex('#000000'), 110));
  addCanvasTexture(scene, TEX.shadow, shadow);
}
