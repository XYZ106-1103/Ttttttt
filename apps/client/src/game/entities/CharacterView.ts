import type Phaser from 'phaser';
import { clamp, COLLISION_NONE, damp, type MotorState, TILE_SIZE, type World } from '@world/shared';
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

export type AnimState = 'idle' | 'run' | 'jump' | 'apex' | 'fall' | 'land' | 'skid';

export type UseKind = 'swing' | 'place';

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

/**
 * Visual representation of a character driven by a MotorState. Purely cosmetic: it never
 * changes simulation state. The same view will render AI adventurers in PHASE 4.
 *
 * While an item is in use the body switches to a sheet without the front arm, and a separate
 * arm sprite (24 pre-rendered angles) plus the held item swing toward the aim point — so the
 * legs keep running while the arm works.
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
  private useKind: UseKind = 'swing';
  private useStart = -10;
  private useDuration = 0.25;
  private lastUse = -10;
  runSpeed = 168;

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
    this.nameTag.setText(name);
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

  /** Start a swing (tools) or a short placing motion. */
  triggerUse(kind: UseKind, duration: number, now: number): void {
    this.useKind = kind;
    this.useStart = now;
    this.useDuration = Math.max(0.08, duration);
    this.lastUse = now;
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
   * @param now Simulation time (s) for swing timing.
   * @param holding True while the use button is held.
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
  ): void {
    if (!this.visible) return;
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
    if (m.grounded) {
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

    const using =
      aim !== null &&
      (holding || now - this.lastUse < Math.max(USE_LINGER, this.useDuration + 0.08));
    const drawY = y + this.stepOffset;
    const sx = this.sx.update(dt);
    const sy = this.sy.update(dt);
    let shoulderX = 0;
    let shoulderY = 0;
    if (using && aim) {
      // Face the aim point while working, like every good sandbox game.
      const frameName = this.bodyNoArm.frame.name;
      const sh = characterRig(this.id)?.shoulders.get(String(frameName)) ?? { x: 34, y: 25 };
      facing = aim.x >= x ? 1 : -1;
      shoulderX = x + (sh.x - FRAME_SIZE / 2) * facing * sx;
      shoulderY = drawY - (FRAME_SIZE - sh.y) * sy;
    }

    for (const body of [this.sprite, this.bodyNoArm]) {
      body
        .setFlipX(facing < 0)
        .setScale(sx, sy)
        .setPosition(x, drawY);
    }
    this.sprite.setVisible(!using);
    this.bodyNoArm.setVisible(using);
    this.arm.setVisible(using);
    this.held.setVisible(using && this.heldItem !== null);

    if (using && aim) {
      const aimWorld = Math.atan2(aim.y - shoulderY, aim.x - shoulderX);
      const aimLocal = wrapAngle(facing > 0 ? aimWorld : Math.PI - aimWorld);
      const t = clamp((now - this.useStart) / this.useDuration, 0, 1);
      const [from, to] =
        this.useKind === 'swing'
          ? [aimLocal - 1.75, aimLocal + 0.55]
          : [aimLocal - 0.5, aimLocal + 0.12];
      const local = from + (to - from) * easeOutCubic(t);
      const idx = ((Math.round(local / (TAU / ARM_ANGLES)) % ARM_ANGLES) + ARM_ANGLES) % ARM_ANGLES;
      this.arm
        .setFrame(`arm_${idx}`)
        .setFlipX(facing < 0)
        .setPosition(shoulderX, shoulderY);
      const quantized = (idx / ARM_ANGLES) * TAU;
      const world = facing > 0 ? quantized : Math.PI - quantized;
      if (this.heldItem) {
        this.held
          .setFrame(this.heldItem)
          .setPosition(
            shoulderX + Math.cos(world) * ARM_REACH,
            shoulderY + Math.sin(world) * ARM_REACH,
          )
          .setRotation(world + Math.PI / 4)
          .setScale(this.useKind === 'place' ? 0.7 : 1);
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
