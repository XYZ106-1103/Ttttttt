import { describe, expect, it } from 'vitest';
import { OBJECT_DEFS, tileRegistry } from '@world/shared';
import { APPEARANCE_PRESETS, PLAYER_APPEARANCE, randomAppearance } from './character/appearance';
import { composeCharacterSheet, composePortrait } from './character/CharacterComposer';
import { ANIMATIONS } from './character/poses';
import { FRAME_SIZE } from './character/rig';
import { generateObjectAtlas, objectFrameCount, objectFrameName } from './objects/ObjectArt';
import { PixelCanvas } from './PixelCanvas';
import {
  fringeFrameIndex,
  generateTileset,
  tileFrameIndex,
  tileFrameRect,
} from './tiles/TilesetGenerator';

function frameOpaque(sheet: PixelCanvas, x: number, y: number, w: number, h: number): number {
  const pc = new PixelCanvas(w, h);
  pc.blitRegion(sheet, x, y, w, h, 0, 0);
  return pc.opaqueCount();
}

describe('CharacterComposer', () => {
  it('produces every animation frame, non-empty and inside the frame', () => {
    const sheet = composeCharacterSheet(PLAYER_APPEARANCE);
    const expected = ANIMATIONS.reduce((n, a) => n + a.frames.length, 0);
    expect(sheet.frames.length).toBe(expected);
    for (const f of sheet.frames) {
      expect(f.w).toBe(FRAME_SIZE);
      expect(frameOpaque(sheet.canvas, f.x, f.y, f.w, f.h)).toBeGreaterThan(450);
    }
  });

  it('keeps feet on the baseline while grounded (idle/run)', () => {
    const sheet = composeCharacterSheet(PLAYER_APPEARANCE);
    for (const f of sheet.frames.filter((fr) => fr.name.startsWith('idle'))) {
      let bottom = -1;
      for (let y = 0; y < f.h; y++)
        for (let x = 0; x < f.w; x++) if (sheet.canvas.isOpaque(f.x + x, f.y + y)) bottom = y;
      expect(bottom).toBe(FRAME_SIZE - 1);
    }
  });

  it('never clips parts at the frame edges (all poses, all presets)', () => {
    for (const a of APPEARANCE_PRESETS) {
      const sheet = composeCharacterSheet(a);
      for (const f of sheet.frames) {
        for (let i = 0; i < FRAME_SIZE; i++) {
          // Left/right/top borders must stay transparent (the bottom row is the ground line).
          expect(sheet.canvas.isOpaque(f.x, f.y + i), `${f.name} left`).toBe(false);
          expect(sheet.canvas.isOpaque(f.x + FRAME_SIZE - 1, f.y + i), `${f.name} right`).toBe(
            false,
          );
          expect(sheet.canvas.isOpaque(f.x + i, f.y), `${f.name} top`).toBe(false);
        }
      }
    }
  });

  it('produces a non-empty portrait', () => {
    expect(composePortrait(PLAYER_APPEARANCE).opaqueCount()).toBeGreaterThan(150);
  });

  it('is deterministic and gives different looks for different seeds', () => {
    const a = composeCharacterSheet(randomAppearance(1));
    const b = composeCharacterSheet(randomAppearance(1));
    const c = composeCharacterSheet(randomAppearance(99));
    expect(Array.from(a.canvas.data)).toEqual(Array.from(b.canvas.data));
    expect(Array.from(a.canvas.data)).not.toEqual(Array.from(c.canvas.data));
  });
});

describe('TilesetGenerator', () => {
  const ts = generateTileset(tileRegistry);

  it('has art for every non-air tile in every mask', () => {
    for (const def of tileRegistry.defs) {
      if (!def || def.id === 0) continue;
      for (let mask = 0; mask < 16; mask++) {
        const idx = tileFrameIndex(ts, def.id, mask, 0);
        expect(idx).toBeGreaterThanOrEqual(0);
        const r = tileFrameRect(idx);
        expect(frameOpaque(ts.canvas, r.x, r.y, 16, 16)).toBeGreaterThan(20);
      }
    }
  });

  it('exposes fringe frames only for spilling materials', () => {
    expect(fringeFrameIndex(ts, tileRegistry.idOf('stone'), 0, 0)).toBeGreaterThanOrEqual(0);
    expect(fringeFrameIndex(ts, tileRegistry.idOf('dirt'), 0, 0)).toBe(-1);
    expect(ts.frameCount).toBeGreaterThan(0);
  });
});

describe('ObjectArt', () => {
  it('generates every variant and animation frame for every object', () => {
    const atlas = generateObjectAtlas();
    const names = new Set(atlas.frames.map((f) => f.name));
    for (const def of OBJECT_DEFS) {
      for (let v = 0; v < def.variants; v++) {
        for (let f = 0; f < objectFrameCount(def.key); f++)
          expect(names.has(objectFrameName(def.key, v, f))).toBe(true);
      }
    }
    for (const f of atlas.frames) {
      expect(f.x + f.w).toBeLessThanOrEqual(atlas.canvas.width);
      expect(f.y + f.h).toBeLessThanOrEqual(atlas.canvas.height);
    }
  });
});
