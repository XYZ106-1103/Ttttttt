import type Phaser from 'phaser';
import { createMotorState, DEFAULT_MOVEMENT, type MotorState, type World } from '@world/shared';
import { t } from '../../i18n';
import { randomAppearance } from '../art/character/appearance';
import { CharacterView } from '../entities/CharacterView';
import { createFrameEvents } from '../entities/FrameEvents';
import type { NpcPlacement } from '@world/shared';
import { CharacterTextureQueue } from './CharacterTextureQueue';

interface NpcSprite {
  readonly npc: NpcPlacement;
  readonly view: CharacterView;
  readonly motor: MotorState;
  readonly prompt: Phaser.GameObjects.Text;
}

const ROLE_COLOR: Record<string, string> = {
  shop: '#f2c46a',
  exchange: '#8fd0ff',
  guild: '#ff9f9f',
};

/**
 * Village NPCs: idle characters drawn with the shared character pipeline, a role-colored name
 * tag ("[상점] 잡화상 마르타") and a "right-click to talk" prompt when the player is close.
 */
export class NpcRenderer {
  private readonly sprites: NpcSprite[] = [];
  private readonly textures: CharacterTextureQueue;
  private readonly ev = createFrameEvents();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly labelLayer: Phaser.GameObjects.Layer,
    private readonly world: World,
    private readonly npcs: readonly NpcPlacement[],
  ) {
    this.textures = new CharacterTextureQueue(scene);
    for (const n of npcs) this.textures.request(this.key(n), randomAppearance(n.def.look));
  }

  private key(n: NpcPlacement): string {
    return `npc-${n.def.id}`;
  }

  /** Name only: the tag color tells the role (gold shop, blue exchange, red guild). */
  private label(n: NpcPlacement): string {
    return t(n.def.nameKey);
  }

  update(
    dt: number,
    now: number,
    zoom: number,
    playerX: number,
    near: (id: string) => boolean,
  ): void {
    this.textures.flush();
    for (const n of this.npcs) {
      if (this.sprites.some((s) => s.npc === n) || !this.textures.has(this.key(n))) continue;
      const view = new CharacterView(
        this.scene,
        this.worldLayer,
        this.labelLayer,
        this.key(n),
        this.label(n),
        this.world,
      );
      view.setTagColor(ROLE_COLOR[n.def.role] ?? '#fff6e0');
      const motor = createMotorState(n.x, n.y, DEFAULT_MOVEMENT);
      motor.grounded = true;
      motor.facing = n.def.facing;
      const prompt = this.scene.make.text(
        {
          x: 0,
          y: 0,
          text: t('npc.prompt'),
          style: {
            fontFamily: 'Galmuri11, monospace',
            fontSize: '11px',
            color: '#ffe9a8',
            backgroundColor: 'rgba(18,14,30,0.78)',
            padding: { left: 4, right: 4, top: 2, bottom: 2 },
          },
        },
        false,
      );
      prompt.setOrigin(0.5, 1).setDepth(54).setVisible(false);
      this.labelLayer.add(prompt);
      this.sprites.push({ npc: n, view, motor, prompt });
    }
    for (const s of this.sprites) {
      const n = s.npc;
      // Face the player when they come close, otherwise the counter.
      s.motor.facing = near(n.def.id) ? (playerX >= n.x ? 1 : -1) : n.def.facing;
      s.view.setName(this.label(n));
      s.view.update(dt, n.x, n.y, s.motor, this.ev, 0, zoom, null, now);
      const show = near(n.def.id);
      s.prompt.setText(t('npc.prompt'));
      const anchor = s.view.tagAnchor;
      s.prompt.setVisible(show).setPosition(anchor.x, Math.round((n.y - 50) * zoom));
    }
  }

  destroy(): void {
    this.textures.destroy();
    for (const s of this.sprites) {
      s.view.destroy();
      s.prompt.destroy();
    }
    this.sprites.length = 0;
  }
}
