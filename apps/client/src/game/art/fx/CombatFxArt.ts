/**
 * Combat effect sprites: projectiles, weapon trails, impacts, skill effects and damage digits.
 * White/neutral effects are tinted at runtime (per job or element); colored ones are baked.
 */
import { type Color, hex, mix, shade, withAlpha } from '../color';
import { selOut, shadedBlob, softDisc, stroke } from '../monsters/paint';
import { PixelCanvas } from '../PixelCanvas';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';

const WHITE = hex('#ffffff');

function arrow(charged: boolean): PixelCanvas {
  const pc = new PixelCanvas(charged ? 17 : 13, charged ? 5 : 3);
  const y = charged ? 2 : 1;
  const shaft = charged ? hex('#ffe9a8') : hex('#b07a4c');
  for (let x = 2; x < pc.width - 3; x++) pc.set(x, y, shaft);
  // Fletching.
  pc.set(0, y - 1, hex('#e8e0d0'));
  pc.set(1, y - 1, hex('#e8e0d0'));
  pc.set(0, y + 1, hex('#c9c0b0'));
  pc.set(1, y + 1, hex('#c9c0b0'));
  pc.set(1, y, hex('#e8e0d0'));
  // Head.
  const tip = pc.width - 1;
  pc.set(tip, y, hex('#f2f5fa'));
  pc.set(tip - 1, y, hex('#c3cbda'));
  pc.set(tip - 2, y, hex('#8790a6'));
  pc.set(tip - 2, y - 1, hex('#8790a6'));
  pc.set(tip - 2, y + 1, hex('#8790a6'));
  if (charged) {
    for (let x = 0; x < 8; x++) pc.blend(x, y, withAlpha(hex('#fff2b0'), 200 - x * 20));
    pc.set(tip - 3, y - 1, hex('#fff2b0'));
    pc.set(tip - 3, y + 1, hex('#fff2b0'));
  }
  return pc;
}

function orb(size: number, core: Color, edge: Color, phase: number, ring = false): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const c = size / 2;
  softDisc(pc, c, c, c, edge, 150);
  const r = size * 0.26 + Math.sin(phase * Math.PI * 2) * 0.5;
  pc.fillCircle(c - 0.5, c - 0.5, r, edge);
  pc.fillCircle(c - 0.5, c - 0.5, r * 0.6, core);
  pc.set(Math.floor(c - r * 0.4), Math.floor(c - r * 0.5), WHITE);
  if (ring) {
    for (let i = 0; i < 8; i++) {
      const a = phase * Math.PI * 2 + (i / 8) * Math.PI * 2;
      pc.blend(
        Math.round(c - 0.5 + Math.cos(a) * (c - 1.5)),
        Math.round(c - 0.5 + Math.sin(a) * (c - 1.5)),
        withAlpha(core, 220),
      );
    }
  }
  return pc;
}

function fireball(phase: number): PixelCanvas {
  const pc = new PixelCanvas(16, 14);
  softDisc(pc, 9, 7, 8, hex('#ff8a3d'), 160);
  // Trailing tongues to the left.
  for (let i = 0; i < 5; i++) {
    const x = 7 - i * 1.4;
    const y = 7 + Math.sin(phase * 6.28 + i * 1.3) * 1.2;
    pc.fillCircle(x, y, 3 - i * 0.5, withAlpha(mix(hex('#ff5a2a'), hex('#ffb347'), i / 5), 230));
  }
  pc.fillCircle(10, 7, 3.6, hex('#ff9a3c'));
  pc.fillCircle(10.5, 6.5, 2.2, hex('#ffe08a'));
  pc.set(10, 5, WHITE);
  return pc;
}

function wispFire(phase: number): PixelCanvas {
  const pc = new PixelCanvas(12, 12);
  softDisc(pc, 6, 6, 6, hex('#4a7dff'), 160);
  pc.fillCircle(6, 6.5, 3.2, hex('#5fa8ff'));
  pc.fillCircle(6 + Math.sin(phase * 6.28) * 0.6, 5.5, 1.8, hex('#d8f0ff'));
  pc.set(6, 2 + (Math.round(phase * 2) % 2), withAlpha(hex('#8fc6ff'), 200));
  return pc;
}

function kunai(): PixelCanvas {
  const pc = new PixelCanvas(10, 5);
  for (let x = 3; x < 9; x++) pc.set(x, 2, hex('#aab3c6'));
  pc.set(9, 2, hex('#f2f5fa'));
  pc.set(7, 1, hex('#6b7182'));
  pc.set(7, 3, hex('#6b7182'));
  pc.set(8, 1, hex('#8790a6'));
  pc.set(8, 3, hex('#8790a6'));
  pc.set(2, 2, hex('#3a2f3f'));
  pc.set(1, 2, hex('#5a3f5a'));
  pc.set(0, 1, hex('#7bd35a'));
  pc.set(0, 3, hex('#7bd35a'));
  return pc;
}

