import type Phaser from 'phaser';
import { itemRegistry, TILE_SIZE, tileRegistry } from '@world/shared';
import { type Tileset, tileFrameIndex } from '../art/tiles/TilesetGenerator';
import type { ViewRect } from '../render/ChunkRenderer';
import { TEX } from '../render/textureKeys';
import type { ClientSim } from '../sim/ClientSim';
import type { UseIntent } from '../sim/GameSimulation';

/** How long (simulation seconds) a click waits for the tool cooldown before it is dropped. */
const CLICK_BUFFER = 0.35;

/** Reasons worth flagging red under the cursor (others just hide the highlight). */
const SHOW_INVALID = new Set([
  'wrong_tool',
  'tool_too_weak',
  'unbreakable',
  'supports_object',
  'occupied',
  'no_support',
  'blocked_by_body',
]);

/**
 * Mouse targeting: converts the pointer to a world tile, previews what the selected item would
 * do there (highlight, ghost block, crack overlay) and emits a use intent while the left button
 * is held. All rules are evaluated by the shared interaction code via the simulation.
 */
export class InteractionController {
  private readonly cursor: Phaser.GameObjects.Graphics;
  private readonly ghost: Phaser.GameObjects.Image;
  private readonly crack: Phaser.GameObjects.Image;
  private wheel = 0;
  /** A press that has not been seen by a simulation tick yet (clicks shorter than a frame). */
  private pendingClick = false;
  /** Simulation time the pending click was first seen at (NaN until the next update). */
  private pendingAt = Number.NaN;
  /** Total presses seen (diagnostics). */
  presses = 0;
  /** Left-button presses not yet consumed by combat input. */
  private attackPresses = 0;
  private readonly onDown = (p: Phaser.Input.Pointer): void => {
    this.presses++;
    if (p.button === 0) this.attackPresses++;
    // `button` (which button changed) is reliable on the down event itself; the `buttons`
    // bitmask behind leftButtonDown() may not include it yet.
    if (p.button === 0) {
      this.pendingClick = true;
      this.pendingAt = Number.NaN;
    }
  };
  private readonly onWheel = (_p: unknown, _o: unknown, _dx: number, dy: number): void => {
    this.wheel += Math.sign(dy);
  };
  /** Current target tile and aim point (world px). */
  target = { tx: 0, ty: 0 };
  aim = { x: 0, y: 0 };
  /** True while the left button is held over the game. */
  holding = false;

  constructor(
    private readonly scene: Phaser.Scene,
    worldLayer: Phaser.GameObjects.Layer,
    overlayLayer: Phaser.GameObjects.Layer,
    private readonly tileset: Tileset,
  ) {
    this.cursor = scene.make.graphics({}, false).setDepth(60);
    this.ghost = scene.make
      .image({ x: 0, y: 0, key: TEX.tiles, frame: 0 }, false)
      .setOrigin(0, 0)
      .setAlpha(0.55)
      .setDepth(59);
    this.crack = scene.make
      .image({ x: 0, y: 0, key: TEX.fx, frame: 'crack_0' }, false)
      .setOrigin(0, 0)
      .setDepth(2);
    overlayLayer.add([this.ghost, this.cursor]);
    worldLayer.add(this.crack);
    scene.input.on('wheel', this.onWheel);
    scene.input.on('pointerdown', this.onDown);
  }

  /**
   * Called after the simulation ran. A click stays buffered (like a jump buffer) until a use
   * actually happened, so clicks during a tool's cooldown are not lost; stale clicks expire.
   */
  settleClick(used: boolean, simTime: number): void {
    if (used || simTime - this.pendingAt > CLICK_BUFFER) this.pendingClick = false;
  }

  /** True once per left-button press since the last call (combat attack edge). */
  consumeAttackPress(): boolean {
    const n = this.attackPresses;
    this.attackPresses = 0;
    return n > 0;
  }

  /** Left button currently held over the game. */
  get leftDown(): boolean {
    const p = this.scene.input.activePointer;
    return p.isDown && p.leftButtonDown();
  }

  /** Hotbar scroll steps accumulated since the last call (+ = next slot). */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /**
   * Per-frame update. Returns the use intent for this frame's simulation ticks, or null.
   * @param enabled false while menus/chat/title are active.
   */
  update(view: ViewRect, zoom: number, sim: ClientSim, enabled: boolean): UseIntent | null {
    const p = this.scene.input.activePointer;
    this.aim.x = view.left + p.x / zoom;
    this.aim.y = view.top + p.y / zoom;
    const tx = Math.floor(this.aim.x / TILE_SIZE);
    const ty = Math.floor(this.aim.y / TILE_SIZE);
    this.target.tx = tx;
    this.target.ty = ty;
    if (this.pendingClick && Number.isNaN(this.pendingAt)) this.pendingAt = sim.time;
    this.holding = enabled && ((p.isDown && p.leftButtonDown()) || this.pendingClick);
    if (!enabled) this.pendingClick = false;

    this.cursor.clear();
    this.ghost.setVisible(false);
    this.updateCrack(sim);
    if (!enabled) return null;

    const preview = sim.preview(tx, ty);
    const x = tx * TILE_SIZE;
    const y = ty * TILE_SIZE;
    if (preview.ok && preview.action === 'place') {
      const stack = sim.player.inventory.get(sim.player.selectedSlot);
      const tileKey = stack ? itemRegistry.get(stack.itemId)?.places : undefined;
      if (tileKey === 'torch') this.ghost.setTexture(TEX.fx, 'torch_0');
      else if (tileKey)
        this.ghost.setTexture(
          TEX.tiles,
          tileFrameIndex(this.tileset, tileRegistry.idOf(tileKey), 0, 0),
        );
      this.ghost.setPosition(x, y).setVisible(true);
      this.cursor
        .lineStyle(1, 0xffffff, 0.55)
        .strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    } else if (preview.ok) {
      this.cursor
        .lineStyle(1, 0xffffff, 0.85)
        .strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    } else if (preview.reason && SHOW_INVALID.has(preview.reason)) {
      this.cursor
        .lineStyle(1, 0xff5a5a, 0.8)
        .strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    }
    return this.holding ? { tx, ty } : null;
  }

  private updateCrack(sim: ClientSim): void {
    const hit = sim.player.hit;
    if (!hit || !hit.key.startsWith('t:')) {
      this.crack.setVisible(false);
      return;
    }
    const [sx, sy] = hit.key.slice(2).split(',');
    const tx = Number(sx);
    const ty = Number(sy);
    const progress = sim.hitProgressAt(tx, ty);
    if (progress <= 0) {
      this.crack.setVisible(false);
      return;
    }
    const stage = Math.min(3, Math.floor(progress * 4));
    this.crack
      .setFrame(`crack_${stage}`)
      .setPosition(tx * TILE_SIZE, ty * TILE_SIZE)
      .setVisible(true);
  }

  destroy(): void {
    this.scene.input.off('wheel', this.onWheel);
    this.scene.input.off('pointerdown', this.onDown);
    this.cursor.destroy();
    this.ghost.destroy();
    this.crack.destroy();
  }
}
