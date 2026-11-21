/**
 * 16×16 icons for combat items. Weapons are drawn along the bottom-left → top-right diagonal
 * (grip at the bottom-left) so the held-item renderer can rotate them like tools.
 */
import type { ItemDef } from '@world/shared';
import { type Color, hex, mix, shade, withAlpha } from '../color';
import { shadedBlob, softDisc, stroke } from '../monsters/paint';
import { PixelCanvas } from '../PixelCanvas';

const S = 16;
const OUTLINE = hex('#1a1214');
const WOOD = ['#3e2618', '#6b4530', '#8c5d3c', '#b07a4c'].map((c) => hex(c));

const MATERIAL: Record<string, Color[]> = {
  wood: ['#5a3a22', '#8c5d3c', '#b07a4c', '#d9a86a'].map((c) => hex(c)),
  worn: ['#3d4250', '#6a7182', '#9aa1b0', '#c8cdd6'].map((c) => hex(c)),
  copper: ['#5a2a14', '#a4532a', '#d9803f', '#f6b871'].map((c) => hex(c)),
  iron: ['#3a3f4f', '#8790a6', '#c3cbda', '#f2f5fa'].map((c) => hex(c)),
  cloth: ['#3a3a2a', '#5e6a3c', '#86955a', '#b4c27e'].map((c) => hex(c)),
  silver: ['#4a5260', '#a8b4c4', '#dfe6f0', '#ffffff'].map((c) => hex(c)),
  gold: ['#5a3a08', '#c8901c', '#f2c84b', '#fff2a8'].map((c) => hex(c)),
  frostite: ['#1a3a5a', '#3a9ad4', '#6fd4ff', '#d4f6ff'].map((c) => hex(c)),
  magmite: ['#5a1a08', '#c84a14', '#ff7a3a', '#ffd08a'].map((c) => hex(c)),
  crystal: ['#3a1a5a', '#8a4ad4', '#c58cff', '#f4e0ff'].map((c) => hex(c)),
  obsidian: ['#120c1c', '#281c44', '#4a3a7a', '#8a7ac4'].map((c) => hex(c)),
};

function outlined(pc: PixelCanvas): PixelCanvas {
  const o = pc.clone();
  o.outline(OUTLINE);
  o.blit(pc, 0, 0);
  return o;
}

function materialOf(id: string): Color[] {
  const key = id.split('_')[0] ?? '';
  if (key === 'training' || key === 'oak') return MATERIAL.wood ?? [];
  if (key === 'traveler') return MATERIAL.cloth ?? [];
  return MATERIAL[key] ?? MATERIAL.worn ?? [];
}

function sword(blade: Color[], dagger: boolean): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  // Grip and pommel.
  pc.set(1, 14, hex('#c9a45a'));
  pc.set(2, 13, WOOD[1] ?? 0);
  pc.set(3, 12, WOOD[2] ?? 0);
  // Guard across the diagonal.
  for (let i = -2; i <= 2; i++) pc.set(4 + i, 11 + i, i === 0 ? hex('#e6c46a') : hex('#c9a45a'));
  const len = dagger ? 6 : 9;
  for (let i = 0; i < len; i++) {
    const x = 5 + i;
    const y = 10 - i;
    pc.set(x, y, blade[3] ?? 0);
    pc.set(x + 1, y, blade[2] ?? 0);
    pc.set(x, y + 1, blade[1] ?? 0);
  }
  pc.set(5 + len, 10 - len, blade[3] ?? 0);
  return outlined(pc);
}

function staff(gem: Color, head: Color[] | null): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  for (let i = 0; i < 10; i++) {
    pc.set(1 + i, 14 - i, WOOD[2] ?? 0);
    pc.set(2 + i, 14 - i, WOOD[1] ?? 0);
  }
  if (head) {
    pc.set(10, 3, head[2] ?? 0);
    pc.set(13, 6, head[2] ?? 0);
    pc.set(11, 2, head[3] ?? 0);
    pc.set(14, 5, head[1] ?? 0);
  } else {
    // Leafy wooden crook.
    pc.set(10, 3, hex('#62b552'));
    pc.set(14, 6, hex('#43904a'));
    pc.set(9, 4, hex('#9ad66a'));
  }
  softDisc(pc, 12.5, 3.5, 4, gem, 150);
  pc.fillCircle(12.5, 3.5, 1.9, gem);
  pc.set(12, 3, hex('#ffffff'));
  return outlined(pc);
}

