/**
 * Village props (PHASE 5): the general store, merchant stalls, the exchange board and the guild
 * banner. Same palette rules as the other props: hue-shifted shading, top-left key light,
 * dark sel-out outline.
 */
import { hash2f } from '@world/shared';
import { type Color, hex, mix, shade } from '../color';
import { PixelCanvas } from '../PixelCanvas';

const OUTLINE = hex('#1c110d');
const WOOD = ['#2e1d17', '#4a2f22', '#6b4530', '#8c5d3c', '#a8774e'].map((c) => hex(c));
const W = (i: number): Color => WOOD[i] ?? 0;

function post(pc: PixelCanvas, x: number, top: number, bottom: number): void {
  pc.fillRect(x, top, 3, bottom - top, W(2));
  pc.fillRect(x, top, 1, bottom - top, W(3));
  pc.fillRect(x + 2, top, 1, bottom - top, W(1));
}

/** Planked box from (x, y) of w×h with a lit top edge. */
function counter(pc: PixelCanvas, x: number, y: number, w: number, h: number): void {
  pc.fillRect(x, y, w, h, W(2));
  pc.fillRect(x, y, w, 2, W(4));
  pc.fillRect(x, y + 2, w, 1, W(3));
  for (let py = y + 6; py < y + h; py += 4) pc.fillRect(x + 1, py, w - 2, 1, W(1));
  for (let px = x + 7; px < x + w - 2; px += 11) pc.fillRect(px, y + 3, 1, h - 3, W(1));
  pc.fillRect(x, y + h - 1, w, 1, W(0));
  // Grain flecks
  for (let i = 0; i < w; i += 3)
    if (hash2f(i, y, 11) < 0.35) pc.set(x + i, y + 4 + ((i * 7) % Math.max(1, h - 6)), W(3));
}

/** Scalloped, striped cloth awning between x0..x1 starting at y. */
function awning(
  pc: PixelCanvas,
  x0: number,
  x1: number,
  y: number,
  depth: number,
  a: Color,
  b: Color,
  stripe = 5,
): void {
  for (let x = x0; x <= x1; x++) {
    const band = Math.floor((x - x0) / stripe) % 2 === 0 ? a : b;
    // Slight droop toward the middle of each scallop.
    const k = ((x - x0) % stripe) / (stripe - 1);
    const scallop = Math.round(Math.sin(k * Math.PI) * 2);
    for (let yy = y; yy < y + depth + scallop; yy++) {
      const t = (yy - y) / (depth + 2);
      // Key light from the top, cloth folds darken the stripe edges.
      let c = mix(shade(band, 0.12), shade(band, -0.22), t);
      if ((x - x0) % stripe === 0) c = shade(c, -0.12);
      pc.set(x, yy, c);
    }
    pc.set(x, y + depth + scallop - 1, shade(band, -0.35));
  }
  // Roof edge
  pc.fillRect(x0 - 1, y - 2, x1 - x0 + 3, 2, shade(a, -0.45));
  pc.fillRect(x0 - 1, y - 2, x1 - x0 + 3, 1, shade(a, -0.25));
}

function bottle(pc: PixelCanvas, x: number, y: number, liquid: Color): void {
  const glass = hex('#d8e6ef');
  pc.fillRect(x + 1, y, 2, 2, hex('#7a5a3a'));
  pc.fillRect(x, y + 2, 4, 5, liquid);
  pc.fillRect(x, y + 2, 4, 1, mix(liquid, glass, 0.5));
  pc.set(x, y + 3, mix(liquid, glass, 0.7));
  pc.fillRect(x + 3, y + 3, 1, 4, shade(liquid, -0.3));
}

function crate(pc: PixelCanvas, x: number, y: number, w: number, h: number): void {
  pc.fillRect(x, y, w, h, W(3));
  pc.fillRect(x, y, w, 1, W(4));
  pc.fillRect(x, y + h - 1, w, 1, W(1));
  pc.line(x, y, x + w - 1, y + h - 1, W(2));
  pc.fillRect(x, y, 1, h, W(2));
  pc.fillRect(x + w - 1, y, 1, h, W(1));
}