function pebble(): PixelCanvas {
  const pc = new PixelCanvas(6, 6);
  shadedBlob(pc, 3, 3, 2.4, 2.2, { ramp: [hex('#4a4f5c'), hex('#7b8498'), hex('#a8b0c0')] });
  selOut(pc, 0.5);
  return pc;
}

function boulder(
  r = hex('#5d6374'),
  rim = hex('#ffb070'),
  crack = hex('#ff9a3c'),
  cracks = 1,
): PixelCanvas {
  const pc = new PixelCanvas(20, 20);
  shadedBlob(pc, 10, 10, 8, 7.5, {
    ramp: [shade(r, -0.6), shade(r, -0.3), r, shade(r, 0.3), shade(r, 0.5)],
    power: 3,
    facet: 4,
    rim,
  });
  pc.set(8, 11, crack);
  pc.set(9, 12, crack);
  if (cracks > 1) {
    for (const [x, y] of [
      [12, 7],
      [13, 8],
      [11, 13],
      [6, 8],
      [10, 9],
    ] as const)
      pc.set(x, y, crack);
  }
  selOut(pc, 0.55);
  return pc;
}

function stalactite(r = hex('#6b7182'), tip: Color | null = null): PixelCanvas {
  const pc = new PixelCanvas(10, 20);
  for (let y = 0; y < 19; y++) {
    const w = Math.max(0, 4 - Math.floor(y / 4.5));
    for (let x = -w; x <= w; x++) {
      const c = x < 0 ? shade(r, 0.25) : x > 0 ? shade(r, -0.3) : r;
      pc.set(5 + x, y, tip && y > 13 ? mix(c, tip, (y - 13) / 6) : c);
    }
  }
  selOut(pc, 0.55);
  return pc;
}

/** A falling burning rock with a flame trail above it. */
function meteor(): PixelCanvas {
  const pc = new PixelCanvas(14, 22);
  for (let i = 0; i < 6; i++)
    pc.fillCircle(
      7 + Math.sin(i * 1.7) * 0.8,
      4 + i * 1.6,
      1.2 + i * 0.45,
      withAlpha(mix(hex('#ffe08a'), hex('#ff5a2a'), i / 6), 120 + i * 20),
    );
  shadedBlob(pc, 7, 16, 4.6, 4.4, {
    ramp: [hex('#2a2024'), hex('#4a3a3c'), hex('#6a5450')],
    rim: hex('#ff8a3c'),
    facet: 3,
  });
  pc.set(6, 16, hex('#ffb05a'));
  pc.set(8, 17, hex('#ff7a2c'));
  selOut(pc, 0.5);
  return pc;
}

/** Homing frost shard: a spinning crystal in a pale halo. */
function iceShard(phase: number): PixelCanvas {
  const pc = new PixelCanvas(12, 12);
  softDisc(pc, 6, 6, 6, hex('#9fdcff'), 150);
  const a = phase * Math.PI;
  for (let i = -4; i <= 4; i++) {
    const w = Math.max(0, 1.6 - Math.abs(i) * 0.35);
    const x = 6 + Math.cos(a) * i;
    const y = 6 + Math.sin(a) * i;
    pc.fillCircle(x - 0.5, y - 0.5, w, i < 0 ? hex('#c8f0ff') : hex('#7fc8ff'));
  }
  pc.set(6, 5, WHITE);
  return pc;
}

function shockwave(
  f: number,
  c0 = hex('#ff9a3c'),
  c1 = hex('#ffe08a'),
  speck = hex('#8a8f9c'),
): PixelCanvas {
  const pc = new PixelCanvas(20, 18);
  const h = 6 + f * 4;
  for (let i = 0; i < 9; i++) {
    const x = 3 + i * 1.6;
    const top = 17 - h * Math.sin((i / 8) * Math.PI);
    stroke(pc, x, 17, x, top, 0.7, withAlpha(mix(c0, c1, i / 9), 220 - f * 40));
  }
  for (let i = 0; i < 6; i++) pc.set(2 + i * 3, 17 - ((i * 7 + f * 3) % 5) - 6, speck);
  return pc;
}

