import { type Color, hex, mix, shade } from '../color';
import { drawTemplate, PixelCanvas } from '../PixelCanvas';
import type { Appearance } from './appearance';
import { drawBackHair, drawFrontHair, type HairPalette } from './hair';
import {
  ANIMATIONS,
  type AnimationDef,
  FRAME_SIZE,
  frameName,
  type Pose,
  RIG,
  type Vec,
} from './poses';
import { BLINK_PIXELS, EYE_PIXELS, FACE, HEAD, TORSO } from './templates';

export interface CharacterPalette {
  readonly outline: Color;
  readonly skin: Color;
  readonly skinShade: Color;
  readonly blush: Color;
  readonly eyeDark: Color;
  readonly eyeLight: Color;
  readonly iris: Color;
  readonly mouth: Color;
  readonly hair: HairPalette;
  readonly top: Color;
  readonly topShade: Color;
  readonly topLight: Color;
  readonly accent: Color;
  readonly belt: Color;
  readonly buckle: Color;
  readonly pants: Color;
  readonly pantsShade: Color;
  readonly boots: Color;
  readonly bootsLight: Color;
  readonly sole: Color;
  readonly scarf: Color | null;
  readonly scarfShade: Color | null;
}

const OUTLINE = hex('#24172b');

export function buildPalette(a: Appearance): CharacterPalette {
  const skin = hex(a.skin);
  const hair = hex(a.hair);
  const top = hex(a.top);
  const pants = hex(a.pants);
  const boots = hex(a.boots);
  const scarf = a.scarf ? hex(a.scarf) : null;
  return {
    outline: OUTLINE,
    skin,
    skinShade: shade(skin, -0.16),
    blush: mix(skin, hex('#ff7a8a'), 0.35),
    eyeDark: hex('#2a1d33'),
    eyeLight: hex('#ffffff'),
    iris: hex(a.eyes),
    mouth: shade(mix(skin, hex('#c0485a'), 0.5), -0.15),
    hair: { base: hair, shade: shade(hair, -0.3), light: shade(hair, 0.32) },
    top,
    topShade: shade(top, -0.28),
    topLight: shade(top, 0.18),
    accent: hex(a.accent),
    belt: shade(hex('#7a4f32'), -0.1),
    buckle: hex('#e8c860'),
    pants,
    pantsShade: shade(pants, -0.3),
    boots,
    bootsLight: shade(boots, 0.18),
    sole: shade(boots, -0.35),
    scarf,
    scarfShade: scarf ? shade(scarf, -0.3) : null,
  };
}

/** 2-bone IK: returns the joint position bending toward `bendDir` (+1 forward / -1 back). */
function solveJoint(a: Vec, b: Vec, l1: number, l2: number, bendDir: number): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.min(Math.max(Math.hypot(dx, dy), 0.001), l1 + l2 - 0.001);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  // In screen space (y down) a negative rotation bends toward +x for a downward limb.
  const j = base - ang * bendDir;
  return { x: Math.round(a.x + Math.cos(j) * l1), y: Math.round(a.y + Math.sin(j) * l1) };
}

/** Thick line from a to b; width w (centered, biased left for even widths). */
function thickLine(layer: PixelCanvas, a: Vec, b: Vec, w: number, c: Color): void {
  const lo = -Math.floor(w / 2);
  const hi = lo + w - 1;
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(a.x + ((b.x - a.x) * i) / steps);
    const y = Math.round(a.y + ((b.y - a.y) * i) / steps);
    for (let oy = lo; oy <= hi; oy++)
      for (let ox = lo; ox <= hi; ox++) layer.set(x + ox, y + oy, c);
  }
}

/** Darken the right-most pixel of each row of a single-color limb (light comes from the left). */
function shadeRightEdge(layer: PixelCanvas, base: Color, dark: Color): void {
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      if (layer.get(x, y) === base && !layer.isOpaque(x + 1, y)) layer.set(x, y, dark);
    }
  }
}

function drawLeg(
  layer: PixelCanvas,
  hip: Vec,
  ankle: Vec,
  pal: CharacterPalette,
  back: boolean,
): void {
  const knee = solveJoint(hip, ankle, RIG.thigh, RIG.shin, 1);
  const pants = back ? pal.pantsShade : pal.pants;
  const pantsDark = back ? shade(pal.pantsShade, -0.2) : pal.pantsShade;
  thickLine(layer, hip, knee, 4, pants);
  thickLine(layer, knee, { x: ankle.x, y: ankle.y - 1 }, 4, pants);
  shadeRightEdge(layer, pants, pantsDark);
  // Boot: cuff, body with toe forward, sole.
  const boot = back ? shade(pal.boots, -0.15) : pal.boots;
  const cuff = back ? pal.boots : pal.bootsLight;
  const sole = pal.sole;
  const ax = ankle.x;
  const ay = ankle.y;
  for (let x = ax - 2; x <= ax + 1; x++) layer.set(x, ay, cuff);
  for (let x = ax - 2; x <= ax + 2; x++) {
    layer.set(x, ay + 1, boot);
    layer.set(x, ay + 2, boot);
    layer.set(x, ay + 3, sole);
  }
  layer.set(ax + 2, ay + 1, shade(boot, 0.1));
}