function lantern(pc: PixelCanvas, x: number, y: number): void {
  pc.set(x + 1, y - 2, hex('#2a2a2a'));
  pc.set(x + 1, y - 1, hex('#2a2a2a'));
  pc.fillRect(x, y, 3, 1, hex('#3a3030'));
  pc.fillRect(x, y + 1, 3, 3, hex('#ffcf6a'));
  pc.set(x + 1, y + 2, hex('#fff3c4'));
  pc.fillRect(x, y + 4, 3, 1, hex('#3a3030'));
}

/** The NPC general store: red-and-cream awning, a counter of potions and crates. */
export function generateShopStall(): PixelCanvas {
  const pc = new PixelCanvas(58, 50);
  const ground = 50;
  post(pc, 4, 10, ground);
  post(pc, 51, 10, ground);
  awning(pc, 2, 55, 10, 9, hex('#b8423a'), hex('#efe2c4'), 6);
  // Hanging sign with a potion emblem.
  pc.fillRect(26, 21, 1, 3, W(1));
  pc.fillRect(31, 21, 1, 3, W(1));
  pc.fillRect(23, 24, 12, 8, W(3));
  pc.fillRect(23, 24, 12, 1, W(4));
  pc.fillRect(23, 31, 12, 1, W(1));
  bottle(pc, 27, 25, hex('#d94b4b'));
  lantern(pc, 9, 21);
  // Back shelf with goods
  pc.fillRect(8, 30, 42, 2, W(1));
  bottle(pc, 10, 23, hex('#d94b4b'));
  bottle(pc, 15, 23, hex('#4b7dd9'));
  bottle(pc, 41, 23, hex('#d94b4b'));
  bottle(pc, 46, 23, hex('#58b86a'));
  // Counter and wares
  counter(pc, 6, 36, 46, 14);
  crate(pc, 9, 30, 8, 6);
  // Apples / produce in a basket
  pc.fillEllipse(24, 34, 5, 2.5, W(3));
  for (const [ax, c] of [
    [21, '#d84a3c'],
    [24, '#e2b23c'],
    [27, '#d84a3c'],
  ] as const) {
    pc.fillCircle(ax, 32, 1.6, hex(c));
    pc.set(ax - 1, 31, mix(hex(c), hex('#ffffff'), 0.5));
  }
  // Rolled cloth and a scale
  pc.fillRect(33, 31, 9, 4, hex('#6c8fb8'));
  pc.fillRect(33, 31, 9, 1, hex('#9bb7d6'));
  pc.fillRect(44, 30, 1, 6, hex('#9a8a5a'));
  pc.fillRect(42, 30, 5, 1, hex('#c9b86f'));
  pc.outline(OUTLINE);
  return pc;
}

const STALL_COLORS: readonly [string, string][] = [
  ['#2f8f83', '#e8e0c8'],
  ['#6a4c9c', '#ead9f2'],
  ['#c8892e', '#f3e6c0'],
  ['#4f8a3c', '#e2edcf'],
];