/** Crescent slash arc facing right; `t` 0..1 animates sweep and fade. */
function slash(size: number, t: number, thickness: number, sweep: number): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const c = size / 2;
  const outer = c - 1;
  const inner = outer - thickness * (1 - t * 0.5);
  const a0 = -sweep / 2 - 0.3 + t * 0.3;
  const a1 = a0 + sweep * Math.min(1, 0.55 + t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d > outer || d < inner) continue;
      const a = Math.atan2(dy, dx);
      if (a < a0 || a > a1) continue;
      const along = (a - a0) / (a1 - a0);
      const edge = (d - inner) / (outer - inner);
      const alpha = Math.round(255 * (1 - t) * Math.pow(along, 0.7) * (0.45 + 0.55 * edge));
      if (alpha <= 8) continue;
      const col = edge > 0.7 ? WHITE : mix(hex('#c8d8ff'), WHITE, edge);
      pc.set(x, y, withAlpha(col, Math.min(255, alpha)));
    }
  }
  return pc;
}

function ring(size: number, t: number, color: Color, width = 2): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const c = size / 2;
  const r = (c - 1) * (0.35 + t * 0.65);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (Math.abs(d - r) <= width * (1 - t * 0.5))
        pc.set(x, y, withAlpha(color, Math.round(240 * (1 - t))));
    }
  }
  return pc;
}

function burst(size: number, t: number, rays: number, color: Color): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const c = size / 2;
  const len = (c - 1) * (0.5 + t * 0.5);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + 0.3;
    const l = i % 2 === 0 ? len : len * 0.6;
    for (let k = Math.floor(l * t * 0.6); k < l; k++) {
      pc.set(
        Math.round(c - 0.5 + Math.cos(a) * k),
        Math.round(c - 0.5 + Math.sin(a) * k),
        withAlpha(k < l * 0.5 ? WHITE : color, Math.round(255 * (1 - t * 0.7))),
      );
    }
  }
  if (t < 0.5) pc.fillCircle(c - 0.5, c - 0.5, 2.5 * (1 - t), WHITE);
  return pc;
}

function explosion(t: number): PixelCanvas {
  const pc = new PixelCanvas(48, 48);
  const r = 7 + t * 16;
  softDisc(pc, 24, 24, r + 8, hex('#ff8a3d'), Math.round(170 * (1 - t)));
  const fire = [hex('#fff6c0'), hex('#ffd36b'), hex('#ff9a3c'), hex('#e0442a')];
  // Billowing flame lobes.
  for (let i = 0; i < 10; i++) {
    const a = i * 0.63 + t;
    const d = r * (0.45 + (i % 3) * 0.12);
    const rr = (5.5 - t * 3) * (i % 2 ? 0.8 : 1);
    const k = Math.min(3, Math.floor(t * 4 + (i % 2) * 0.5));
    pc.fillCircle(
      24 + Math.cos(a) * d,
      24 + Math.sin(a) * d * 0.85,
      rr,
      withAlpha(fire[k] ?? 0, Math.round(250 * (1 - t * 0.7))),
    );
  }
  const core = r * 0.55 * (1 - t);
  if (core > 0.8) {
    pc.fillCircle(24, 24, core, withAlpha(hex('#ffd36b'), 245));
    pc.fillCircle(24, 24, core * 0.6, withAlpha(hex('#fffbe6'), 250));
  }
  if (t > 0.5) {
    for (let i = 0; i < 7; i++) {
      pc.fillCircle(
        24 + Math.cos(i * 0.9) * r * 0.9,
        24 - 4 + Math.sin(i * 0.9) * r * 0.7,
        3,
        withAlpha(hex('#5a5260'), Math.round(170 * (1 - t))),
      );
    }
  }
  return pc;
}