function bow(limb: Color[]): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  // Limbs along the anti-diagonal bulging toward the top-right; string straight.
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const bx = 2 + t * 11;
    const by = 2 + t * 11;
    const bulge = Math.sin(t * Math.PI) * 3.2;
    const x = Math.round(bx + bulge * 0.7);
    const y = Math.round(by - bulge * 0.7);
    pc.set(x, y, (t > 0.4 && t < 0.6 ? WOOD[0] : limb[2]) ?? 0);
    pc.set(x + 1, y, limb[1] ?? 0);
  }
  for (let i = 0; i <= 11; i++) pc.set(2 + i, 3 + i, withAlpha(hex('#e8e0d0'), 230));
  return outlined(pc);
}

function helmet(m: Color[], cloth: boolean): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  shadedBlob(pc, 8, 9, 6, 6, { ramp: m, clipBottom: 10, power: cloth ? 2 : 2.6 });
  if (cloth) {
    // Hood drape.
    for (let y = 10; y <= 13; y++)
      for (let x = 2 + (y - 10); x <= 13 - (y - 10) * 0.2; x++) pc.set(x, y, m[1] ?? 0);
    pc.fillRect(5, 9, 6, 3, hex('#2a2018'));
  } else {
    for (let x = 2; x <= 13; x++) pc.set(x, 10, m[0] ?? 0);
    pc.fillRect(5, 11, 2, 3, m[1] ?? 0);
    pc.fillRect(9, 11, 2, 3, m[1] ?? 0);
    pc.set(8, 4, m[3] ?? 0);
  }
  return outlined(pc);
}

function chest(m: Color[], cloth: boolean): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  shadedBlob(pc, 8, 8, 6, 6.5, { ramp: m, power: 3 });
  // Shoulders and neck.
  pc.fillRect(1, 3, 3, 4, m[2] ?? 0);
  pc.fillRect(12, 3, 3, 4, m[1] ?? 0);
  for (let x = 6; x <= 9; x++) pc.set(x, 2, 0);
  if (cloth) {
    for (let y = 4; y <= 13; y++) pc.set(8, y, shade(m[1] ?? 0, -0.3));
    pc.set(7, 9, hex('#c9a45a'));
  } else {
    for (let x = 4; x <= 11; x++) pc.set(x, 8, m[0] ?? 0);
    pc.set(6, 5, m[3] ?? 0);
  }
  return outlined(pc);
}

function boots(m: Color[]): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  for (const ox of [1, 8]) {
    pc.fillRect(ox + 1, 4, 4, 7, m[2] ?? 0);
    pc.fillRect(ox + 1, 11, 6, 3, m[1] ?? 0);
    pc.set(ox + 1, 4, m[3] ?? 0);
    for (let x = ox + 1; x < ox + 7; x++) pc.set(x, 13, m[0] ?? 0);
  }
  return outlined(pc);
}

function potion(liquid: Color): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  const glass = hex('#d8e6f0');
  pc.fillRect(6, 2, 4, 2, hex('#8c5d3c'));
  pc.fillRect(6, 4, 4, 3, withAlpha(glass, 180));
  pc.fillCircle(7.5, 10, 4.6, withAlpha(glass, 170));
  shadedBlob(pc, 7.5, 10.5, 4, 3.6, {
    ramp: [shade(liquid, -0.45), liquid, shade(liquid, 0.3)],
    clipBottom: 14,
  });
  pc.set(5, 8, hex('#ffffff'));
  pc.set(5, 9, withAlpha(hex('#ffffff'), 180));
  return outlined(pc);
}

function blobIcon(
  base: Color,
  spec: Color,
  shape: 'gel' | 'shell' | 'core',
  accent = hex('#e47a48'),
  rockColor = hex('#5d6374'),
): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  if (shape === 'gel') {
    shadedBlob(pc, 8, 10, 6, 4.5, {
      ramp: [shade(base, -0.45), base, shade(base, 0.3)],
      spec,
      clipBottom: 13,
    });
    pc.set(8, 5, base);
    pc.set(8, 4, shade(base, 0.2));
  } else if (shape === 'shell') {
    shadedBlob(pc, 8, 8, 6.5, 5, {
      ramp: [shade(base, -0.5), base, shade(base, 0.3)],
      spec,
      power: 2.4,
    });
    for (let x = 3; x <= 13; x += 3) pc.set(x, 4, accent);
    for (let x = 3; x <= 13; x++) pc.set(x, 9, shade(base, -0.55));
  } else {
    const rock = rockColor;
    shadedBlob(pc, 8, 9, 6.5, 5.5, {
      ramp: [shade(rock, -0.5), rock, shade(rock, 0.3)],
      power: 3,
      facet: 4,
    });
    softDisc(pc, 8, 8, 5, base, 170);
    for (let dy = -3; dy <= 3; dy++) {
      const w = 2 - Math.floor(Math.abs(dy) * 0.6);
      for (let dx = -w; dx <= w; dx++) pc.set(8 + dx, 8 + dy, dx < 0 && dy < 0 ? spec : base);
    }
  }
  return outlined(pc);
}

