/**
 * Render the procedural art generators to PNG files for visual review.
 * Usage (from apps/client): pnpm art:preview <outDir> [character|tiles|objects|background|all]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './lib/png';
import { PixelCanvas } from '../src/game/art/PixelCanvas';
import { hex } from '../src/game/art/color';
import {
  composeCharacterFrame,
  composeCharacterSheet,
  composePortrait,
} from '../src/game/art/character/CharacterComposer';
import {
  APPEARANCE_PRESETS,
  PLAYER_APPEARANCE,
  randomAppearance,
} from '../src/game/art/character/appearance';
import { ANIMATIONS } from '../src/game/art/character/poses';
import { FRAME_SIZE } from '../src/game/art/character/rig';

const out = process.argv[2] ?? 'preview';
mkdirSync(out, { recursive: true });

function save(name: string, pc: PixelCanvas, scale = 4, bg?: string): void {
  let img = pc;
  if (bg) {
    img = new PixelCanvas(pc.width, pc.height);
    img.fillRect(0, 0, pc.width, pc.height, hex(bg));
    img.blit(pc, 0, 0);
  }
  writeFileSync(join(out, `${name}.png`), encodePng(img.toBytes(), img.width, img.height, scale));
  console.log('wrote', join(out, `${name}.png`));
}

const which = process.argv[3] ?? 'all';

if (which === 'all' || which === 'character') {
  save('character_player', composeCharacterSheet(PLAYER_APPEARANCE).canvas, 3, '#7d9fb4');
  save('portrait_player', composePortrait(PLAYER_APPEARANCE), 6, '#2a2f45');
  const idle = ANIMATIONS[0]!.frames[0]!;
  const presets = new PixelCanvas(FRAME_SIZE * APPEARANCE_PRESETS.length, FRAME_SIZE);
  APPEARANCE_PRESETS.forEach((a, i) =>
    presets.blit(composeCharacterFrame(a, idle), i * FRAME_SIZE, 0),
  );
  save('character_presets', presets, 4, '#7d9fb4');
  const crowd = new PixelCanvas(FRAME_SIZE * 8, FRAME_SIZE * 2);
  for (let i = 0; i < 16; i++) {
    crowd.blit(
      composeCharacterFrame(randomAppearance((i + 1) * 104729), idle),
      (i % 8) * FRAME_SIZE,
      Math.floor(i / 8) * FRAME_SIZE,
    );
  }
  save('character_crowd', crowd, 3, '#7d9fb4');
}

import {
  DEFAULT_OVERWORLD,
  OverworldGenerator,
  seedFromString,
  tileRegistry,
  World,
} from '@world/shared';
import {
  fringeFrameIndex,
  generateTileset,
  tileFrameIndex,
  tileFrameRect,
  TILE_VARIANTS,
} from '../src/game/art/tiles/TilesetGenerator';
import { bgMask, fgMask, SIDE_OFFSETS, tileVariant } from '../src/game/world/autotile';

if (which === 'all' || which === 'tiles') {
  const ts = generateTileset(tileRegistry);
  save('tileset', ts.canvas, 2, '#8fb3c9');
  const world = new World(
    new OverworldGenerator({ seed: seedFromString('PROJECT-WORLD'), ...DEFAULT_OVERWORLD }),
  );
  const ox = Number(process.argv[4] ?? world.generator.spawnTileX - 40);
  const W = 100;
  const H = 46;
  const oy = world.surfaceY(world.generator.spawnTileX) - 30;
  const pc = new PixelCanvas(W * 16, H * 16);
  pc.fillRect(0, 0, pc.width, pc.height, hex('#9cc7e0'));
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      const wx = ox + tx;
      const wy = oy + ty;
      for (const layer of ['bg', 'fg'] as const) {
        const id = layer === 'fg' ? world.getFg(wx, wy) : world.getBg(wx, wy);
        if (!id) continue;
        const mask = layer === 'fg' ? fgMask(world, wx, wy, id) : bgMask(world, wx, wy, id);
        const idx = tileFrameIndex(ts, id, mask, tileVariant(wx, wy, TILE_VARIANTS));
        if (idx < 0) continue;
        const r = tileFrameRect(idx);
        const frame = new PixelCanvas(16, 16);
        frame.blitRegion(ts.canvas, r.x, r.y, 16, 16, 0, 0);
        pc.blit(frame, tx * 16, ty * 16);
        if (layer === 'fg') {
          SIDE_OFFSETS.forEach(([dx, dy], side) => {
            const n = world.getFg(wx + dx, wy + dy);
            if (n === id || !world.tiles.connects(id, n)) return;
            const fi = fringeFrameIndex(ts, n, side, tileVariant(wx, wy, TILE_VARIANTS));
            if (fi < 0) return;
            const fr = tileFrameRect(fi);
            const f = new PixelCanvas(16, 16);
            f.blitRegion(ts.canvas, fr.x, fr.y, 16, 16, 0, 0);
            pc.blit(f, tx * 16, ty * 16);
          });
        }
      }
    }
  }
  save('terrain', pc, 1);
}

import { generateObjectAtlas } from '../src/game/art/objects/ObjectArt';

if (which === 'all' || which === 'objects') {
  const atlas = generateObjectAtlas();
  save('objects', atlas.canvas, 2, '#8fb3c9');
}

import {
  generateCloud,
  generateMoon,
  generateParallaxLayers,
  generateSun,
} from '../src/game/art/background/BackgroundArt';

if (which === 'all' || which === 'background') {
  const layers = generateParallaxLayers();
  const H = 420;
  const pc = new PixelCanvas(1024, H);
  for (let y = 0; y < H; y++) pc.fillRect(0, y, 1024, 1, hex(y < 200 ? '#6fb0e6' : '#bfe0f0'));
  for (const l of layers) {
    const top = H - 60 + l.baseOffset - l.canvas.height;
    pc.blit(l.canvas, 0, top);
    pc.fillRect(0, top + l.canvas.height, 1024, H, l.fill);
  }
  pc.blit(generateCloud(0), 100, 40);
  pc.blit(generateCloud(1), 500, 70);
  pc.blit(generateSun(), 800, 30);
  pc.blit(generateMoon(), 900, 30);
  save('background', pc, 1);
}