function drawArm(
  layer: PixelCanvas,
  shoulder: Vec,
  hand: Vec,
  pal: CharacterPalette,
  back: boolean,
): void {
  const elbow = solveJoint(shoulder, hand, RIG.upperArm, RIG.forearm, -1);
  const sleeve = back ? pal.topShade : pal.top;
  const sleeveDark = back ? shade(pal.topShade, -0.2) : pal.topShade;
  thickLine(layer, shoulder, elbow, 3, sleeve);
  thickLine(layer, elbow, hand, 3, sleeve);
  shadeRightEdge(layer, sleeve, sleeveDark);
  const skin = back ? pal.skinShade : pal.skin;
  // Hand: rounded 3×3.
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (Math.abs(ox) === 1 && Math.abs(oy) === 1 && ox > 0) continue;
      layer.set(hand.x + ox, hand.y + oy + 1, skin);
    }
  }
}

function drawTorso(
  layer: PixelCanvas,
  x: number,
  y: number,
  lean: number,
  pal: CharacterPalette,
): void {
  const keys: Record<string, Color> = {
    c: pal.top,
    d: pal.topShade,
    f: pal.topLight,
    k: pal.accent,
    g: pal.belt,
    b: pal.buckle,
  };
  const rows = TORSO.length;
  for (let r = 0; r < rows; r++) {
    const shift = Math.round(lean * (1 - r / (rows - 1)));
    drawTemplate(layer, [TORSO[r] ?? ''], keys, x + shift, y + r);
  }
}

function drawScarfWrap(
  layer: PixelCanvas,
  x: number,
  y: number,
  lean: number,
  pal: CharacterPalette,
): void {
  if (!pal.scarf || !pal.scarfShade) return;
  const sx = x + lean;
  for (let i = 1; i <= 8; i++) {
    layer.set(sx + i, y, pal.scarf);
    layer.set(sx + i, y + 1, i > 6 ? pal.scarf : pal.scarfShade);
  }
  // Knot at the front.
  layer.set(sx + 8, y + 2, pal.scarf);
  layer.set(sx + 7, y + 2, pal.scarfShade);
  layer.set(sx + 8, y + 3, pal.scarfShade);
}

function drawScarfTail(
  layer: PixelCanvas,
  x: number,
  y: number,
  pose: Pose,
  pal: CharacterPalette,
): void {
  if (!pal.scarf || !pal.scarfShade) return;
  const len = 10;
  const lift = pose.scarfLift;
  for (let i = 0; i <= len; i++) {
    const t = i / len;
    const px = Math.round(x - i * (0.45 + 0.55 * lift) - pose.sway * t);
    const py = Math.round(
      y + i * (1 - lift) * 0.95 + Math.sin(pose.wave + i * 0.8) * lift * 1.2 * t,
    );
    layer.set(px, py, pal.scarf);
    layer.set(px, py + 1, pal.scarfShade);
    if (i === len) layer.set(px - 1, py + 2, pal.scarfShade);
  }
}

function drawHead(
  layer: PixelCanvas,
  x: number,
  y: number,
  blink: boolean,
  pal: CharacterPalette,
): void {
  drawTemplate(layer, HEAD, { s: pal.skin, t: pal.skinShade }, x, y);
  const featureColor: Record<string, Color> = {
    e: pal.eyeDark,
    i: pal.iris,
    w: pal.eyeLight,
    m: pal.mouth,
    r: pal.blush,
  };
  for (const [fx, fy, key] of FACE) {
    if (blink && EYE_PIXELS.some(([ex, ey]) => ex === fx && ey === fy)) continue;
    const c = featureColor[key];
    if (c !== undefined) layer.set(x + fx, y + fy, c);
  }
  if (blink) for (const [bx, by] of BLINK_PIXELS) layer.set(x + bx, y + by, pal.eyeDark);
}

interface Layer {
  canvas: PixelCanvas;
  /** Draw a darkened separation line where this layer overlaps earlier layers. */
  separate: boolean;
}