function feather(): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  for (let i = 0; i < 11; i++) {
    const x = 3 + i;
    const y = 13 - i;
    pc.set(x, y, hex('#f0e0c0'));
    const w = Math.min(i, 10 - i) * 0.35 + 1;
    for (let k = 1; k <= w; k++) {
      pc.set(x - k, y - k + 1, hex('#a07850'));
      pc.set(x + k - 1, y + k, hex('#6e5238'));
    }
  }
  return outlined(pc);
}

function fang(tip: Color, root: Color): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  for (let y = 2; y <= 13; y++) {
    const w = Math.max(0, 3 - Math.floor((y - 2) / 4));
    const bend = Math.round(((y - 2) / 11) ** 2 * 3);
    for (let x = -w; x <= w; x++) pc.set(6 + x + bend, y, mix(root, tip, (y - 2) / 11));
  }
  return outlined(pc);
}

function wing(): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  const mem = hex('#4a3a5e');
  const bone = hex('#7d6a92');
  for (let i = 0; i < 4; i++) {
    const tx = 3 + i * 3.2;
    const ty = 3 + Math.abs(i - 1.5) * 1.5;
    for (let s = 0; s <= 16; s++) {
      const u = s / 16;
      const nx = 3 + (i + 1) * 3.2;
      stroke(pc, 2, 13, tx + (nx - tx) * u, ty + 6 * u, 0.4, shade(mem, u * 0.2));
    }
    stroke(pc, 2, 13, tx, ty, 0.4, bone);
  }
  return outlined(pc);
}

function ember(): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  softDisc(pc, 8, 9, 7, hex('#4a7dff'), 140);
  pc.fillEllipse(8, 10, 3.6, 3.4, hex('#5fa8ff'));
  pc.fillEllipse(8.5, 7, 2, 2.6, hex('#8fc6ff'));
  pc.fillEllipse(8, 10, 1.8, 1.6, hex('#e6f6ff'));
  pc.set(9, 3, hex('#8fc6ff'));
  return outlined(pc);
}

/** Rings: band metal and gem colours. */
const RINGS: Record<string, [string, string, string, string]> = {
  corestone_ring: ['#c3cbda', '#8790a6', '#ff9a3c', '#ffe08a'],
  gold_ring: ['#f2c84b', '#c8901c', '#e0444a', '#ffc0c0'],
  magma_ring: ['#4a3a7a', '#281c44', '#ff6a1c', '#ffd25a'],
};

/** Pendants on a cord: gem colours. */
const PENDANTS: Record<string, [string, string, string]> = {
  frost_amulet: ['#9fdcff', '#3a9ad4', '#ffffff'],
  crystal_pendant: ['#c58cff', '#8a4ad4', '#f4e0ff'],
};

function accessory(id: string): PixelCanvas {
  const pc = new PixelCanvas(S, S);
  const cord = hex('#8c6a4a');
  const ring = RINGS[id];
  if (ring) {
    const [hi, lo, gem, spark] = ring.map((c) => hex(c)) as [Color, Color, Color, Color];
    for (let a = 0; a < 24; a++) {
      const t = (a / 24) * Math.PI * 2;
      pc.set(
        Math.round(8 + Math.cos(t) * 4.5),
        Math.round(10 + Math.sin(t) * 3.5),
        a < 12 ? hi : lo,
      );
    }
    softDisc(pc, 8, 5, 4, gem, 160);
    pc.fillCircle(8, 5, 2.2, gem);
    pc.set(7, 4, spark);
    return outlined(pc);
  }
  const pendant = PENDANTS[id];
  if (pendant) {
    const [gem, dark, spark] = pendant.map((c) => hex(c)) as [Color, Color, Color];
    for (let x = 2; x <= 13; x++)
      pc.set(x, Math.round(2 + Math.pow((x - 7.5) / 5.5, 2) * -2 + 2), hex('#c3cbda'));
    softDisc(pc, 8, 10, 5, gem, 140);
    for (let dy = -4; dy <= 4; dy++) {
      const w = 3 - Math.floor(Math.abs(dy) * 0.7);
      for (let dx = -w; dx <= w; dx++) pc.set(8 + dx, 10 + dy, dx < 0 ? gem : dark);
    }
    pc.set(7, 8, spark);
    return outlined(pc);
  }
  // Pendants on a cord.
  for (let x = 2; x <= 13; x++)
    pc.set(x, Math.round(2 + Math.pow((x - 7.5) / 5.5, 2) * -2 + 2), cord);
  if (id === 'thorn_charm') {
    shadedBlob(pc, 8, 10, 4, 4, {
      ramp: [hex('#2a4a34'), hex('#3f6b4f'), hex('#6fa070')],
      power: 2.4,
    });
    pc.set(8, 6, hex('#e47a48'));
    pc.set(5, 8, hex('#e47a48'));
    pc.set(11, 8, hex('#e47a48'));
  } else if (id === 'bat_brooch') {
    stroke(pc, 8, 10, 3, 7, 0.6, hex('#4a3a5e'));
    stroke(pc, 8, 10, 13, 7, 0.6, hex('#4a3a5e'));
    stroke(pc, 8, 10, 4, 11, 0.6, hex('#5d4b72'));
    stroke(pc, 8, 10, 12, 11, 0.6, hex('#5d4b72'));
    pc.fillCircle(8, 10, 1.8, hex('#ffb347'));
  } else {
    softDisc(pc, 8, 10, 5, hex('#4a7dff'), 160);
    pc.fillCircle(8, 10, 3, hex('#5fa8ff'));
    pc.fillCircle(7.5, 9.5, 1.4, hex('#e6f6ff'));
  }
  return outlined(pc);
}

