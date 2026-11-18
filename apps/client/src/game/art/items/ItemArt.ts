import { ITEM_DEFS, tileRegistry } from '@world/shared';
import { type Color, hex, mix, shade } from '../color';
import { generateFlower, generateMushroom } from '../objects/flora';
import { PixelCanvas } from '../PixelCanvas';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';
import {
  type Tileset,
  TILE_VARIANTS,
  tileFrameIndex,
  tileFrameRect,
} from '../tiles/TilesetGenerator';

const S = 16;
const OUTLINE = hex('#1a1214');
const WOOD = ['#3e2618', '#6b4530', '#8c5d3c', '#b07a4c'].map((c) => hex(c));

const METALS: Record<string, Color[]> = {
  worn: ['#3d4250', '#6a7182', '#9aa1b0', '#c8cdd6'].map((c) => hex(c)),
  copper: ['#5a2a14', '#a4532a', '#d9803f', '#f6b871'].map((c) => hex(c)),
  iron: ['#3a3f4f', '#8790a6', '#c3cbda', '#f2f5fa'].map((c) => hex(c)),
};

function outlined(pc: PixelCanvas): PixelCanvas {
  const o = pc.clone();
  o.outline(OUTLINE);
  o.blit(pc, 0, 0);
  return o;
}

/** Diagonal handle from bottom-left toward top-right. */
function handle(pc: PixelCanvas, len: number): void {
  for (let i = 0; i < len; i++) {
    pc.set(2 + i, 13 - i, WOOD[2] ?? 0);
    pc.set(3 + i, 13 - i, WOOD[1] ?? 0);
  }
  pc.set(2, 13, WOOD[0] ?? 0);
}

function pickaxe(metal: Color[]): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  handle(pc, 10);
  // Curved head across the top of the handle.
  const head: [number, number][] = [
    [4, 3],
    [5, 2],
    [6, 2],
    [7, 2],
    [8, 2],
    [9, 3],
    [10, 3],
    [11, 4],
    [12, 5],
    [13, 6],
    [13, 7],
    [14, 8],
    [14, 9],
  ];
  head.forEach(([x, y], i) => {
    pc.set(x, y, (i < 4 ? metal[3] : metal[2]) ?? 0);
    pc.set(x, y + 1, metal[1] ?? 0);
  });
  pc.set(3, 4, metal[1] ?? 0);
  pc.set(15, 10, metal[0] ?? 0);
  pc.set(10, 5, metal[0] ?? 0);
  return outlined(pc);
}

function axe(metal: Color[]): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  handle(pc, 10);
  // Blade on the upper right.
  for (let y = 1; y <= 7; y++) {
    const w = y < 2 || y > 6 ? 2 : 4;
    for (let x = 0; x < w; x++) {
      const px = 9 + x + (y > 3 ? 1 : 0);
      pc.set(px, y, (x === w - 1 ? metal[3] : y < 4 ? metal[2] : metal[1]) ?? 0);
    }
  }
  pc.set(9, 4, metal[0] ?? 0);
  pc.set(8, 4, WOOD[0] ?? 0);
  return outlined(pc);
}

function log(): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  // Bark body (horizontal log) with a cut end showing rings.
  for (let y = 5; y <= 11; y++) {
    for (let x = 2; x <= 11; x++)
      pc.set(x, y, (y === 5 ? WOOD[3] : y > 9 ? WOOD[0] : WOOD[1]) ?? 0);
  }
  pc.fillEllipse(12, 8, 2.6, 3.4, hex('#d9a86a'));
  pc.set(12, 8, hex('#9c6a3a'));
  pc.set(12, 6, hex('#b8844e'));
  pc.set(13, 10, hex('#b8844e'));
  for (let x = 3; x < 11; x += 3) pc.set(x, 7, WOOD[0] ?? 0);
  return outlined(pc);
}

