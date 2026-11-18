import type { GameBridge } from '../app/GameBridge';
import type { Stores } from '../app/stores';
import type { InputManager } from '../input/InputManager';
import type { ParallaxLayerArt } from './art/background/BackgroundArt';
import type { Appearance } from './art/character/appearance';
import type { Tileset } from './art/tiles/TilesetGenerator';

/** Generated assets handed from the boot scene to the world scene. */
export interface GeneratedAssets {
  tileset: Tileset | null;
  parallax: ParallaxLayerArt[];
}

/** Everything a scene needs from outside Phaser, injected rather than imported as globals. */
export interface GameServices {
  readonly stores: Stores;
  readonly input: InputManager;
  readonly bridge: GameBridge;
  readonly assets: GeneratedAssets;
  readonly playerAppearance: Appearance;
}
