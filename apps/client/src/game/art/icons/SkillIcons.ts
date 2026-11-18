/**
 * Skill and status icons: a beveled frame in the skill's accent color with a pictogram.
 * Rendered to data URLs for the DOM UI. Hand-drawn icons can replace them per id.
 */
import { SKILL_DEFS, STATUS_DEFS } from '@world/shared';
import { type Color, hex, mix, shade, withAlpha } from '../color';
import { stroke } from '../monsters/paint';
import { PixelCanvas } from '../PixelCanvas';

const INK = hex('#fff6e0');

type Glyph = (pc: PixelCanvas, ox: number, oy: number, c: Color) => void;

const line = (
  pc: PixelCanvas,
  ox: number,
  oy: number,
  pts: [number, number][],
  c: Color,
  r = 0.6,
) => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i] ?? [0, 0];
    const [bx, by] = pts[i + 1] ?? [0, 0];
    stroke(pc, ox + ax, oy + ay, ox + bx, oy + by, r, c);
  }
};

const GLYPHS: Record<string, Glyph> = {
  heart: (pc, ox, oy, c) => {
    pc.fillCircle(ox + 5, oy + 6, 3, c);
    pc.fillCircle(ox + 10, oy + 6, 3, c);
    for (let y = 6; y < 14; y++)
      for (let x = 2 + (y - 6); x <= 13 - (y - 6); x++) pc.set(ox + x, oy + y, c);
  },
  pebble: (pc, ox, oy, c) => {
    pc.fillEllipse(ox + 8, oy + 9, 5, 4, c);
    line(
      pc,
      ox,
      oy,
      [
        [2, 4],
        [5, 6],
      ],
      c,
      0.5,
    );
    line(
      pc,
      ox,
      oy,
      [
        [3, 1],
        [6, 4],
      ],
      c,
      0.5,
    );
  },
  strike: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [2, 14],
        [13, 2],
      ],
      c,
      1,
    );
    line(
      pc,
      ox,
      oy,
      [
        [6, 3],
        [13, 10],
      ],
      c,
      0.5,
    );
    pc.fillCircle(ox + 12, oy + 3, 2, c);
  },
  spiral: (pc, ox, oy, c) => {
    for (let i = 0; i < 40; i++) {
      const a = i * 0.32;
      const r = 1 + i * 0.16;
      pc.fillCircle(ox + 8 + Math.cos(a) * r, oy + 8 + Math.sin(a) * r, 0.7, c);
    }
  },
  charge: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [1, 8],
        [14, 8],
      ],
      c,
      0.9,
    );
    line(
      pc,
      ox,
      oy,
      [
        [10, 4],
        [14, 8],
        [10, 12],
      ],
      c,
      0.9,
    );
    line(
      pc,
      ox,
      oy,
      [
        [1, 4],
        [6, 4],
      ],
      c,
      0.4,
    );
    line(
      pc,
      ox,
      oy,
      [
        [1, 12],
        [6, 12],
      ],
      c,
      0.4,
    );
  },
  flame: (pc, ox, oy, c) => {
    pc.fillEllipse(ox + 8, oy + 10, 4.5, 4.5, c);
    for (let y = 1; y < 8; y++)
      pc.fillCircle(ox + 8 + Math.sin(y * 0.8) * 1.5, oy + y + 2, (y / 8) * 3.5, c);
  },
  fire: (pc, ox, oy, c) => {
    pc.fillCircle(ox + 9, oy + 8, 4.5, c);
    line(
      pc,
      ox,
      oy,
      [
        [1, 5],
        [6, 7],
      ],
      c,
      0.7,
    );
    line(
      pc,
      ox,
      oy,
      [
        [1, 11],
        [6, 9],
      ],
      c,
      0.7,
    );
    line(
      pc,
      ox,
      oy,
      [
        [2, 8],
        [6, 8],
      ],
      c,
      0.7,
    );
  },
  shield: (pc, ox, oy, c) => {
    for (let y = 2; y < 15; y++) {
      const w = y < 8 ? 6 : Math.max(0, 6 - (y - 8));
      for (let x = 8 - w; x <= 7 + w; x++) pc.set(ox + x, oy + y, c);
    }
  },
  orb: (pc, ox, oy, c) => {
    pc.fillCircle(ox + 8, oy + 8, 4.5, c);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      pc.set(Math.round(ox + 8 + Math.cos(a) * 7), Math.round(oy + 8 + Math.sin(a) * 7), c);
    }
  },
  snow: (pc, ox, oy, c) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      line(
        pc,
        ox,
        oy,
        [
          [8 - Math.cos(a) * 7, 8 - Math.sin(a) * 7],
          [8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7],
        ],
        c,
        0.6,
      );
    }
    pc.fillCircle(ox + 8, oy + 8, 1.5, c);
  },
  blink: (pc, ox, oy, c) => {
    for (const [x, y] of [
      [3, 11],
      [8, 7],
      [13, 3],
    ] as const) {
      pc.fillCircle(ox + x, oy + y, 2.2, c);
    }
    line(
      pc,
      ox,
      oy,
      [
        [1, 14],
        [14, 1],
      ],
      withAlpha(c, 140),
      0.4,
    );
  },
  drop: (pc, ox, oy, c) => {
    pc.fillCircle(ox + 8, oy + 10, 4.5, c);
    for (let y = 2; y < 8; y++) pc.fillCircle(ox + 8, oy + y + 1, (y / 8) * 3.6, c);
  },
  arrows: (pc, ox, oy, c) => {
    for (const dy of [4, 11]) {
      line(
        pc,
        ox,
        oy,
        [
          [1, dy],
          [14, dy],
        ],
        c,
        0.5,
      );
      line(
        pc,
        ox,
        oy,
        [
          [11, dy - 2],
          [14, dy],
          [11, dy + 2],
        ],
        c,
        0.5,
      );
    }
  },
  pierce: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [1, 8],
        [15, 8],
      ],
      c,
      0.7,
    );
    line(
      pc,
      ox,
      oy,
      [
        [11, 5],
        [15, 8],
        [11, 11],
      ],
      c,
      0.6,
    );
    for (const x of [5, 9])
      line(
        pc,
        ox,
        oy,
        [
          [x, 3],
          [x, 13],
        ],
        withAlpha(c, 150),
        0.4,
      );
  },
  rain: (pc, ox, oy, c) => {
    for (const [x, y] of [
      [3, 2],
      [8, 0],
      [13, 3],
      [5, 7],
      [11, 7],
    ] as const) {
      line(
        pc,
        ox,
        oy,
        [
          [x, y],
          [x - 1, y + 6],
        ],
        c,
        0.5,
      );
    }
    line(
      pc,
      ox,
      oy,
      [
        [1, 15],
        [15, 15],
      ],
      c,
      0.5,
    );
  },
  leap: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [13, 13],
        [9, 5],
        [3, 3],
      ],
      c,
      0.6,
    );
    line(
      pc,
      ox,
      oy,
      [
        [3, 3],
        [6, 2],
      ],
      c,
      0.6,
    );
    line(
      pc,
      ox,
      oy,
      [
        [3, 3],
        [4, 6],
      ],
      c,
      0.6,
    );
    line(
      pc,
      ox,
      oy,
      [
        [9, 10],
        [15, 10],
      ],
      withAlpha(c, 170),
      0.5,
    );
  },
  eye: (pc, ox, oy, c) => {
    for (let x = 1; x < 15; x++) {
      const h = Math.sin(((x - 1) / 13) * Math.PI) * 4;
      pc.set(ox + x, Math.round(oy + 8 - h), c);
      pc.set(ox + x, Math.round(oy + 8 + h), c);
    }
    pc.fillCircle(ox + 8, oy + 8, 2.5, c);
  },
  flurry: (pc, ox, oy, c) => {
    for (const y of [3, 7, 11])
      line(
        pc,
        ox,
        oy,
        [
          [2, y + 2],
          [14, y],
        ],
        c,
        0.5,
      );
  },
  kunai: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [2, 14],
        [12, 4],
      ],
      c,
      0.6,
    );
    for (let i = 0; i < 4; i++)
      pc.fillCircle(ox + 12 - i * 0.2, oy + 4 - i * 0.1, 2.4 - i * 0.5, c);
    pc.fillCircle(ox + 2, oy + 14, 1.5, c);
  },
  shadow: (pc, ox, oy, c) => {
    pc.fillCircle(ox + 11, oy + 5, 2.2, c);
    line(
      pc,
      ox,
      oy,
      [
        [11, 7],
        [10, 11],
        [13, 15],
      ],
      c,
      0.7,
    );
    line(
      pc,
      ox,
      oy,
      [
        [10, 11],
        [7, 15],
      ],
      c,
      0.7,
    );
    for (const y of [6, 9, 12])
      line(
        pc,
        ox,
        oy,
        [
          [1, y],
          [6, y],
        ],
        withAlpha(c, 150),
        0.4,
      );
  },
  wing: (pc, ox, oy, c) => {
    for (let i = 0; i < 4; i++)
      line(
        pc,
        ox,
        oy,
        [
          [3, 13],
          [6 + i * 2.6, 2 + i * 2],
        ],
        c,
        0.6,
      );
    line(
      pc,
      ox,
      oy,
      [
        [3, 13],
        [14, 10],
      ],
      c,
      0.6,
    );
  },
  target: (pc, ox, oy, c) => {
    for (let a = 0; a < 32; a++) {
      const t = (a / 32) * Math.PI * 2;
      pc.set(Math.round(ox + 8 + Math.cos(t) * 6), Math.round(oy + 8 + Math.sin(t) * 6), c);
    }
    pc.fillCircle(ox + 8, oy + 8, 1.8, c);
    line(
      pc,
      ox,
      oy,
      [
        [8, 0],
        [8, 4],
      ],
      c,
      0.4,
    );
    line(
      pc,
      ox,
      oy,
      [
        [8, 12],
        [8, 16],
      ],
      c,
      0.4,
    );
    line(
      pc,
      ox,
      oy,
      [
        [0, 8],
        [4, 8],
      ],
      c,
      0.4,
    );
    line(
      pc,
      ox,
      oy,
      [
        [12, 8],
        [16, 8],
      ],
      c,
      0.4,
    );
  },
  star: (pc, ox, oy, c) => {
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
      line(
        pc,
        ox,
        oy,
        [
          [8, 8],
          [8 + Math.cos(a) * 7, 8 + Math.sin(a) * 7],
        ],
        c,
        0.8,
      );
    }
  },
  down: (pc, ox, oy, c) => {
    line(
      pc,
      ox,
      oy,
      [
        [8, 2],
        [8, 13],
      ],
      c,
      0.9,
    );
    line(
      pc,
      ox,
      oy,
      [
        [3, 9],
        [8, 14],
        [13, 9],
      ],
      c,
      0.9,
    );
  },
};

