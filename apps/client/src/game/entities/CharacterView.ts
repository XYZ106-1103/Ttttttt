import type Phaser from 'phaser';
import {
  type ActionAnim,
  clamp,
  COLLISION_NONE,
  damp,
  type MotorState,
  TILE_SIZE,
  type World,
} from '@world/shared';
import { ARM_ANGLES, ARM_PIVOT, ARM_REACH } from '../art/character/CharacterComposer';
import { FRAME_SIZE } from '../art/character/rig';
import {
  characterAnimKey,
  characterArmKey,
  characterKey,
  characterNoArmAnimKey,
  characterNoArmKey,
  TEX,
} from '../render/textureKeys';
import { characterRig } from '../render/textures';
import type { FrameEvents } from './FrameEvents';
import { Spring } from './Spring';

export type AnimState =
  'idle' | 'run' | 'jump' | 'apex' | 'fall' | 'land' | 'skid' | 'hurt' | 'dodge' | 'dead';

export type UseKind = 'swing' | 'place';

/** Per-frame combat presentation flags (from the simulation). */
export interface CombatLook {
  dead: boolean;
  hurt: boolean;
  dodging: boolean;
  /** Drawing a bow (arm held toward the aim point). */
  charging: boolean;
  /** Blink while invulnerable after a hit. */
  blink: boolean;
}

const TAU = Math.PI * 2;
/** How long the arm stays raised after the last use. */
const USE_LINGER = 0.28;

function wrapAngle(a: number): number {
  let r = a % TAU;
  if (r <= -Math.PI) r += TAU;
  if (r > Math.PI) r -= TAU;
  return r;
}

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

interface ArmMotion {
  readonly kind: ActionAnim | 'tool' | 'place';
  readonly start: number;
  readonly duration: number;
  /** Aim angle (world radians) captured when the motion started, or null = follow the cursor. */
  readonly aim: number | null;
}

/**
 * Visual representation of a character driven by a MotorState. Purely cosmetic: it never
 * changes simulation state. The same view will render AI adventurers in PHASE 4.
 *
 * While an item is in use the body switches to a sheet without the front arm, and a separate
 * arm sprite (24 pre-rendered angles) plus the held item move along a motion curve (swing,
 * thrust, cast, draw, spin…) toward the aim point — so the legs keep running while the arm works.
 */
