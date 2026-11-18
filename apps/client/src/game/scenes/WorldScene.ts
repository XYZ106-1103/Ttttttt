import Phaser from 'phaser';
import {
  deriveStats,
  type MotorInput,
  regionAt,
  seedFromString,
  SIM_DT,
  TILE_SIZE,
} from '@world/shared';
import { t } from '../../i18n';
import { pushChat } from '../../app/stores';
import { ParallaxBackground } from '../background/ParallaxBackground';
import { CameraController } from '../camera/CameraController';
import { computeZoom, snapToPixel } from '../display';
import { CharacterView } from '../entities/CharacterView';
import { accumulate, createFrameEvents, resetFrameEvents } from '../entities/FrameEvents';
import { FixedStepper } from '../FixedStepper';
import { ParticleFx } from '../fx/ParticleFx';
import { ChunkRenderer, type ViewRect } from '../render/ChunkRenderer';
import { flicker } from '../render/flicker';
import type { PointLight } from '../render/LightGrid';
import { LightingPipeline } from '../render/LightingPipeline';
import { LightmapRenderer } from '../render/LightmapRenderer';
import { ObjectRenderer } from '../render/ObjectRenderer';
import type { GameServices } from '../services';
import { GameSimulation } from '../sim/GameSimulation';

export const WORLD_SEED = 'PROJECT-WORLD';
const TITLE_HOUR = 17.6;
const START_HOUR = 9;

type Mode = 'title' | 'playing';

/**
 * Orchestrates the playable world: fixed-step simulation, three-camera rendering
 * (background / lit world / unlit overlay), streaming, lighting, FX and UI store publishing.
 */
export class WorldScene extends Phaser.Scene {
  private sim!: GameSimulation;
  private mode: Mode = 'title';
  private readonly stepper = new FixedStepper(SIM_DT);
  private readonly frameEvents = createFrameEvents();
  private readonly cameraCtl = new CameraController();

  private bgLayer!: Phaser.GameObjects.Layer;
  private worldLayer!: Phaser.GameObjects.Layer;
  private overlayLayer!: Phaser.GameObjects.Layer;
  private labelLayer!: Phaser.GameObjects.Layer;
  private labelCam!: Phaser.Cameras.Scene2D.Camera;
  private bgCam!: Phaser.Cameras.Scene2D.Camera;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private overlayCam!: Phaser.Cameras.Scene2D.Camera;

  private chunks!: ChunkRenderer;
  private objects!: ObjectRenderer;
  private lightmap!: LightmapRenderer;
  private parallax!: ParallaxBackground;
  private player!: CharacterView;
  private fx!: ParticleFx;