function icon(size: number, color: Color, glyph: string, passive = false): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const dark = shade(color, -0.65);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + y) / (2 * size);
      pc.set(x, y, mix(shade(color, -0.25), shade(color, -0.7), u));
    }
  }
  // Bevel.
  for (let i = 0; i < size; i++) {
    pc.set(i, 0, shade(color, 0.35));
    pc.set(0, i, shade(color, 0.2));
    pc.set(i, size - 1, dark);
    pc.set(size - 1, i, dark);
  }
  if (passive) for (let i = 2; i < size - 2; i += 2) pc.set(i, size - 3, withAlpha(INK, 120));
  const g = GLYPHS[glyph] ?? GLYPHS.star;
  const off = Math.floor((size - 16) / 2);
  const shadow = new PixelCanvas(size, size);
  g?.(shadow, off + 1, off + 1, withAlpha(hex('#000000'), 140));
  pc.blit(shadow, 0, 0);
  g?.(pc, off, off, INK);
  return pc;
}

const STATUS_GLYPH: Record<string, string> = {
  poison: 'drop',
  burn: 'fire',
  slow: 'snow',
  freeze: 'snow',
  stun: 'star',
  weaken: 'down',
  rage: 'flame',
  focus: 'eye',
  haste: 'wing',
  second_wind: 'heart',
  perfect_focus: 'target',
};

export function generateSkillIcons(): Map<string, PixelCanvas> {
  const out = new Map<string, PixelCanvas>();
  for (const s of SKILL_DEFS)
    out.set(s.id, icon(24, hex(s.icon.color), s.icon.glyph, s.type === 'passive'));
  return out;
}

export function generateStatusIcons(): Map<string, PixelCanvas> {
  const out = new Map<string, PixelCanvas>();
  for (const s of STATUS_DEFS) out.set(s.id, icon(16, hex(s.color), STATUS_GLYPH[s.id] ?? 'star'));
  return out;
}

export const SKILL_GLYPHS = Object.keys(GLYPHS);