function fiber(): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  const greens = ['#2f6b3a', '#43904a', '#62b552', '#9ad66a'].map((c) => hex(c));
  for (let i = 0; i < 5; i++) {
    for (let k = 0; k < 11; k++) {
      const x = 4 + i * 2 + Math.round(Math.sin(k * 0.6 + i) * 0.8) - Math.round(k * 0.18);
      pc.set(x, 2 + k, greens[(i + (k > 6 ? 1 : 0)) % greens.length] ?? 0);
    }
  }
  for (let x = 4; x <= 11; x++) pc.set(x, 9, hex('#c9a45a'));
  return outlined(pc);
}

function oreChunk(metal: Color[]): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  const rock = ['#3d4354', '#5b6378', '#7b8498'].map((c) => hex(c));
  pc.fillEllipse(8, 9, 5.6, 4.2, rock[1] ?? 0);
  pc.fillEllipse(7, 8, 3.5, 2.5, rock[2] ?? 0);
  for (const [x, y] of [
    [5, 8],
    [9, 7],
    [10, 10],
    [7, 11],
  ] as const) {
    pc.set(x, y, metal[2] ?? 0);
    pc.set(x + 1, y, metal[3] ?? 0);
    pc.set(x, y + 1, metal[1] ?? 0);
  }
  return outlined(pc);
}

function centered(src: PixelCanvas): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  pc.blit(src, Math.floor((S - src.width) / 2), Math.floor((S - src.height) / 2) + 1);
  return pc;
}

function tileIcon(ts: Tileset, tileKey: string, canvas: PixelCanvas): PixelCanvas {
  const id = tileRegistry.idOf(tileKey);
  const idx = tileFrameIndex(ts, id, 0, Math.min(1, TILE_VARIANTS - 1));
  const pc = new PixelCanvas(S, S);
  if (idx < 0) return pc;
  const r = tileFrameRect(idx);
  // Slightly inset so block icons read as items, not tiles.
  const tile = new PixelCanvas(S, S);
  tile.blitRegion(canvas, r.x, r.y, S, S, 0, 0);
  for (let y = 0; y < 14; y++)
    for (let x = 0; x < 14; x++)
      pc.set(x + 1, y + 1, tile.get(Math.round(x * (15 / 13)), Math.round(y * (15 / 13))));
  return pc;
}

/** 16×16 icon for every item id. Block items reuse the generated tile art. */
export function generateItemIcons(ts: Tileset): Map<string, PixelCanvas> {
  const icons = new Map<string, PixelCanvas>();
  for (const def of ITEM_DEFS) {
    let icon: PixelCanvas;
    const metalKey = def.id.split('_')[0] ?? '';
    if (def.tool) {
      const metal = METALS[metalKey] ?? METALS.worn ?? [];
      icon = def.tool.type === 'pickaxe' ? pickaxe(metal) : axe(metal);
    } else if (def.id === 'torch') {
      icon = tileIcon(ts, 'torch', ts.canvas);
    } else if (def.places) {
      icon = tileIcon(ts, def.places, ts.canvas);
    } else if (def.id === 'wood') icon = log();
    else if (def.id === 'fiber') icon = fiber();
    else if (def.id === 'wildflower') icon = centered(generateFlower(0, 0));
    else if (def.id === 'mushroom') icon = centered(generateMushroom(0));
    else if (def.id === 'copper_ore') icon = oreChunk(METALS.copper ?? []);
    else if (def.id === 'iron_ore') icon = oreChunk(METALS.iron ?? []);
    else {
      icon = new PixelCanvas(S, S);
      icon.fillRect(4, 4, 8, 8, mix(hex('#ff00ff'), shade(hex('#ff00ff'), -0.4), 0.5));
    }
    icons.set(def.id, icon);
  }
  return icons;
}

export function itemAtlas(icons: Map<string, PixelCanvas>): SpriteAtlas {
  const b = new SpriteAtlasBuilder();
  for (const [id, pc] of icons) b.add(id, pc);
  return b.build(256);
}
