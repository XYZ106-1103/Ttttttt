import { OBJECT_DEFS } from '@world/shared';
import type { PixelCanvas } from '../PixelCanvas';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';
import {
  generateFlower,
  generateGrassTuft,
  generateMushroom,
  generateRock,
  generateTallGrass,
  SWAY_FRAMES,
} from './flora';
import { CAMPFIRE_FRAMES, generateCampfire, generateSignpost } from './props';
import { generateBush, generateOak, generatePine } from './trees';
import {
  BANNER_FRAMES,
  generateExchangeBoard,
  generateGuildBanner,
  generateMerchantStall,
  generateShopStall,
} from './village';

/** Frame name convention shared by the generator and the object renderer. */
export function objectFrameName(key: string, variant: number, frame = 0): string {
  return `${key}_${variant}_${frame}`;
}

/** Number of animation frames per object key (1 = static). */
export function objectFrameCount(key: string): number {
  if (key === 'campfire') return CAMPFIRE_FRAMES;
  if (key === 'guild_banner') return BANNER_FRAMES;
  const def = OBJECT_DEFS.find((d) => d.key === key);
  return def?.sways ? SWAY_FRAMES : 1;
}

type Gen = (variant: number, frame: number) => PixelCanvas;

const GENERATORS: Record<string, Gen> = {
  tree_oak: (v) => generateOak(v),
  tree_pine: (v) => generatePine(v),
  bush: (v) => generateBush(v),
  grass_tuft: generateGrassTuft,
  tall_grass: generateTallGrass,
  flower: generateFlower,
  rock: (v) => generateRock(v),
  mushroom: (v) => generateMushroom(v),
  campfire: (_v, f) => generateCampfire(f),
  signpost: () => generateSignpost(),
  shop_stall: () => generateShopStall(),
  merchant_stall: (v) => generateMerchantStall(v),
  exchange_board: () => generateExchangeBoard(),
  guild_banner: (_v, f) => generateGuildBanner(f),
};

/** Generate every variant/frame of every world object into one atlas. */
export function generateObjectAtlas(): SpriteAtlas {
  const b = new SpriteAtlasBuilder();
  for (const def of OBJECT_DEFS) {
    const gen = GENERATORS[def.key];
    if (!gen) throw new Error(`No art generator for object ${def.key}`);
    const frames = objectFrameCount(def.key);
    for (let v = 0; v < def.variants; v++) {
      for (let f = 0; f < frames; f++) b.add(objectFrameName(def.key, v, f), gen(v, f));
    }
  }
  return b.build(1024);
}