  private zoom = 2;
  private viewW = 960;
  private viewH = 540;
  private elapsed = 0;
  private publishTimer = 0;
  private debugTimer = 0;
  private lastRegion = '';
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  /** Smoothed CPU time of the scene update (ms) — diagnostics. */
  private updateMs = 0;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly services: GameServices) {
    super('World');
  }

  create(): void {
    const { stores, bridge, assets } = this.services;
    if (!assets.tileset) throw new Error('Tileset was not generated');

    this.sim = new GameSimulation({
      seed: seedFromString(WORLD_SEED),
      playerName: t('player.defaultName'),
      startHour: TITLE_HOUR,
    });
    const world = this.sim.world;

    // --- Layers & cameras -------------------------------------------------------------------
    this.bgLayer = this.add.layer();
    this.worldLayer = this.add.layer();
    this.overlayLayer = this.add.layer();
    this.labelLayer = this.add.layer();
    this.bgCam = this.cameras.main;
    this.worldCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'world');
    this.overlayCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'overlay');
    // Labels (name tags, later damage numbers) render at 1× so pixel fonts stay at native size.
    this.labelCam = this.cameras.add(0, 0, this.scale.width, this.scale.height, false, 'labels');
    const all = [this.bgLayer, this.worldLayer, this.overlayLayer, this.labelLayer];
    const pairs: [Phaser.Cameras.Scene2D.Camera, Phaser.GameObjects.Layer][] = [
      [this.bgCam, this.bgLayer],
      [this.worldCam, this.worldLayer],
      [this.overlayCam, this.overlayLayer],
      [this.labelCam, this.labelLayer],
    ];
    for (const [cam, own] of pairs) {
      cam.ignore(all.filter((l) => l !== own));
      cam.setRoundPixels(false);
    }

    let pipeline: LightingPipeline | null = null;
    if (this.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
      this.worldCam.setPostPipeline(LightingPipeline);
      const p = this.worldCam.getPostPipeline(LightingPipeline);
      pipeline = (Array.isArray(p) ? p[0] : p) as LightingPipeline | null;
    }

    // --- Systems ----------------------------------------------------------------------------
    const horizonY = world.surfaceY(world.generator.spawnTileX) * TILE_SIZE;
    this.parallax = new ParallaxBackground(this, this.bgLayer, assets.parallax, horizonY);
    this.chunks = new ChunkRenderer(this, this.worldLayer, world, assets.tileset, 0);
    this.objects = new ObjectRenderer(this, this.worldLayer, this.overlayLayer, world);
    this.lightmap = new LightmapRenderer(this, world, pipeline);
    this.fx = new ParticleFx(this, this.worldLayer, this.overlayLayer);
    this.player = new CharacterView(
      this,
      this.worldLayer,
      this.labelLayer,
      'player',
      this.sim.player.name,
      world,
    );
    this.player.runSpeed = this.sim.movement.runSpeed;
    this.player.setVisible(false);

    this.onResize();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.unsubscribers.push(stores.settings.subscribe(() => this.onResize()));
    this.cameraCtl.snap(this.titleTarget(0), this.viewW, this.viewH, this.bounds());

    bridge.attach({
      startGame: () => this.startGame(),
      returnToTitle: () => this.returnToTitle(),
      setTimeOfDay: (h) => this.sim.clock.setTime(h),
      teleport: (tx, ty) => {
        const ok = this.sim.placePlayer(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE);
        if (ok) this.cameraCtl.snap(this.playerTarget(), this.viewW, this.viewH, this.bounds());
        return ok;
      },
      spawn: () => {
        this.sim.respawnPlayer();
        this.cameraCtl.snap(this.playerTarget(), this.viewW, this.viewH, this.bounds());
      },
      getWorld: () => this.sim.world,
      getPlayerTile: () => ({
        x: Math.floor(this.sim.player.motor.x / TILE_SIZE),
        y: Math.floor((this.sim.player.motor.y - 1) / TILE_SIZE),
      }),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    this.publishPlayer();
    stores.world.set({ seed: world.seed });
    stores.app.set({ phase: 'title', bootProgress: 1, bootLabel: t('boot.ready') });
    this.fadeTo(0, 900);
  }

  private bounds(): { width: number; height: number } {
    return { width: this.sim.world.widthPixels, height: this.sim.world.heightPixels };
  }

  private titleTarget(time: number): {
    x: number;
    y: number;
    vx: number;
    facing: number;
    grounded: boolean;
  } {
    const w = this.sim.world;
    const sx = w.generator.spawnTileX * TILE_SIZE;
    const x = sx + 260 + Math.sin(time * 0.035) * 520;
    const y = w.surfaceY(Math.floor(x / TILE_SIZE)) * TILE_SIZE;
    return { x, y, vx: 0, facing: 1, grounded: true };
  }

  private onResize(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.zoom = computeZoom(height, this.services.stores.settings.get().zoom);
    this.viewW = width / this.zoom;
    this.viewH = height / this.zoom;
    for (const cam of [this.bgCam, this.worldCam, this.overlayCam]) {
      cam.setSize(width, height);
      cam.setZoom(this.zoom);
    }
    this.labelCam.setSize(width, height);
    this.parallax.resize(this.viewW, this.viewH);
    this.cameraCtl.shakeEnabled = this.services.stores.settings.get().screenShake;
  }

  /** Position a camera so the top-left of its view is (left, top) in its own space. */
  private setView(cam: Phaser.Cameras.Scene2D.Camera, left: number, top: number): void {
    cam.scrollX = left - (cam.width / 2) * (1 - 1 / this.zoom);
    cam.scrollY = top - (cam.height / 2) * (1 - 1 / this.zoom);
  }

  private fadeTo(target: number, ms: number): Promise<void> {
    const app = this.services.stores.app;
    return new Promise((resolve) => {
      this.tweens.addCounter({
        from: app.get().fade,
        to: target,
        duration: ms,
        ease: 'Sine.easeInOut',
        onUpdate: (tw) => app.set({ fade: tw.getValue() ?? target }),
        onComplete: () => resolve(),
      });
    });
  }

  private async startGame(): Promise<void> {
    if (this.mode === 'playing') return;
    const { stores } = this.services;
    await this.fadeTo(1, 450);
    this.mode = 'playing';
    this.sim.respawnPlayer();
    this.sim.clock.setTime(START_HOUR);
    this.player.setVisible(true);
    this.stepper.reset();
    this.cameraCtl.snap(this.playerTarget(), this.viewW, this.viewH, this.bounds());
    this.lastRegion = '';
    stores.app.set({ phase: 'playing' });
    if (stores.chat.get().messages.length === 0) {
      pushChat(stores, 'notice', t('chat.welcome'));
      pushChat(stores, 'system', t('chat.tip'));
    }
    await this.fadeTo(0, 650);
  }

  private async returnToTitle(): Promise<void> {
    if (this.mode === 'title') return;
    const { stores } = this.services;
    await this.fadeTo(1, 400);
    this.mode = 'title';
    this.player.setVisible(false);
    this.sim.clock.setTime(TITLE_HOUR);
    stores.ui.set({ windows: [], menuOpen: false, chatOpen: false, banner: null });
    stores.app.set({ phase: 'title' });
    this.cameraCtl.snap(this.titleTarget(this.elapsed), this.viewW, this.viewH, this.bounds());
    await this.fadeTo(0, 700);
  }

  private playerTarget(): { x: number; y: number; vx: number; facing: number; grounded: boolean } {
    const m = this.sim.player.motor;
    return { x: m.x, y: m.y, vx: m.vx, facing: m.facing, grounded: m.grounded };
  }

  private readInput(): MotorInput {
    const input = this.services.input;
    return {
      moveX: input.axisX(),
      jumpHeld: input.isHeld('jump'),
      jumpPressed: input.consumePressed('jump'),
      down: input.isHeld('down'),
    };
  }

  override update(_time: number, deltaMs: number): void {
    const t0 = performance.now();
    this.updateFrame(deltaMs);
    this.updateMs = this.updateMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private updateFrame(deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.1);
    this.elapsed += dt;
    this.trackFps(dt);
    const { stores, input } = this.services;
    const ui = stores.ui.get();
    input.gameplayEnabled = this.mode === 'playing' && !ui.chatOpen && !ui.menuOpen;

    // --- Simulation (fixed step) ------------------------------------------------------------
    resetFrameEvents(this.frameEvents);
    if (this.mode === 'playing') {
      this.stepper.advance(dt, () => {
        this.sim.tick(SIM_DT, this.readInput());
        accumulate(this.frameEvents, this.sim.player.motor.events);
      });
    } else {
      this.stepper.advance(dt, () => this.sim.tickAmbient(SIM_DT));
    }

    // --- Player view & camera ---------------------------------------------------------------
    const p = this.sim.player;
    const m = p.motor;
    const a = this.stepper.alpha;
    const px = p.prevX + (m.x - p.prevX) * a;
    const py = p.prevY + (m.y - p.prevY) * a;
    if (this.mode === 'playing') {
      this.player.update(dt, px, py, m, this.frameEvents, input.axisX(), this.zoom);
      this.cameraCtl.update(
        { x: px, y: py, vx: m.vx, facing: m.facing, grounded: m.grounded },
        this.viewW,
        this.viewH,
        this.bounds(),
        dt,
      );
      this.handleFrameFx(px, py);
    } else {
      const tt = this.titleTarget(this.elapsed);
      this.cameraCtl.panTo(
        tt.x,
        tt.y - this.viewH * 0.18,
        this.viewW,
        this.viewH,
        this.bounds(),
        dt,
      );
    }
    const left = snapToPixel(this.cameraCtl.left, this.zoom);
    const top = snapToPixel(this.cameraCtl.top, this.zoom);
    this.setView(this.worldCam, left, top);
    this.setView(this.overlayCam, left, top);
    this.setView(this.bgCam, 0, 0);
    this.labelCam.scrollX = Math.round(left * this.zoom);
    this.labelCam.scrollY = Math.round(top * this.zoom);
    const view: ViewRect = { left, top, width: this.viewW, height: this.viewH };

    // --- Streaming, background, lighting, FX ------------------------------------------------
    this.chunks.update(view);
    this.objects.update(view, this.elapsed);
    const sky = this.parallax.update(view, this.sim.clock.timeOfDay, dt, this.elapsed);
    const lights: PointLight[] = [];
    const fires: { x: number; y: number }[] = [];
    for (const l of this.objects.lights()) {
      const f = flicker(this.elapsed, l.object.seed, l.light.flicker);
      lights.push({
        tx: l.object.tx,
        ty: l.object.ty,
        r: l.light.color[0] * f,
        g: l.light.color[1] * f,
        b: l.light.color[2] * f,
      });
      fires.push({ x: l.x, y: l.y });
    }
    this.lightmap.update(view, sky.ambient, lights);
    this.fx.updateAmbient(dt, view, sky.stars, this.treeTops(view), fires);

    this.publish(dt);
  }

  private treeTops(view: ViewRect): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const w = this.sim.world;
    const cx0 = Math.max(0, Math.floor(view.left / 512));
    const cx1 = Math.min(w.widthChunks - 1, Math.floor((view.left + view.width) / 512));
    const cy0 = Math.max(0, Math.floor(view.top / 512));
    const cy1 = Math.min(w.heightChunks - 1, Math.floor((view.top + view.height) / 512));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const o of w.objectsInChunk(cx, cy)) {
          if (o.key === 'tree_oak') out.push({ x: o.tx * 16 + 8, y: o.ty * 16 - 50 });
        }
      }
    }
    return out;
  }

  private handleFrameFx(px: number, py: number): void {
    const ev = this.frameEvents;
    const m = this.sim.player.motor;
    if (ev.jumped) this.fx.footDust(px, py, 4, 5);
    if (ev.landed && ev.landingSpeed > 200) {
      const k = Math.min(1, (ev.landingSpeed - 200) / 400);
      this.fx.footDust(px, py, 3 + Math.round(k * 7), 6 + k * 6);
      if (ev.landingSpeed > 560) this.cameraCtl.shake(2.5 * k, 0.18);
    }
    this.fx.updatePlayer(1 / 60, px, py, m.vx, m.grounded);
  }

  private trackFps(dt: number): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  private publishPlayer(): void {
    const p = this.sim.player;
    const d = deriveStats(p.progress);
    this.services.stores.player.set({
      name: p.name,
      jobId: p.jobId,
      level: p.progress.level,
      exp: p.progress.exp,
      expToNext: this.sim.expToNext(),
      hp: p.hp,
      maxHp: d.maxHp,
      mp: p.mp,
      maxMp: d.maxMp,
      stats: p.progress.stats,
      statPoints: p.progress.statPoints,
    });
  }

  /** Throttled store updates — the UI never re-renders at frame rate. */
  private publish(dt: number): void {
    const { stores } = this.services;
    const m = this.sim.player.motor;
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publishTimer = 0.25;
      const tx = Math.floor(m.x / TILE_SIZE);
      const ty = Math.floor((m.y - 1) / TILE_SIZE);
      const region = regionAt(tx, this.sim.world.generator.spawnTileX);
      stores.world.set({
        timeOfDay: this.sim.clock.timeOfDay,
        day: this.sim.clock.day,
        regionId: region.id,
        regionNameKey: region.nameKey,
        tileX: tx,
        tileY: ty,
      });
      if (this.mode === 'playing' && region.id !== this.lastRegion) {
        this.lastRegion = region.id;
        stores.ui.set((u) => ({
          banner: { id: (u.banner?.id ?? 0) + 1, regionKey: region.nameKey },
        }));
      }
    }
    if (stores.ui.get().debugVisible || stores.settings.get().showFps) {
      this.debugTimer -= dt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.25;
        stores.debug.set({
          fps: this.fps,
          x: Math.round(m.x),
          y: Math.round(m.y),
          vx: Math.round(m.vx),
          vy: Math.round(m.vy),
          grounded: m.grounded,
          chunksRendered: this.chunks.renderedCount,
          chunksGenerated: this.sim.world.chunkCount,
          objects: this.objects.count,
          simSteps: this.sim.tickCount,
          updateMs: Math.round(this.updateMs * 100) / 100,
        });
      }
    }
  }

  /** Test/debug hook: exposes read-only state for automated E2E checks. */
  debugSnapshot(): Record<string, unknown> {
    const m = this.sim.player.motor;
    return {
      mode: this.mode,
      x: m.x,
      y: m.y,
      vx: m.vx,
      vy: m.vy,
      grounded: m.grounded,
      zoom: this.zoom,
      hour: this.sim.clock.timeOfDay,
      camera: { left: this.cameraCtl.left, top: this.cameraCtl.top },
      chunks: this.chunks.renderedCount,
      fps: this.fps,
      updateMs: Math.round(this.updateMs * 100) / 100,
    };
  }

  private shutdown(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    for (const u of this.unsubscribers) u();
    this.services.bridge.detach();
    this.chunks.destroy();
    this.objects.destroy();
    this.lightmap.destroy();
    this.player.destroy();
  }
}