/** A merchant adventurer's stall; variants change the canopy and the wares. */
export function generateMerchantStall(variant: number): PixelCanvas {
  const pc = new PixelCanvas(54, 46);
  const ground = 46;
  const [a, b] = STALL_COLORS[variant % STALL_COLORS.length] ?? ['#2f8f83', '#e8e0c8'];
  post(pc, 4, 9, ground);
  post(pc, 47, 9, ground);
  awning(pc, 2, 51, 9, 7, hex(a), hex(b), 7);
  // Table with cloth
  const cloth = hex(a);
  pc.fillRect(6, 33, 42, 3, shade(cloth, 0.1));
  pc.fillRect(6, 36, 42, 6, cloth);
  for (let x = 6; x < 48; x += 4) pc.fillRect(x, 36, 1, 6, shade(cloth, -0.2));
  pc.fillRect(6, 41, 42, 1, shade(cloth, -0.35));
  pc.fillRect(8, 42, 2, 4, W(1));
  pc.fillRect(44, 42, 2, 4, W(1));
  // Wares by variant
  switch (variant % 4) {
    case 0: // ores and ingots
      for (const [x, c] of [
        [10, '#c27a4a'],
        [16, '#c27a4a'],
        [24, '#a9b2bf'],
        [30, '#a9b2bf'],
      ] as const) {
        pc.fillRect(x, 29, 5, 4, hex(c));
        pc.fillRect(x, 29, 5, 1, mix(hex(c), hex('#ffffff'), 0.4));
        pc.fillRect(x + 4, 30, 1, 3, shade(hex(c), -0.3));
      }
      crate(pc, 37, 26, 8, 7);
      break;
    case 1: // potions and gems
      bottle(pc, 10, 26, hex('#d94b4b'));
      bottle(pc, 16, 26, hex('#4b7dd9'));
      bottle(pc, 22, 26, hex('#b05ad9'));
      for (const [x, c] of [
        [31, '#7fe0d4'],
        [36, '#e05a8a'],
        [41, '#f0d060'],
      ] as const) {
        pc.fillRect(x + 1, 29, 2, 1, mix(hex(c), hex('#ffffff'), 0.5));
        pc.fillRect(x, 30, 4, 2, hex(c));
        pc.fillRect(x + 1, 32, 2, 1, shade(hex(c), -0.3));
      }
      break;
    case 2: {
      // blades on a rack
      const steel = hex('#b9c3cf');
      for (const x of [12, 19, 26]) {
        pc.fillRect(x, 18, 2, 13, steel);
        pc.fillRect(x, 18, 1, 13, mix(steel, hex('#ffffff'), 0.4));
        pc.fillRect(x - 1, 31, 4, 1, hex('#c9a54a'));
        pc.fillRect(x, 32, 2, 1, W(1));
      }
      pc.fillRect(10, 30, 20, 1, W(2));
      crate(pc, 34, 27, 10, 6);
      break;
    }
    default: {
      // cloth rolls and furs
      for (const [x, c] of [
        [10, '#c2554a'],
        [17, '#5a7fc2'],
        [24, '#d9c25a'],
      ] as const) {
        pc.fillRect(x, 28, 6, 5, hex(c));
        pc.fillRect(x, 28, 6, 1, mix(hex(c), hex('#ffffff'), 0.35));
        pc.fillCircle(x + 5, 30.5, 2, shade(hex(c), -0.15));
      }
      pc.fillEllipse(38, 31, 6, 2.5, hex('#8a6a4a'));
      pc.fillEllipse(37, 30, 4, 1.5, hex('#a8875f'));
    }
  }
  pc.outline(OUTLINE);
  return pc;
}

/** The exchange: a roofed notice board covered in listings, with a gold-coin crest. */
export function generateExchangeBoard(): PixelCanvas {
  const pc = new PixelCanvas(56, 54);
  const ground = 54;
  post(pc, 6, 14, ground);
  post(pc, 47, 14, ground);
  // Shingled roof
  for (let y = 0; y < 9; y++) {
    const inset = 8 - y;
    for (let x = 2 + inset; x < 54 - inset; x++) {
      const row = Math.floor(y / 3);
      const shingle = (x + row * 3) % 6 === 0 || y % 3 === 2;
      pc.set(x, 5 + y, shingle ? hex('#4a3a5c') : mix(hex('#6d5a86'), hex('#54456a'), y / 9));
    }
  }
  pc.fillRect(1, 14, 54, 2, W(1));
  // Board
  pc.fillRect(9, 16, 38, 26, W(3));
  pc.fillRect(9, 16, 38, 1, W(4));
  pc.fillRect(9, 41, 38, 1, W(1));
  // Pinned listings
  const papers: readonly [number, number, number, number][] = [
    [11, 19, 9, 8],
    [22, 18, 8, 10],
    [32, 19, 12, 7],
    [12, 29, 11, 9],
    [26, 30, 8, 9],
    [36, 28, 9, 11],
  ];
  papers.forEach(([x, y, w, h], i) => {
    const paper = i % 3 === 1 ? hex('#efe2bf') : hex('#f6eedb');
    pc.fillRect(x, y, w, h, paper);
    pc.fillRect(x, y + h - 1, w, 1, shade(paper, -0.2));
    for (let ly = y + 2; ly < y + h - 1; ly += 2)
      pc.fillRect(x + 1, ly, Math.max(2, w - 2 - ((ly + i) % 3)), 1, hex('#8a7a66'));
    pc.set(x + Math.floor(w / 2), y, hex(i % 2 ? '#d84a3c' : '#3c7ad8'));
  });
  // Gold coin crest on the gable
  pc.fillCircle(28, 9, 3.6, hex('#e3b341'));
  pc.fillCircle(27.5, 8.5, 2.2, hex('#f7d774'));
  pc.fillRect(28, 7, 1, 4, hex('#b5822a'));
  lantern(pc, 50, 18);
  pc.outline(OUTLINE);
  return pc;
}