function frostNova(t: number): PixelCanvas {
  const pc = new PixelCanvas(72, 72);
  const c = 36;
  const r = 10 + t * 25;
  for (let y = 0; y < 72; y++) {
    for (let x = 0; x < 72; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (Math.abs(d - r) < 2.5)
        pc.set(
          x,
          y,
          withAlpha(
            mix(hex('#e6faff'), hex('#7fd0ff'), Math.abs(d - r) / 2.5),
            Math.round(240 * (1 - t * 0.6)),
          ),
        );
      else if (d < r) pc.blend(x, y, withAlpha(hex('#a8e6ff'), Math.round(50 * (1 - t))));
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x0 = c + Math.cos(a) * r * 0.7;
    const y0 = c + Math.sin(a) * r * 0.7;
    stroke(
      pc,
      x0,
      y0,
      c + Math.cos(a) * (r + 4),
      c + Math.sin(a) * (r + 4),
      0.6,
      withAlpha(hex('#ffffff'), Math.round(230 * (1 - t))),
    );
  }
  return pc;
}

function pillar(): PixelCanvas {
  const pc = new PixelCanvas(28, 88);
  for (let y = 0; y < 88; y++) {
    const fade = Math.pow(1 - y / 88, 0.6);
    for (let x = 0; x < 28; x++) {
      const d = Math.abs(x + 0.5 - 14) / 14;
      const a = Math.round(255 * (1 - d * d) * (1 - fade * 0.85));
      if (a > 6) pc.set(x, y, withAlpha(mix(hex('#fff6c0'), hex('#ffd36b'), d), a));
    }
  }
  return pc;
}

function star(): PixelCanvas {
  const pc = new PixelCanvas(5, 5);
  const c = hex('#ffe066');
  for (const [x, y] of [
    [2, 0],
    [1, 1],
    [2, 1],
    [3, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [1, 3],
    [3, 3],
    [0, 4],
    [4, 4],
  ] as const) {
    pc.set(x, y, c);
  }
  pc.set(2, 2, WHITE);
  return pc;
}

function alert(): PixelCanvas {
  const pc = new PixelCanvas(7, 13);
  pc.fillRect(2, 0, 3, 8, hex('#ff5a3c'));
  pc.fillRect(2, 10, 3, 3, hex('#ff5a3c'));
  pc.set(2, 0, hex('#ffb08a'));
  pc.set(2, 1, hex('#ffb08a'));
  pc.outline(hex('#2a0a08'));
  return pc;
}

function marker(t: number): PixelCanvas {
  const pc = new PixelCanvas(36, 8);
  for (let x = 0; x < 36; x++) {
    const d = Math.abs(x + 0.5 - 18) / 18;
    const a = Math.round((200 + t * 55) * (1 - d * d));
    for (let y = 4; y < 8; y++)
      pc.set(
        x,
        y,
        withAlpha(mix(hex('#ff5a3c'), hex('#ffb347'), (y - 4) / 4), Math.max(0, a - (7 - y) * 30)),
      );
  }
  for (let i = 0; i < 5; i++) pc.set(6 + i * 6, 3 - (i % 2), withAlpha(hex('#ffe08a'), 220));
  return pc;
}

function speck(c: Color, size: number): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  pc.fillCircle(size / 2 - 0.5, size / 2 - 0.5, size / 2 - 0.2, c);
  pc.set(Math.floor(size / 2 - 0.5), Math.floor(size / 2 - 0.5), WHITE);
  return pc;
}

// --- Damage digits ------------------------------------------------------------------------------

const DIGITS: Record<string, readonly string[]> = {
  '0': ['.###.', '##.##', '##.##', '##.##', '##.##', '##.##', '.###.'],
  '1': ['..##.', '.###.', '..##.', '..##.', '..##.', '..##.', '.####'],
  '2': ['.###.', '##.##', '...##', '..##.', '.##..', '##...', '#####'],
  '3': ['####.', '...##', '..##.', '...##', '...##', '##.##', '.###.'],
  '4': ['...##', '..###', '.#.##', '##.##', '#####', '...##', '...##'],
  '5': ['#####', '##...', '####.', '...##', '...##', '##.##', '.###.'],
  '6': ['.###.', '##...', '####.', '##.##', '##.##', '##.##', '.###.'],
  '7': ['#####', '...##', '..##.', '..##.', '.##..', '.##..', '.##..'],
  '8': ['.###.', '##.##', '##.##', '.###.', '##.##', '##.##', '.###.'],
  '9': ['.###.', '##.##', '##.##', '.####', '...##', '..##.', '.##..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
};

export const DIGIT_STYLES: Record<
  string,
  { top: string; mid: string; bottom: string; outline: string; scale: number }
> = {
  dmg: { top: '#fff6d0', mid: '#ffc23a', bottom: '#ff7a1e', outline: '#3a1606', scale: 1 },
  crit: { top: '#fff7b0', mid: '#ff8a2a', bottom: '#e0262a', outline: '#2a0408', scale: 2 },
  hurt: { top: '#ffd6f2', mid: '#d45ae0', bottom: '#8a2ab0', outline: '#1e0828', scale: 1 },
  heal: { top: '#eaffd8', mid: '#6ee06a', bottom: '#2fa846', outline: '#062a10', scale: 1 },
  mana: { top: '#dcf2ff', mid: '#5aa8ff', bottom: '#2a5ad8', outline: '#061430', scale: 1 },
  dot: { top: '#e8ffd8', mid: '#b4e070', bottom: '#7aa83a', outline: '#16280a', scale: 1 },
};

export const DIGIT_CHARS = Object.keys(DIGITS);

export function digitFrame(style: string, ch: string): string {
  return `dg_${style}_${ch === '+' ? 'plus' : ch}`;
}

function digit(ch: string, style: string): PixelCanvas {
  const st = DIGIT_STYLES[style];
  const rows = DIGITS[ch];
  if (!st || !rows) throw new Error(`bad digit ${style}/${ch}`);
  const s = st.scale;
  const pc = new PixelCanvas(5 * s + 2, 7 * s + 2);
  const top = hex(st.top);
  const mid = hex(st.mid);
  const bottom = hex(st.bottom);
  for (let y = 0; y < 7 * s; y++) {
    const u = y / (7 * s - 1);
    const c = u < 0.45 ? mix(top, mid, u / 0.45) : mix(mid, bottom, (u - 0.45) / 0.55);
    for (let x = 0; x < 5 * s; x++) {
      if ((rows[Math.floor(y / s)] ?? '')[Math.floor(x / s)] === '#') pc.set(x + 1, y + 1, c);
    }
  }
  pc.outline(hex(st.outline), s > 1);
  return pc;
}

export function generateCombatFxAtlas(): SpriteAtlas {
  const b = new SpriteAtlasBuilder();
  b.add('arrow', arrow(false));
  b.add('arrow_charged', arrow(true));
  b.add('pebble', pebble());
  b.add('kunai', kunai());
  b.add('boulder', boulder());
  b.add('stalactite', stalactite());
  b.add('ice_chunk', boulder(hex('#8fc0e8'), hex('#e4fbff'), hex('#ffffff')));
  b.add('icicle', stalactite(hex('#a8dcff'), hex('#ffffff')));
  b.add('magma_ball', boulder(hex('#3b3438'), hex('#ff8a3c'), hex('#ffb05a'), 3));
  b.add('meteor', meteor());
  for (let i = 0; i < 3; i++) {
    b.add(`magic_bolt_${i}`, orb(10, hex('#e6f2ff'), hex('#6f9cff'), i / 3));
    b.add(`arcane_bolt_${i}`, orb(14, hex('#f2e6ff'), hex('#a77cf0'), i / 3, true));
    b.add(`shockwave_${i}`, shockwave(i / 2));
    b.add(`frost_wave_${i}`, shockwave(i / 2, hex('#7fc8ff'), hex('#f2fbff'), hex('#ffffff')));
    b.add(`lava_wave_${i}`, shockwave(i / 2, hex('#ff4a1c'), hex('#ffd25a'), hex('#3b3438')));
    b.add(`slash_${i}`, slash(48, i / 3, 7, 2.4));
    b.add(`slam_${i}`, slash(60, i / 3, 10, 2.8));
    b.add(`spin_${i}`, slash(76, i / 3, 6, Math.PI * 2 - 0.3));
  }
  for (let i = 0; i < 4; i++) {
    b.add(`fireball_${i}`, fireball(i / 4));
    b.add(`wisp_fire_${i}`, wispFire(i / 4));
    b.add(`ice_shard_${i}`, iceShard(i / 4));
    b.add(`hit_${i}`, burst(20, i / 4, 8, hex('#ffe08a')));
    b.add(`crit_${i}`, burst(30, i / 4, 12, hex('#ff7a3a')));
    b.add(`ring_${i}`, ring(32, i / 4, WHITE));
    b.add(`frost_${i}`, frostNova(i / 4));
  }
  for (let i = 0; i < 2; i++) {
    b.add(
      `thrust_${i}`,
      (() => {
        const pc = new PixelCanvas(36, 10);
        for (let x = 0; x < 36; x++) {
          const a = Math.round(255 * (x / 36) * (1 - i * 0.55));
          const h = x > 26 ? 1 : 2;
          for (let y = 5 - h; y <= 4 + h; y++)
            pc.set(x, y, withAlpha(y === 4 || y === 5 ? WHITE : hex('#c8d8ff'), a));
        }
        return pc;
      })(),
    );
    b.add(`marker_${i}`, marker(i));
  }
  for (let i = 0; i < 5; i++) b.add(`explode_${i}`, explosion(i / 5));
  b.add('pillar', pillar());
  b.add('star', star());
  b.add('alert', alert());
  b.add('bubble', speck(hex('#7bd35a'), 4));
  b.add('ember', speck(hex('#ff8a3d'), 3));
  b.add('snow', speck(hex('#c8f0ff'), 4));
  b.add('mote', speck(hex('#ffe9a8'), 3));
  for (const style of Object.keys(DIGIT_STYLES))
    for (const ch of DIGIT_CHARS) b.add(digitFrame(style, ch), digit(ch, style));
  return b.build(512);
}