/** Composite layers back-to-front with internal separation lines, then an external outline. */
function composite(layers: Layer[], outline: Color): PixelCanvas {
  const out = new PixelCanvas(FRAME_SIZE, FRAME_SIZE);
  for (const { canvas, separate } of layers) {
    if (separate) {
      for (let y = 0; y < FRAME_SIZE; y++) {
        for (let x = 0; x < FRAME_SIZE; x++) {
          if (canvas.isOpaque(x, y) || !out.isOpaque(x, y)) continue;
          if (
            canvas.isOpaque(x - 1, y) ||
            canvas.isOpaque(x + 1, y) ||
            canvas.isOpaque(x, y - 1) ||
            canvas.isOpaque(x, y + 1)
          ) {
            out.set(x, y, mix(out.get(x, y), outline, 0.7));
          }
        }
      }
    }
    out.blit(canvas, 0, 0);
  }
  out.outline(outline);
  return out;
}

/** Rasterize one pose into a 48×48 frame. */
export function composeFrame(app: Appearance, pal: CharacterPalette, pose: Pose): PixelCanvas {
  const L = (): PixelCanvas => new PixelCanvas(FRAME_SIZE, FRAME_SIZE);
  const bx = pose.bodyX;
  const by = pose.bodyY;
  const headX = RIG.headX + bx + pose.lean;
  const headY = RIG.headY + by + pose.headY;

  const backHair = L();
  drawBackHair(backHair, app.hairStyle, headX, headY, pose.sway, pal.hair);
  drawScarfTail(backHair, RIG.torsoX + bx + pose.lean + 1, RIG.torsoY + by + 1, pose, pal);

  const backArm = L();
  const bShoulder = { x: RIG.backShoulderX + bx + pose.lean, y: RIG.shoulderY + by };
  drawArm(
    backArm,
    bShoulder,
    { x: bShoulder.x + pose.backHand.x, y: bShoulder.y + pose.backHand.y },
    pal,
    true,
  );

  const backLeg = L();
  drawLeg(backLeg, { x: RIG.backHipX + bx, y: RIG.hipY + by }, pose.backFoot, pal, true);

  const frontLeg = L();
  drawLeg(frontLeg, { x: RIG.frontHipX + bx, y: RIG.hipY + by }, pose.frontFoot, pal, false);

  const torso = L();
  drawTorso(torso, RIG.torsoX + bx, RIG.torsoY + by, pose.lean, pal);
  drawScarfWrap(torso, RIG.torsoX + bx, RIG.torsoY + by, pose.lean, pal);

  const head = L();
  drawHead(head, headX, headY, pose.blink, pal);

  const frontHair = L();
  drawFrontHair(frontHair, app.hairStyle, headX, headY, pal.hair);

  const frontArm = L();
  const fShoulder = { x: RIG.frontShoulderX + bx + pose.lean, y: RIG.shoulderY + by };
  drawArm(
    frontArm,
    fShoulder,
    { x: fShoulder.x + pose.frontHand.x, y: fShoulder.y + pose.frontHand.y },
    pal,
    false,
  );

  return composite(
    [
      { canvas: backHair, separate: false },
      { canvas: backArm, separate: false },
      { canvas: backLeg, separate: false },
      { canvas: frontLeg, separate: true },
      { canvas: torso, separate: true },
      { canvas: head, separate: true },
      { canvas: frontHair, separate: false },
      { canvas: frontArm, separate: true },
    ],
    pal.outline,
  );
}

export interface SheetFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CharacterSheet {
  readonly canvas: PixelCanvas;
  readonly frames: readonly SheetFrame[];
  readonly animations: readonly AnimationDef[];
  readonly frameSize: number;
}

/** Build the full animated sprite sheet for an appearance: one row per animation. */
export function composeCharacterSheet(
  app: Appearance,
  animations: readonly AnimationDef[] = ANIMATIONS,
): CharacterSheet {
  const pal = buildPalette(app);
  const cols = Math.max(...animations.map((a) => a.frames.length));
  const canvas = new PixelCanvas(cols * FRAME_SIZE, animations.length * FRAME_SIZE);
  const frames: SheetFrame[] = [];
  animations.forEach((anim, row) => {
    anim.frames.forEach((pose, col) => {
      const frame = composeFrame(app, pal, pose);
      const x = col * FRAME_SIZE;
      const y = row * FRAME_SIZE;
      canvas.blit(frame, x, y);
      frames.push({ name: frameName(anim.key, col), x, y, w: FRAME_SIZE, h: FRAME_SIZE });
    });
  });
  return { canvas, frames, animations, frameSize: FRAME_SIZE };
}

/** Head-and-shoulders crop of the idle pose for HUD portraits. */
export function composePortrait(app: Appearance): PixelCanvas {
  const pal = buildPalette(app);
  const idle = ANIMATIONS.find((a) => a.key === 'idle');
  const frame = composeFrame(app, pal, idle?.frames[0] ?? (ANIMATIONS[0]?.frames[0] as Pose));
  const out = new PixelCanvas(28, 28);
  out.blitRegion(frame, 10, 3, 28, 28, 0, 0);
  return out;
}