export const BANNER_FRAMES = 4;

/** The guild hall banner on a tall pole; the cloth ripples over its frames. */
export function generateGuildBanner(frame: number): PixelCanvas {
  const pc = new PixelCanvas(26, 66);
  const ground = 66;
  // Stone base
  pc.fillRect(6, ground - 5, 13, 5, hex('#5b6378'));
  pc.fillRect(6, ground - 5, 13, 1, hex('#7b8498'));
  pc.fillRect(8, ground - 7, 9, 2, hex('#4a5163'));
  // Pole
  pc.fillRect(11, 5, 3, ground - 11, W(2));
  pc.fillRect(11, 5, 1, ground - 11, W(3));
  // Finial
  pc.fillCircle(12.5, 3, 2.2, hex('#e3b341'));
  pc.set(12, 2, hex('#fff1a8'));
  // Crossbar
  pc.fillRect(3, 8, 19, 2, W(1));
  // Cloth with a ripple
  const t = (frame / BANNER_FRAMES) * Math.PI * 2;
  const cloth = hex('#7a2f3a');
  for (let y = 10; y < 44; y++) {
    const k = (y - 10) / 34;
    const sway = Math.round(Math.sin(t + k * 4) * k * 1.6);
    const tail = y > 38 ? Math.abs(y - 38) : 0;
    for (let x = 4 + sway + (tail > 0 ? 0 : 0); x < 21 + sway; x++) {
      // Swallow-tail cut at the bottom.
      if (tail > 0 && Math.abs(x - (12.5 + sway)) < tail * 1.4) continue;
      const fold = Math.sin(t + (x - 4) * 0.6 + k * 3) * 0.12;
      pc.set(x, y, shade(cloth, fold - k * 0.15 + (x < 7 + sway ? 0.08 : 0)));
    }
  }
  // Gold trim and crest: a shield with a star.
  for (let y = 10; y < 38; y++) {
    const k = (y - 10) / 34;
    const sway = Math.round(Math.sin(t + k * 4) * k * 1.6);
    pc.set(5 + sway, y, hex('#c9a54a'));
    pc.set(19 + sway, y, hex('#c9a54a'));
  }
  const swayC = Math.round(Math.sin(t + 0.45 * 4) * 0.45 * 1.6);
  const cx = 12 + swayC;
  for (let y = 0; y < 11; y++) {
    const half = y < 6 ? 4 : 4 - (y - 5) * 0.8;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
      pc.set(x, 17 + y, y === 0 ? hex('#f2d47a') : hex('#d9b14a'));
  }
  pc.set(cx, 20, hex('#7a2f3a'));
  pc.fillRect(cx - 1, 21, 3, 1, hex('#7a2f3a'));
  pc.set(cx, 22, hex('#7a2f3a'));
  pc.outline(OUTLINE);
  return pc;
}

/** 16×16 gold coin icon (drops and the wallet). */
export function generateCoinIcon(): PixelCanvas {
  const pc = new PixelCanvas(16, 16);
  pc.fillCircle(8.5, 9, 5.2, hex('#b5822a'));
  pc.fillCircle(7.8, 8.3, 4.6, hex('#e3b341'));
  pc.fillCircle(7.3, 7.6, 2.4, hex('#f7d774'));
  pc.fillRect(7, 6, 2, 5, hex('#c99332'));
  pc.set(5, 5, hex('#fff6c8'));
  // A second coin peeking behind for a "pile" read.
  pc.fillEllipse(11, 12.5, 3, 1.6, hex('#c99332'));
  pc.outline(OUTLINE);
  return pc;
}