export class CharacterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly bodyNoArm: Phaser.GameObjects.Sprite;
  private readonly arm: Phaser.GameObjects.Sprite;
  private readonly held: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly nameTag: Phaser.GameObjects.Text;
  private state: AnimState = 'idle';
  private stateTime = 0;
  private readonly sx = new Spring(260, 18);
  private readonly sy = new Spring(260, 18);
  private stepOffset = 0;
  private visible = true;
  private heldItem: string | null = null;
  private motion: ArmMotion | null = null;
  private lastUse = -10;
  private deadTime = 0;
  private frozenUntil = 0;
  runSpeed = 168;
  /** Final render position (feet) of the last update (FX anchor). */
  readonly pos = { x: 0, y: 0, facing: 1 };

  constructor(
    scene: Phaser.Scene,
    worldLayer: Phaser.GameObjects.Layer,
    labelLayer: Phaser.GameObjects.Layer,
    private readonly id: string,
    name: string,
    private readonly world: World,
  ) {
    this.shadow = scene.make
      .image({ x: 0, y: 0, key: TEX.shadow }, false)
      .setOrigin(0.5, 0.5)
      .setDepth(19);
    this.sprite = scene.make.sprite({ x: 0, y: 0, key: characterKey(id), frame: 'idle_0' }, false);
    this.sprite.setOrigin(0.5, 1).setDepth(20);
    this.bodyNoArm = scene.make.sprite(
      { x: 0, y: 0, key: characterNoArmKey(id), frame: 'idle_0' },
      false,
    );
    this.bodyNoArm.setOrigin(0.5, 1).setDepth(20).setVisible(false);
    this.held = scene.make.image({ x: 0, y: 0, key: TEX.items, frame: 'worn_pickaxe' }, false);
    this.held.setOrigin(0.15, 0.85).setDepth(20.5).setVisible(false);
    this.arm = scene.make.sprite({ x: 0, y: 0, key: characterArmKey(id), frame: 'arm_6' }, false);
    this.arm
      .setOrigin(ARM_PIVOT / FRAME_SIZE, ARM_PIVOT / FRAME_SIZE)
      .setDepth(21)
      .setVisible(false);
    worldLayer.add([this.shadow, this.sprite, this.bodyNoArm, this.held, this.arm]);
    this.nameTag = scene.make.text(
      {
        x: 0,
        y: 0,
        text: name,
        style: {
          fontFamily: 'Galmuri11, monospace',
          fontSize: '12px',
          color: '#fff6e0',
          backgroundColor: 'rgba(18,14,30,0.72)',
          padding: { left: 3, right: 3, top: 1, bottom: 1 },
        },
      },
      false,
    );
    this.nameTag.setOrigin(0.5, 0).setDepth(50);
    labelLayer.add(this.nameTag);
    this.play('idle');
  }

  setName(name: string): void {
    if (this.nameTag.text !== name) this.nameTag.setText(name);
  }

  /** Name-tag text color (job colors for adventurers). */
  setTagColor(color: string): void {
    this.nameTag.setColor(color);
  }

  /** Name tag position in label space (for speech bubbles). */
  /** Name tag bounds in label-layer pixels (for de-overlapping crowded tags). */
  get tagBounds(): { left: number; right: number; y: number; h: number } {
    const w = this.nameTag.width;
    return {
      left: this.nameTag.x - w / 2,
      right: this.nameTag.x + w / 2,
      y: this.nameTag.y,
      h: this.nameTag.height,
    };
  }

  /** Shift the name tag down by `rows` tag heights (crowds stack their tags). */
  stackTag(rows: number): void {
    if (rows > 0) this.nameTag.y += rows * (this.nameTag.height + 1);
  }

  get tagAnchor(): { x: number; y: number } {
    return { x: this.nameTag.x, y: this.nameTag.y };
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.sprite.setVisible(v);
    this.shadow.setVisible(v);
    this.nameTag.setVisible(v);
    if (!v) {
      this.bodyNoArm.setVisible(false);
      this.arm.setVisible(false);
      this.held.setVisible(false);
    }
  }

  /** Item shown in hand while using (null = bare hand). */
  setHeldItem(itemId: string | null): void {
    this.heldItem = itemId;
  }

  /** Start a tool swing or a short placing motion (sandbox use). */
  triggerUse(kind: UseKind, duration: number, now: number): void {
    this.motion = {
      kind: kind === 'place' ? 'place' : 'tool',
      start: now,
      duration: Math.max(0.08, duration),
      aim: null,
    };
    this.lastUse = now;
  }

  /** Start a combat action's arm motion toward a fixed aim angle (world radians). */
  triggerAction(anim: ActionAnim, aim: number, duration: number, now: number): void {
    this.motion = { kind: anim, start: now, duration: Math.max(0.08, duration), aim };
    this.lastUse = now;
  }

  /** Freeze the animation briefly (hitstop). */
  freeze(until: number): void {
    this.frozenUntil = Math.max(this.frozenUntil, until);
  }

  /** Texture/frame/position of the visible body (for afterimages). */
  snapshot(): { key: string; frame: string; x: number; y: number; flipX: boolean } {
    const body = this.bodyNoArm.visible ? this.bodyNoArm : this.sprite;
    return {
      key: body.texture.key,
      frame: String(body.frame.name),
      x: body.x,
      y: body.y,
      flipX: body.flipX,
    };
  }

  private play(state: AnimState): void {
    if (this.state === state && this.sprite.anims.isPlaying) return;
    this.state = state;
    this.stateTime = 0;
    this.sprite.play(characterAnimKey(this.id, state), true);
    this.bodyNoArm.play(characterNoArmAnimKey(this.id, state), true);
  }

  private setTimeScale(s: number): void {
    this.sprite.anims.timeScale = s;
    this.bodyNoArm.anims.timeScale = s;
  }

  /**
   * @param x,y Interpolated feet position.
   * @param inputX Current horizontal input (for skid detection).
   * @param labelScale World→label-layer scale (the label camera renders at 1× for crisp text).
   * @param aim World point being aimed at, or null when no item is in use.
   * @param now Simulation time (s) for motion timing.
   * @param holding True while the use button is held.
   * @param look Combat presentation flags.
   */
  update(
    dt: number,
    x: number,
    y: number,
    m: MotorState,
    ev: FrameEvents,
    inputX: number,
    labelScale: number,
    aim: { x: number; y: number } | null = null,
    now = 0,
    holding = false,
    look: CombatLook | null = null,
  ): void {
    if (!this.visible) return;
    const frozen = now < this.frozenUntil;
    for (const body of [this.sprite, this.bodyNoArm]) {
      if (frozen && !body.anims.isPaused) body.anims.pause();
      else if (!frozen && body.anims.isPaused) body.anims.resume();
    }
    this.stateTime += dt;

    if (ev.stepped !== 0) this.stepOffset += ev.stepped;
    this.stepOffset = damp(this.stepOffset, 0, 0.035, dt);
    if (Math.abs(this.stepOffset) < 0.05) this.stepOffset = 0;

    if (ev.jumped) {
      this.sx.kick(0.84);
      this.sy.kick(1.2);
      this.play('jump');
    }
    if (ev.landed) {
      const k = clamp((ev.landingSpeed - 120) / 480, 0, 1);
      if (k > 0) {
        this.sx.kick(1 + 0.24 * k);
        this.sy.kick(1 - 0.26 * k);
      }
      if (ev.landingSpeed > 260) this.play('land');
    }

    const speed = Math.abs(m.vx);
    let facing = m.facing;
    if (look?.dead) {
      this.deadTime += dt;
      this.play('dead');
    } else {
      this.deadTime = 0;
      if (look?.dodging) this.play('dodge');
      else if (look?.hurt) this.play('hurt');
      else if (m.grounded) {
        const skidding = speed > 110 && inputX !== 0 && Math.sign(inputX) !== Math.sign(m.vx);
        const landing = this.state === 'land' && this.stateTime < 0.14 && inputX === 0;
        if (skidding) {
          this.play('skid');
          facing = m.vx > 0 ? 1 : -1;
        } else if (landing) {
          // let the landing pose finish
        } else if (speed > 14) {
          this.play('run');
          this.setTimeScale(0.55 + 0.6 * clamp(speed / this.runSpeed, 0, 1));
        } else {
          this.play('idle');
          this.setTimeScale(1);
        }
      } else {
        this.setTimeScale(1);
        if (m.vy < -90) {
          if (this.state !== 'jump') this.play('jump');
        } else if (m.vy <= 90) this.play('apex');
        else this.play('fall');
      }
    }

    const mo = this.motion;
    const motionActive =
      mo !== null &&
      now - mo.start <
        mo.duration + (mo.kind === 'tool' || mo.kind === 'place' ? USE_LINGER : 0.12);
    const charging = look?.charging ?? false;
    const using =
      !look?.dead &&
      !look?.dodging &&
      (charging ||
        motionActive ||
        (aim !== null &&
          holding &&
          (mo?.kind === 'tool' || mo?.kind === 'place' || !mo) &&
          now - this.lastUse < USE_LINGER + 0.5));
    if (mo && !motionActive) this.motion = null;
    const drawY = y + this.stepOffset;
    const sx = this.sx.update(dt);
    const sy = this.sy.update(dt);
    let shoulderX = 0;
    let shoulderY = 0;
    let aimWorld = 0;
    if (using) {
      const frameName = this.bodyNoArm.frame.name;
      const sh = characterRig(this.id)?.shoulders.get(String(frameName)) ?? { x: 34, y: 25 };
      const fixed = this.motion?.aim ?? null;
      const ax = aim?.x ?? x + facing * 40;
      const ay = aim?.y ?? drawY - 30;
      if (fixed !== null) facing = Math.cos(fixed) >= 0 ? 1 : -1;
      else facing = ax >= x ? 1 : -1;
      shoulderX = x + (sh.x - FRAME_SIZE / 2) * facing * sx;
      shoulderY = drawY - (FRAME_SIZE - sh.y) * sy;
      aimWorld = fixed ?? Math.atan2(ay - shoulderY, ax - shoulderX);
    }

    for (const body of [this.sprite, this.bodyNoArm]) {
      body
        .setFlipX(facing < 0)
        .setScale(sx, sy)
        .setPosition(x, drawY);
    }
    // Dying: topple over after kneeling.
    const topple = look?.dead ? clamp((this.deadTime - 0.35) / 0.35, 0, 1) : 0;
    const rot = -facing * easeOutCubic(topple) * (Math.PI / 2) * 0.92;
    this.sprite.setRotation(rot);
    this.bodyNoArm.setRotation(rot);
    const alpha = look?.blink && !look.dead ? (Math.floor(now * 18) % 2 === 0 ? 0.35 : 0.95) : 1;
    this.sprite.setAlpha(alpha);
    this.bodyNoArm.setAlpha(alpha);
    this.arm.setAlpha(alpha);
    this.held.setAlpha(alpha);
    this.sprite.setVisible(!using);
    this.bodyNoArm.setVisible(using);
    this.arm.setVisible(using);
    this.held.setVisible(using && this.heldItem !== null);
    this.pos.x = x;
    this.pos.y = drawY;
    this.pos.facing = facing;

    if (using) {
      const aimLocal = wrapAngle(facing > 0 ? aimWorld : Math.PI - aimWorld);
      const kind = charging ? 'shoot' : (this.motion?.kind ?? 'tool');
      const mt = this.motion;
      const t = mt ? clamp((now - mt.start) / mt.duration, 0, 1) : 1;
      let local = aimLocal;
      let reach = ARM_REACH;
      switch (kind) {
        case 'tool':
        case 'swing':
          local = aimLocal - 1.85 + 2.5 * easeOutCubic(t);
          break;
        case 'swing_up':
          local = aimLocal + 1.0 - 2.6 * easeOutCubic(t);
          break;
        case 'slam':
          local =
            aimLocal -
            2.7 +
            3.6 * (t < 0.3 ? 0.15 * (t / 0.3) : 0.15 + 0.85 * easeOutCubic((t - 0.3) / 0.7));
          break;
        case 'place':
          local = aimLocal - 0.5 + 0.62 * easeOutCubic(t);
          break;
        case 'thrust':
          local = aimLocal;
          reach = ARM_REACH * (1 + 0.45 * Math.sin(Math.min(1, t * 1.6) * Math.PI));
          break;
        case 'cast':
          local = aimLocal - 0.35 * Math.sin(t * Math.PI);
          reach = ARM_REACH * (1 - 0.15 * Math.sin(t * Math.PI));
          break;
        case 'raise':
          local = -Math.PI / 2 + 0.25 * (1 - easeInOut(t));
          break;
        case 'shoot':
          local = aimLocal;
          reach = ARM_REACH * (charging ? 0.85 : 1 - 0.12 * Math.sin(t * Math.PI));
          break;
        case 'spin':
          local = aimLocal + TAU * easeInOut(t) * 2;
          break;
        case 'dash':
          local = Math.PI * 0.85;
          break;
      }
      const idx = ((Math.round(local / (TAU / ARM_ANGLES)) % ARM_ANGLES) + ARM_ANGLES) % ARM_ANGLES;
      this.arm
        .setFrame(`arm_${idx}`)
        .setFlipX(facing < 0)
        .setPosition(shoulderX, shoulderY);
      const quantized =
        kind === 'thrust' || kind === 'shoot' || kind === 'cast' ? local : (idx / ARM_ANGLES) * TAU;
      const world = facing > 0 ? quantized : Math.PI - quantized;
      if (this.heldItem) {
        this.held
          .setFrame(this.heldItem)
          .setPosition(shoulderX + Math.cos(world) * reach, shoulderY + Math.sin(world) * reach)
          .setRotation(world + Math.PI / 4)
          .setScale(kind === 'place' ? 0.7 : 1);
      }
    }

    const tx = Math.floor(x / TILE_SIZE);
    let groundY = -1;
    for (let k = 0; k < 8; k++) {
      const ty = Math.floor((y - 0.01) / TILE_SIZE) + k;
      if (this.world.collisionAt(tx, ty) !== COLLISION_NONE) {
        groundY = ty * TILE_SIZE;
        break;
      }
    }
    if (groundY >= 0) {
      const h = groundY - drawY;
      const a = clamp(1 - h / 110, 0, 1);
      this.shadow
        .setVisible(true)
        .setPosition(x, groundY - 1)
        .setAlpha(a)
        .setScale(0.6 + 0.4 * a, 1);
    } else this.shadow.setVisible(false);

    this.nameTag.setPosition(Math.round(x * labelScale), Math.round((drawY + 2) * labelScale));
    this.nameTag.setAlpha(look?.dead ? 0.4 : 1);
  }

  destroy(): void {
    this.sprite.destroy();
    this.bodyNoArm.destroy();
    this.arm.destroy();
    this.held.destroy();
    this.shadow.destroy();
    this.nameTag.destroy();
  }
}
