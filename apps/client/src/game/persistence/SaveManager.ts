import type { GameSimulation } from '../sim/GameSimulation';
import type { SaveStore } from './SaveStore';

/**
 * Incremental autosave: only chunks changed since the last save are written, plus the small
 * world/player state. Saves are serialized (never two writes in flight) and flushed when the
 * page is hidden or closed.
 */
export class SaveManager {
  private timer = 0;
  private inFlight: Promise<void> | null = null;
  private readonly onHide = (): void => {
    if (document.visibilityState === 'hidden') void this.flush();
  };
  private readonly onPageHide = (): void => void this.flush();
  /** Seconds between autosaves. */
  interval = 5;

  constructor(
    private readonly store: SaveStore,
    private readonly sim: GameSimulation,
    private readonly seed: number,
  ) {
    document.addEventListener('visibilitychange', this.onHide);
    window.addEventListener('pagehide', this.onPageHide);
  }

  get persistent(): boolean {
    return this.store.persistent;
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer < this.interval) return;
    this.timer = 0;
    void this.flush();
  }

  /** Write pending changes now. Resolves when this save (and any earlier one) completes. */
  async flush(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    const chunks = this.sim.world.collectDirty();
    this.inFlight = (async () => {
      try {
        await this.store.saveChunks(this.sim.worldId, chunks);
        await this.store.saveState(
          this.sim.worldId,
          this.sim.exportMeta(this.seed),
          this.sim.exportPlayer(),
          this.sim.exportAdventurers(),
          this.sim.exportSociety(),
        );
      } catch (err) {
        console.error('Save failed', err);
      } finally {
        this.inFlight = null;
      }
    })();
    await this.inFlight;
  }

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onHide);
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