const STAFF_GEMS: Record<string, string> = {
  silver_staff: '#7fe0ff',
  frostite_staff: '#e4fbff',
  magmite_staff: '#ffd25a',
  crystal_staff: '#ff8af0',
};

/** Icon for a combat item, or null when the item is not a combat item. */
export function gearIcon(def: ItemDef): PixelCanvas | null {
  const id = def.id;
  const m = materialOf(id);
  if (def.weapon) {
    switch (def.weapon.type) {
      case 'sword':
        return sword(m, false);
      case 'dagger':
        return sword(m, true);
      case 'bow':
        return bow(id.startsWith('oak') ? (MATERIAL.wood ?? []) : m);
      case 'staff': {
        const gem = STAFF_GEMS[id];
        if (gem) return staff(hex(gem), m);
        return staff(
          id === 'ember_staff'
            ? hex('#5fa8ff')
            : id === 'iron_staff'
              ? hex('#b07ce0')
              : hex('#9df07a'),
          id === 'oak_staff'
            ? null
            : id === 'ember_staff'
              ? (MATERIAL.copper ?? [])
              : (MATERIAL.iron ?? []),
        );
      }
    }
  }
  if (def.equip) {
    const cloth = id.startsWith('traveler');
    switch (def.equip.category) {
      case 'head':
        return helmet(m, cloth);
      case 'body':
        return chest(m, cloth);
      case 'feet':
        return boots(m);
      case 'accessory':
        return accessory(id);
    }
  }
  switch (id) {
    case 'healing_potion':
      return potion(hex('#e0444a'));
    case 'mana_potion':
      return potion(hex('#3a7cf0'));
    case 'golem_heart':
      return blobIcon(hex('#ff9a3c'), hex('#ffe08a'), 'core');
    case 'corestone':
      return blobIcon(mix(hex('#ff9a3c'), hex('#ffb347'), 0.4), hex('#fff2b0'), 'core');
    case 'slime_gel':
      return blobIcon(hex('#6fd890'), hex('#f4fff8'), 'gel');
    case 'beetle_shell':
      return blobIcon(hex('#3f6b4f'), hex('#d9f2c4'), 'shell');
    case 'bat_wing':
      return wing();
    case 'wisp_ember':
      return ember();
    case 'crab_shell':
      return blobIcon(hex('#e0603c'), hex('#fff0e0'), 'shell', hex('#ffb08a'));
    case 'ash_carapace':
      return blobIcon(hex('#3d3a40'), hex('#ffb05a'), 'shell', hex('#ff7a2c'));
    case 'tyrant_scale':
      return blobIcon(hex('#2a2024'), hex('#ffd25a'), 'shell', hex('#ff3018'));
    case 'ice_gel':
      return blobIcon(hex('#9fdcff'), hex('#ffffff'), 'gel');
    case 'magma_core':
      return blobIcon(hex('#ff6a1c'), hex('#ffd25a'), 'core', undefined, hex('#3b3438'));
    case 'frost_core':
      return blobIcon(hex('#5fd0ff'), hex('#e4fbff'), 'core', undefined, hex('#7d9cc0'));
    case 'frost_sigil':
      return blobIcon(hex('#7fe0ff'), hex('#ffffff'), 'core', undefined, hex('#c8dcf0'));
    case 'ember_sigil':
      return blobIcon(hex('#ff3018'), hex('#ffd25a'), 'core', undefined, hex('#281c44'));
    case 'harpy_feather':
      return feather();
    case 'frost_fang':
      return fang(hex('#e8f4ff'), hex('#9fbcd8'));
    case 'imp_horn':
      return fang(hex('#e8d8b0'), hex('#8a2a1e'));
  }
  return null;
}
