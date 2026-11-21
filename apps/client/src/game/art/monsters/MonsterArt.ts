/**
 * Monster sprite sheets. Hand-drawn atlases can replace these: register frames named
 * `${monsterId}:${anim}_${index}` in the `monsters` texture and the renderer picks them up.
 */
import { MONSTER_DEFS } from '@world/shared';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';
import { creatureSheets, type MonsterSheet } from './creatures';
import { FROST_GIANT_PALETTE, golemSheet, MAGMA_TYRANT_PALETTE } from './golemArt';

export type { MonsterSheet };

export function monsterFrameName(id: string, anim: string, i: number): string {
  return `${id}:${anim}_${i}`;
}

export function generateMonsterSheets(): Map<string, MonsterSheet> {
  const sheets = creatureSheets();
  sheets.set('corestone_golem', golemSheet());
  sheets.set('frost_giant', golemSheet(FROST_GIANT_PALETTE));
  sheets.set('magma_tyrant', golemSheet(MAGMA_TYRANT_PALETTE));
  return sheets;
}

/** Pack every monster frame into one atlas. Throws if a defined monster has no art. */
export function generateMonsterAtlas(sheets = generateMonsterSheets()): SpriteAtlas {
  const b = new SpriteAtlasBuilder();
  for (const def of MONSTER_DEFS) {
    const sheet = sheets.get(def.id);
    if (!sheet) throw new Error(`No art for monster ${def.id}`);
    for (const [anim, a] of sheet.anims)
      a.frames.forEach((pc, i) => b.add(monsterFrameName(def.id, anim, i), pc));
  }
  return b.build(1024);
}
