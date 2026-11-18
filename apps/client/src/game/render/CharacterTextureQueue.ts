import type Phaser from 'phaser';
import type { Appearance } from '../art/character/appearance';
import { type ComposedCharacter, composeCharacterAssets } from '../art/character/composeAssets';
import { characterKey } from './textureKeys';
import { registerComposedCharacter } from './textures';

/**
 * Composes character textures in a Web Worker (≈250 ms of pixel work each) and registers them
 * when ready, so adventurers walking into view never stall a frame. Falls back to composing on
 * the main thread where workers are unavailable.
 */
export class CharacterTextureQueue {
  private readonly worker: Worker | null;
  private readonly pending = new Set<string>();
  private readonly ready: { id: string; assets: ComposedCharacter }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.worker = CharacterTextureQueue.spawn((data) => {
      if (data.assets) this.ready.push({ id: data.id, assets: data.assets });
      else {
        console.warn('Character compose failed', data.error);
        this.pending.delete(data.id);
      }
    });
  }

  private static spawn(
    onResult: (data: { id: string; assets?: ComposedCharacter; error?: string }) => void,
  ): Worker | null {
    try {
      const w = new Worker(new URL('./characterWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: string; assets?: ComposedCharacter; error?: string }>) =>
        onResult(e.data);
      return w;
    } catch {
      return null;
    }
  }

  has(id: string): boolean {
    return this.scene.textures.exists(characterKey(id));
  }

  request(id: string, appearance: Appearance): void {
    if (this.has(id) || this.pending.has(id)) return;
    this.pending.add(id);
    if (this.worker) this.worker.postMessage({ id, appearance });
    else this.ready.push({ id, assets: composeCharacterAssets(appearance) });
  }

  /** Register finished textures (call once per frame; at most one upload per frame). */
  flush(): void {
    const next = this.ready.shift();
    if (!next) return;
    registerComposedCharacter(this.scene, next.id, next.assets);
    this.pending.delete(next.id);
  }

  destroy(): void {
    this.worker?.terminate();
  }
}
