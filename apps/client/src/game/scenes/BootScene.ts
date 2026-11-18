import Phaser from 'phaser';
import { t } from '../../i18n';
import type { GameServices } from '../services';
import { WORLD_ID } from '../worldConfig';
import {
  characterPortraitDataUrl,
  ensureCharacterTexture,
  registerFx,
  registerItems,
  registerObjects,
  registerSky,
  registerTileset,
} from '../render/textures';

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Generates all procedural art into GPU textures, reporting progress to the loading screen,
 * then hands over to the world scene. When hand-drawn atlases exist they will be loaded here
 * in `preload()` and generation skipped for those keys.
 */
export class BootScene extends Phaser.Scene {
  constructor(private readonly services: GameServices) {
    super('Boot');
  }

  async create(): Promise<void> {
    const { stores, assets } = this.services;
    const progress = (p: number, label: string): void =>
      stores.app.set({ bootProgress: p, bootLabel: label });
    try {
      progress(0.02, t('boot.textures'));
      try {
        await Promise.race([
          Promise.all([
            document.fonts.load('12px Galmuri11'),
            document.fonts.load('bold 12px Galmuri11'),
          ]),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
      } catch {
        /* fonts are cosmetic; continue with fallback */
      }
      const steps: [string, () => void][] = [
        ['boot.tiles', () => (assets.tileset = registerTileset(this))],
        [
          'boot.characters',
          () => {
            ensureCharacterTexture(this, 'player', this.services.playerAppearance);
            stores.player.set({
              portrait: characterPortraitDataUrl(this.services.playerAppearance),
            });
          },
        ],
        ['boot.objects', () => registerObjects(this)],
        ['boot.sky', () => (assets.parallax = registerSky(this))],
        ['boot.textures', () => registerFx(this)],
        [
          'boot.items',
          () => {
            if (assets.tileset)
              Object.assign(this.services.icons, registerItems(this, assets.tileset));
          },
        ],
      ];
      for (let i = 0; i < steps.length; i++) {
        const [label, run] = steps[i] as [string, () => void];
        progress(0.05 + (i / steps.length) * 0.8, t(label));
        await nextFrame();
        run();
      }
      progress(0.9, t('boot.world'));
      try {
        assets.save = await this.services.saveStore.load(WORLD_ID);
      } catch (err) {
        console.error('Failed to load save', err);
      }
      stores.app.set({
        hasSave: assets.save.player !== null,
        persistent: this.services.saveStore.persistent,
      });
      await nextFrame();
      this.scene.start('World');
    } catch (err) {
      console.error(err);
      stores.app.set({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
}
