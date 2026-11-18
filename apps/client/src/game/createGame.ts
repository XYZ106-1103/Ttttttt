import Phaser from 'phaser';
import { LightingPipeline } from './render/LightingPipeline';
import { BootScene } from './scenes/BootScene';
import { WorldScene } from './scenes/WorldScene';
import type { GameServices } from './services';

export function createGame(parent: HTMLElement, services: GameServices): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    backgroundColor: '#0b0e1a',
    pixelArt: true,
    antialias: false,
    disableContextMenu: true,
    banner: false,
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: parent.clientWidth || window.innerWidth,
      height: parent.clientHeight || window.innerHeight,
    },
    render: {
      powerPreference: 'high-performance',
      pipeline: {
        [LightingPipeline.KEY]: LightingPipeline,
      } as unknown as Phaser.Types.Core.PipelineConfig,
    },
    input: { keyboard: false, mouse: true, touch: false, gamepad: false },
    scene: [new BootScene(services), new WorldScene(services)],
  });
}
