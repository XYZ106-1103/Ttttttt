import type Phaser from 'phaser';
import { clamp, COLLISION_NONE, damp, type MotorState, TILE_SIZE, type World } from '@world/shared';
import { characterAnimKey, characterKey, TEX } from '../render/textureKeys';
import type { FrameEvents } from './FrameEvents';

export type AnimState = 'idle' | 'run' | 'jump' | 'apex' | 'fall' | 'land' | 'skid';

import { Spring } from './Spring';

/**
 * Visual representation of a character driven by a MotorState. Purely cosmetic: it never
 * changes simulation state. The same view will render AI adventurers in PHASE 4.
 */
export class CharacterView {
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly nameTag: Phaser.GameObjects.Text;
  private state: AnimState = 'idle';
  private stateTime = 0;
  private readonly sx = new Spring(260, 18);
  private readonly sy = new Spring(260, 18);
  private stepOffset = 0;
  private visible = true;
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
    worldLayer.add([this.shadow, this.sprite]);
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
  }

  private play(state: AnimState): void {
    if (this.state === state && this.sprite.anims.isPlaying) return;
    this.state = state;
    this.stateTime = 0;
    this.sprite.play(characterAnimKey(this.id, state), true);
  }

  /**
   * @param x,y Interpolated feet position.
   * @param inputX Current horizontal input (for skid detection).
   */
  /**
   * @param labelScale World→label-layer scale (the label camera renders at 1× for crisp text).
   */
  update(
    dt: number,
    x: number,
    y: number,
    m: MotorState,
    ev: FrameEvents,
    inputX: number,
    labelScale: number,
  ): void {
    if (!this.visible) return;
    this.stateTime += dt;

    // Auto-step: the simulation snaps a full tile; the view eases over it.
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
        this.sprite.anims.timeScale = 0.55 + 0.6 * clamp(speed / this.runSpeed, 0, 1);
      } else {
        this.play('idle');
        this.sprite.anims.timeScale = 1;
      }
    } else {
      this.sprite.anims.timeScale = 1;
      if (m.vy < -90) {
        if (this.state !== 'jump') this.play('jump');
      } else if (m.vy <= 90) this.play('apex');
      else this.play('fall');
    }

    const sx = this.sx.update(dt);
    const sy = this.sy.update(dt);
    this.sprite.setFlipX(facing < 0);
    this.sprite.setScale(sx, sy);
    const drawY = y + this.stepOffset;
    this.sprite.setPosition(x, drawY);

    // Ground shadow: find the floor below and fade with height.
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
    this.shadow.destroy();
    this.nameTag.destroy();
  }
}
