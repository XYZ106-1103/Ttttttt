import { describe, expect, it } from 'vitest';
import {
  MONSTER_DEFS,
  OBJECT_DEFS,
  PROJECTILE_DEFS,
  SKILL_DEFS,
  STATUS_DEFS,
  tileRegistry,
} from '@world/shared';
import { DIGIT_CHARS, DIGIT_STYLES, digitFrame, generateCombatFxAtlas } from './fx/CombatFxArt';
import { generateSkillIcons, generateStatusIcons } from './icons/SkillIcons';
import { generateMonsterSheets } from './monsters/MonsterArt';
import { APPEARANCE_PRESETS, PLAYER_APPEARANCE, randomAppearance } from './character/appearance';
import { composeCharacterSheet, composePortrait } from './character/CharacterComposer';
import { ANIMATIONS, COMBAT_ANIMATIONS } from './character/poses';
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
    const expected = [...ANIMATIONS, ...COMBAT_ANIMATIONS].reduce((n, a) => n + a.frames.length, 0);
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

describe('combat art', () => {
  it('has a sprite sheet for every monster with the animations its brain uses', () => {
    const sheets = generateMonsterSheets();
    for (const def of MONSTER_DEFS) {
      const sheet = sheets.get(def.id);
      expect(sheet, def.id).toBeDefined();
      if (!sheet) continue;
      expect(sheet.anims.has('dead'), `${def.id} dead`).toBe(true);
      expect(sheet.anims.has('hurt') || def.boss, `${def.id} hurt`).toBe(true);
      for (const [anim, a] of sheet.anims) {
        expect(a.frames.length, `${def.id}:${anim}`).toBeGreaterThan(0);
        for (const f of a.frames) {
          expect(f.width).toBe(sheet.width);
          if (anim !== 'dead') expect(f.opaqueCount(), `${def.id}:${anim}`).toBeGreaterThan(40);
        }
      }
    }
  });

  it('packs projectile visuals, effects and damage digits into the combat atlas', () => {
    const names = new Set(generateCombatFxAtlas().frames.map((f) => f.name));
    for (const p of PROJECTILE_DEFS) {
      expect(names.has(p.visual) || names.has(`${p.visual}_0`), p.visual).toBe(true);
    }
    for (const style of Object.keys(DIGIT_STYLES))
      for (const ch of DIGIT_CHARS) expect(names.has(digitFrame(style, ch))).toBe(true);
    for (const n of [
      'slash_0',
      'spin_0',
      'slam_0',
      'thrust_0',
      'hit_0',
      'crit_0',
      'explode_0',
      'frost_0',
      'pillar',
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('draws an icon for every skill and status effect', () => {
    const skills = generateSkillIcons();
    for (const s of SKILL_DEFS)
      expect(skills.get(s.id)?.opaqueCount() ?? 0, s.id).toBeGreaterThan(400);
    const statuses = generateStatusIcons();
    for (const s of STATUS_DEFS) expect(statuses.has(s.id), s.id).toBe(true);
  });
});
