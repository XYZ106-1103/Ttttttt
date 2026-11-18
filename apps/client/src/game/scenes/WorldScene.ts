import Phaser from 'phaser';
import {
  type Adventurer,
  CHUNK_PIXELS,
  toneOf,
  HAND_SPEED,
  HOTBAR_SIZE,
  itemRegistry,
  type MotorInput,
  PLACE_SPEED,
  regionAt,
  seedFromString,
  SIM_DT,
  TILE_SIZE,
  type UseOutcome,
} from '@world/shared';
import { t } from '../../i18n';
import { pushChat, pushPickup, showToast } from '../../app/stores';
import { ParallaxBackground } from '../background/ParallaxBackground';
import { CameraController } from '../camera/CameraController';
import { computeZoom, snapToPixel } from '../display';
import { CharacterView } from '../entities/CharacterView';
import { accumulate, createFrameEvents, resetFrameEvents } from '../entities/FrameEvents';
import { FixedStepper } from '../FixedStepper';
import { ParticleFx } from '../fx/ParticleFx';
import { InteractionController } from '../interaction/InteractionController';
import { CombatPresenter } from '../combat/CombatPresenter';
import { SKILL_ACTIONS } from '../../input/keybindings';
import type { AdventurerDetail, AdventurerSummary } from '../../app/stores';
import { openWindow } from '../../ui/windowActions';
import { SaveManager } from '../persistence/SaveManager';
import { EMPTY_SAVE } from '../persistence/SaveStore';
import { ChunkRenderer, type ViewRect } from '../render/ChunkRenderer';
import { DropRenderer } from '../render/DropRenderer';
import { flicker } from '../render/flicker';
import type { PointLight } from '../render/LightGrid';
import { LightingPipeline } from '../render/LightingPipeline';
import { LightmapRenderer } from '../render/LightmapRenderer';
import { ObjectRenderer } from '../render/ObjectRenderer';
import { TorchRenderer } from '../render/TorchRenderer';
import type { GameServices } from '../services';
import { type ActionIntent, GameSimulation, IDLE_ACTION } from '../sim/GameSimulation';
import { WORLD_ID, WORLD_SEED } from '../worldConfig';

export { WORLD_SEED };
const TITLE_HOUR = 17.6;
const START_HOUR = 9;
/** Chunks of resident world data kept around the view; the rest is evicted. */
const RESIDENT_MARGIN = 6;

type Mode = 'title' | 'playing';

const TOAST_REASONS = new Set([
  'tool_too_weak',
  'unbreakable',
  'supports_object',
  'wrong_tool',
  'blocked_by_body',
  'no_support',
]);

function hexColor(c: string): number {
  return parseInt(c.slice(1), 16);
}

/**
 * Orchestrates the playable world: fixed-step simulation, four-camera rendering
 * (background / lit world / unlit overlay / labels), streaming, lighting, sandbox interaction,
 * saving, FX and UI store publishing.
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
  private interaction!: InteractionController;
  private drops!: DropRenderer;
  private torches!: TorchRenderer;
  private saves!: SaveManager;
  private combatView!: CombatPresenter;
  private publishedPlayerVersion = -1;
  private publishedEquipVersion = -1;
  private playerPublishTimer = 0;
  private advTimer = 0;

  private zoom = 2;
  private viewW = 960;
  private viewH = 540;
  private view: ViewRect = { left: 0, top: 0, width: 960, height: 540 };
  private elapsed = 0;
  private publishTimer = 0;
  private debugTimer = 0;
  private exploreTimer = 0;
  private evictTimer = 0;
  private lastRegion = '';
  private lastToastAt = -10;
  private publishedInventory = -1;
  private publishedSlot = -1;
  private resumeHour = START_HOUR;
  private hadSave = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;
  /** Smoothed CPU time of the scene update (ms) — diagnostics. */
  private updateMs = 0;
  private readonly unsubscribers: (() => void)[] = [];

  constructor(private readonly services: GameServices) {
    super('World');
  }

  create(data?: { autoStart?: boolean }): void {
    const { stores, bridge, assets } = this.services;
    if (!assets.tileset) throw new Error('Tileset was not generated');
    const seed = seedFromString(WORLD_SEED);
    this.mode = 'title';
    this.hadSave = assets.save.player !== null;

    this.sim = new GameSimulation({
      seed,
      worldId: WORLD_ID,
      playerName: t('player.defaultName'),
      startHour: START_HOUR,
      save: assets.save,
    });
    this.resumeHour = this.sim.clock.timeOfDay;
    this.sim.clock.setTime(TITLE_HOUR);
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
    this.drops = new DropRenderer(this, this.worldLayer);
    this.torches = new TorchRenderer(this, this.overlayLayer, this.chunks);
    this.interaction = new InteractionController(
      this,
      this.worldLayer,
      this.overlayLayer,
      assets.tileset,
    );
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
    this.combatView = new CombatPresenter(
      this,
      this.worldLayer,
      this.overlayLayer,
      this.labelLayer,
      this.sim,
      this.player,
      this.cameraCtl,
      stores,
    );
    this.saves = new SaveManager(this.services.saveStore, this.sim, seed);

    this.onResize();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    // Right-click inspects adventurers (the browser menu would get in the way).
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onInspect, this);
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
      selectSlot: (i) => this.sim.selectSlot(i),
      inventoryClick: (i, b) => this.sim.clickInventory(i, b),
      returnCursor: () => this.sim.returnCursor(),
      craft: (id, times) => this.sim.craft(id, times),
      resetWorld: (start) => this.resetWorld(start),
      clickEquipment: (slot) => this.sim.clickEquipment(slot),
      allocateStat: (stat, n) => this.sim.allocateStat(stat, n),
      autoAllocate: () => this.sim.autoAllocate(),
      learnSkill: (id) => this.sim.learnSkill(id),
      setSkillSlot: (slot, id) => this.sim.setSkillSlot(slot, id),
      advanceJob: (id) => this.sim.advanceJob(id),
      respawn: () => {
        const ok = this.sim.requestRespawn();
        if (ok) this.cameraCtl.snap(this.playerTarget(), this.viewW, this.viewH, this.bounds());
        return ok;
      },
      devLevel: (n) => this.sim.devSetLevel(n),
      devSummon: (id) => this.sim.devSpawn(id),
      devGive: (id, n) => {
        if (!itemRegistry.has(id)) return false;
        this.sim.player.inventory.add(id, Math.max(1, Math.min(999, Math.floor(n))));
        return true;
      },
      devHeal: () => {
        const p = this.sim.player;
        if (!p.alive) return;
        p.hp = p.stats.maxHp;
        p.mp = p.stats.maxMp;
      },
      setMonsters: (on) => {
        this.sim.monstersEnabled = on;
        if (!on) this.sim.monsters.clear();
      },
      getWorld: () => this.sim.world,
      getExplored: () => this.sim.explored,
      getPlayerTile: () => ({
        x: Math.floor(this.sim.player.motor.x / TILE_SIZE),
        y: Math.floor((this.sim.player.motor.y - 1) / TILE_SIZE),
      }),
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    this.publishPlayer(true);
    this.publishInventory(true);
    stores.world.set({ seed: world.seed });
    stores.app.set({
      phase: 'title',
      bootProgress: 1,
      bootLabel: t('boot.ready'),
      hasSave: this.hadSave,
    });
    if (data?.autoStart) void this.startGame();
    else this.fadeTo(0, 900);
  }

  private readonly onInspect = (p: Phaser.Input.Pointer): void => {
    if (p.button !== 2 || this.mode !== 'playing') return;
    const wx = this.view.left + p.x / this.zoom;
    const wy = this.view.top + p.y / this.zoom;
    const a = this.combatView.adventurers.pick(this.sim.adventurers.active, wx, wy);
    if (!a) return;
    this.services.stores.adventurers.set({ selected: a.key });
    openWindow(this.services.stores, 'adventurer');
    this.publishAdventurers(true);
  };

  /** Roster and the inspected adventurer's card (2 Hz). */
  private publishAdventurers(force = false): void {
    const { stores } = this.services;
    const ui = stores.ui.get();
    const visible = ui.windows.includes('adventurer') || ui.windows.includes('roster');
    this.advTimer -= 1 / 60;
    if (!force && (!visible || this.advTimer > 0)) return;
    this.advTimer = 0.5;
    const now = this.sim.time;
    const spawnX = this.sim.world.generator.spawnTileX;
    const summary = (a: Adventurer): AdventurerSummary => {
      const c = a.character;
      return {
        key: a.key,
        name: a.profile.name.ko,
        level: c.level,
        jobId: c.jobId,
        archetype: a.profile.archetype,
        active: a.tier === 'active',
        doing: !c.alive ? 'dead' : a.tier === 'active' ? a.action : `abstract_${a.activity}`,
        hp: Math.ceil(c.hp),
        maxHp: c.stats.maxHp,
        alive: c.alive,
        x: Math.floor(c.motor.x / TILE_SIZE) - spawnX,
        affinity: a.memory.relations.get('player')?.affinity ?? 0,
      };
    };
    const list = this.sim.adventurers.all.map(summary);
    const key = stores.adventurers.get().selected;
    const a = key ? this.sim.adventurers.byKey(key) : undefined;
    let detail: AdventurerDetail | null = null;
    if (a) {
      const g = a.goal;
      const rel = a.memory.relations.get('player');
      detail = {
        ...summary(a),
        personality: a.profile.personality,
        tone: toneOf(a.profile.personality),
        skill: a.profile.skill,
        preferredJob: a.profile.preferredJob,
        nightOwl: a.profile.nightOwl,
        goal: g
          ? {
              kind: g.kind,
              params:
                g.kind === 'level'
                  ? { level: g.target }
                  : g.kind === 'item'
                    ? { item: g.itemId, count: g.count }
                    : g.kind === 'slay'
                      ? { monster: g.monsterId, n: g.progress, count: g.count }
                      : { x: Math.round(g.targetX - spawnX) },
            }
          : null,
        memories: a.memory
          .recall(now, 6)
          .map((m) => ({ kind: m.kind, detail: m.detail, ago: now - m.t })),
        scores: Object.entries(a.scores)
          .map(([k, v]) => [k, Math.round((v ?? 0) * 100) / 100] as const)
          .sort((x, y) => y[1] - x[1]),
        met: rel?.met ?? 0,
        helped: rel?.helped ?? 0,
        weapon: a.character.heldWeapon()
          ? (a.character.inventory.get(a.character.selectedSlot)?.itemId ?? null)
          : null,
      };
    }
    stores.adventurers.set({ list, detail });
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
    if (!this.hadSave) this.sim.respawnPlayer();
    this.sim.clock.setTime(this.hadSave ? this.resumeHour : START_HOUR);
    this.player.setVisible(true);
    this.stepper.reset();
    this.cameraCtl.snap(this.playerTarget(), this.viewW, this.viewH, this.bounds());
    this.lastRegion = '';
    stores.app.set({ phase: 'playing' });
    if (stores.chat.get().messages.length === 0) {
      pushChat(stores, 'notice', t('chat.welcome'));
      pushChat(stores, 'system', t('chat.tip'));
      if (this.hadSave) pushChat(stores, 'system', t('save.loaded'));
      if (!this.services.saveStore.persistent) pushChat(stores, 'system', t('save.unavailable'));
    }
    this.hadSave = true;
    await this.saves.flush();
    await this.fadeTo(0, 650);
  }

  private async returnToTitle(): Promise<void> {
    if (this.mode === 'title') return;
    const { stores } = this.services;
    await this.saves.flush();
    await this.fadeTo(1, 400);
    this.resumeHour = this.sim.clock.timeOfDay;
    this.mode = 'title';
    this.player.setVisible(false);
    this.sim.clock.setTime(TITLE_HOUR);
    stores.ui.set({ windows: [], menuOpen: false, chatOpen: false, banner: null });
    stores.app.set({ phase: 'title', hasSave: true });
    this.cameraCtl.snap(this.titleTarget(this.elapsed), this.viewW, this.viewH, this.bounds());
    await this.fadeTo(0, 700);
  }

  private async resetWorld(start: boolean): Promise<void> {
    const { stores, saveStore, assets } = this.services;
    await this.fadeTo(1, 400);
    this.saves.dispose();
    await saveStore.clear(WORLD_ID);
    assets.save = EMPTY_SAVE;
    stores.ui.set({ windows: [], menuOpen: false, chatOpen: false, banner: null });
    stores.chat.set({ messages: [] });
    stores.app.set({ hasSave: false, phase: 'title' });
    this.scene.restart({ autoStart: start });
  }

  private playerTarget(): { x: number; y: number; vx: number; facing: number; grounded: boolean } {
    const m = this.sim.player.motor;
    return { x: m.x, y: m.y, vx: m.vx, facing: m.facing, grounded: m.grounded };
  }

  /** Combat intent for this frame (edges are consumed once per frame). */
  private readAction(canUse: boolean): ActionIntent {
    const input = this.services.input;
    const press = this.interaction.consumeAttackPress();
    let skillSlot: number | null = null;
    SKILL_ACTIONS.forEach((a, i) => {
      if (input.consumePressed(a) && skillSlot === null) skillSlot = i;
    });
    const dodge = input.consumePressed('dodge');
    const quickHeal = input.consumePressed('quickHeal');
    const quickMana = input.consumePressed('quickMana');
    if (!canUse)
      return {
        ...IDLE_ACTION,
        aimX: this.interaction.aim.x,
        aimY: this.interaction.aim.y,
        skillSlot,
        dodge,
        quickHeal,
        quickMana,
      };
    return {
      attackPressed: press,
      attackHeld: this.interaction.leftDown,
      aimX: this.interaction.aim.x,
      aimY: this.interaction.aim.y,
      skillSlot,
      dodge,
      quickHeal,
      quickMana,
    };
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
    const playing = this.mode === 'playing';
    const blockingWindow =
      ui.windows.includes('inventory') ||
      ui.windows.includes('worldMap') ||
      ui.windows.includes('skills') ||
      ui.windows.includes('jobAdvance');
    input.gameplayEnabled = playing && !ui.chatOpen && !ui.menuOpen;
    const canUse = input.gameplayEnabled && !blockingWindow;

    // --- Input → intent (uses last frame's view; the cursor is in screen space) ---------------
    const wheel = this.interaction.consumeWheel();
    if (wheel !== 0 && canUse) {
      this.sim.selectSlot(
        (((this.sim.player.selectedSlot + wheel) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE,
      );
    }
    const intent = this.interaction.update(this.view, this.zoom, this.sim, playing && canUse);
    const action = playing && input.gameplayEnabled ? this.readAction(canUse) : IDLE_ACTION;

    // --- Simulation (fixed step) ------------------------------------------------------------
    resetFrameEvents(this.frameEvents);
    if (playing) {
      let first = true;
      const steps = this.stepper.advance(dt, () => {
        // Edge-triggered inputs only go to the first tick of the frame.
        const a = first
          ? action
          : {
              ...action,
              attackPressed: false,
              skillSlot: null,
              dodge: false,
              quickHeal: false,
              quickMana: false,
            };
        first = false;
        this.sim.tick(SIM_DT, this.readInput(), intent, a);
        accumulate(this.frameEvents, this.sim.player.motor.events);
      });
      if (steps > 0) {
        const ev = this.sim.events;
        this.interaction.settleClick(ev.uses.length > 0 || ev.failed !== null, this.sim.time);
      }
    } else {
      this.stepper.advance(dt, () => this.sim.tickAmbient(SIM_DT));
    }
    this.consumeSimEvents();
    this.combatView.consume(this.zoom);

    // --- Player view & camera ---------------------------------------------------------------
    const p = this.sim.player;
    const m = p.motor;
    const a = this.stepper.alpha;
    const px = p.prevX + (m.x - p.prevX) * a;
    const py = p.prevY + (m.y - p.prevY) * a;
    if (playing) {
      const stack = p.inventory.get(p.selectedSlot);
      this.player.setHeldItem(stack?.itemId ?? null);
      const aim = canUse ? this.interaction.aim : null;
      const look = this.combatView.look();
      this.player.update(
        dt,
        px,
        py,
        m,
        this.frameEvents,
        input.axisX(),
        this.zoom,
        aim,
        this.sim.time,
        this.interaction.holding && this.sim.heldMode() === 'sandbox',
        look,
      );
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
    this.view = view;

    // --- Streaming, background, lighting, FX ------------------------------------------------
    this.chunks.update(view);
    this.objects.update(view, this.elapsed);
    this.torches.update(this.elapsed);
    this.drops.update(this.sim.drops, this.elapsed);
    if (playing) this.combatView.update(dt, a, this.zoom);
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
    if (playing) this.combatView.collectLights(lights);
    this.lightmap.update(view, sky.ambient, lights, this.elapsed);
    this.fx.updateAmbient(dt, view, sky.stars, this.treeTops(view), fires);

    if (playing) {
      this.saves.update(dt);
      this.trackExplored(dt, view);
      this.combatView.publish(dt);
      this.publishAdventurers();
    }
    this.evictFarChunks(dt, view);
    this.publish(dt);
  }

  /** Turn simulation events into FX, animation and UI feedback. */
  private consumeSimEvents(): void {
    const ev = this.sim.events;
    const { stores } = this.services;
    for (const out of ev.uses) this.useFeedback(out);
    for (const pk of ev.pickups) pushPickup(stores, pk.itemId, pk.count);
    if (ev.failed && TOAST_REASONS.has(ev.failed) && this.elapsed - this.lastToastAt > 1.4) {
      this.lastToastAt = this.elapsed;
      showToast(stores, t(`use.${ev.failed}`));
    }
    ev.uses.length = 0;
    ev.pickups.length = 0;
    ev.failed = null;
  }

  private useFeedback(out: UseOutcome): void {
    const p = this.sim.player;
    const stack = p.inventory.get(p.selectedSlot);
    const def = stack ? itemRegistry.get(stack.itemId) : undefined;
    const speed = def?.tool?.speed ?? (out.action === 'place' ? PLACE_SPEED : HAND_SPEED);
    this.player.triggerUse(
      out.action === 'place' ? 'place' : 'swing',
      (1 / speed) * 0.85,
      this.sim.time,
    );
    const cx = out.tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = out.ty * TILE_SIZE + TILE_SIZE / 2;
    if (out.action === 'mine' && !out.hitObject) {
      const tileId = out.brokenTile ?? this.sim.world.getFg(out.tx, out.ty);
      const color = hexColor(this.sim.world.tiles.get(tileId)?.mapColor ?? '#888888');
      this.fx.debris(cx, cy, color, out.broke ? 10 : 4);
    } else if (out.hitObject) {
      const tree = out.hitObject.key.startsWith('tree_');
      if (!out.broke) this.objects.shake(out.hitObject);
      this.fx.debris(
        cx,
        cy,
        tree ? 0x8c5d3c : out.hitObject.key === 'rock' ? 0x6b7182 : 0x62b552,
        out.broke ? 12 : 4,
      );
    } else if (out.action === 'place') {
      this.fx.footDust(cx, cy + 8, 3, 6);
    }
    if (out.broke && out.action !== 'harvest') this.cameraCtl.shake(0.8, 0.08);
  }

  private trackExplored(dt: number, view: ViewRect): void {
    this.exploreTimer -= dt;
    if (this.exploreTimer > 0) return;
    this.exploreTimer = 0.5;
    const w = this.sim.world;
    const cx0 = Math.max(0, Math.floor(view.left / CHUNK_PIXELS));
    const cy0 = Math.max(0, Math.floor(view.top / CHUNK_PIXELS));
    const cx1 = Math.min(w.widthChunks - 1, Math.floor((view.left + view.width) / CHUNK_PIXELS));
    const cy1 = Math.min(w.heightChunks - 1, Math.floor((view.top + view.height) / CHUNK_PIXELS));
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) this.sim.explored.add(cy * w.widthChunks + cx);
  }

  private evictFarChunks(dt: number, view: ViewRect): void {
    this.evictTimer -= dt;
    if (this.evictTimer > 0) return;
    this.evictTimer = 6;
    const cx0 = Math.floor(view.left / CHUNK_PIXELS) - RESIDENT_MARGIN;
    const cy0 = Math.floor(view.top / CHUNK_PIXELS) - RESIDENT_MARGIN;
    const cx1 = Math.floor((view.left + view.width) / CHUNK_PIXELS) + RESIDENT_MARGIN;
    const cy1 = Math.floor((view.top + view.height) / CHUNK_PIXELS) + RESIDENT_MARGIN;
    this.sim.world.evictOutside(cx0, cy0, cx1, cy1);
  }

  private treeTops(view: ViewRect): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    const w = this.sim.world;
    const cx0 = Math.max(0, Math.floor(view.left / CHUNK_PIXELS));
    const cx1 = Math.min(w.widthChunks - 1, Math.floor((view.left + view.width) / CHUNK_PIXELS));
    const cy0 = Math.max(0, Math.floor(view.top / CHUNK_PIXELS));
    const cy1 = Math.min(w.heightChunks - 1, Math.floor((view.top + view.height) / CHUNK_PIXELS));
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

  private publishPlayer(force = false): void {
    const p = this.sim.player;
    const changed =
      force ||
      p.version !== this.publishedPlayerVersion ||
      p.equipment.version !== this.publishedEquipVersion;
    const st = p.stats;
    if (changed) {
      this.publishedPlayerVersion = p.version;
      this.publishedEquipVersion = p.equipment.version;
      this.services.stores.player.set({
        name: p.name,
        jobId: p.jobId,
        level: p.progress.level,
        exp: p.progress.exp,
        expToNext: this.sim.expToNext(),
        stats: p.progress.stats,
        totals: st.totals,
        statPoints: p.progress.statPoints,
        skillPoints: p.progress.skillPoints,
        skills: p.skills,
        skillBar: p.skillBar,
        equipment: p.equipment.snapshot(),
        version: p.version * 1000 + p.equipment.version,
      });
    }
    this.services.stores.player.set({
      hp: Math.ceil(p.hp),
      maxHp: st.maxHp,
      mp: Math.floor(p.mp),
      maxMp: st.maxMp,
      exp: p.progress.exp,
      derived: {
        attack: Math.round(st.attack),
        magic: Math.round(st.magic),
        defense: Math.round(st.defense),
        critRate: st.critRate,
        critDamage: st.critDamage,
        moveSpeed: st.moveSpeed,
        attackSpeed: st.attackSpeed,
        hpRegen: st.hpRegen,
        mpRegen: st.mpRegen,
      },
    });
  }

  private publishInventory(force = false): void {
    const p = this.sim.player;
    if (
      !force &&
      p.inventory.version === this.publishedInventory &&
      p.selectedSlot === this.publishedSlot
    )
      return;
    this.publishedInventory = p.inventory.version;
    this.publishedSlot = p.selectedSlot;
    const snap = p.inventory.snapshot();
    this.services.stores.inventory.set({
      slots: snap.slots,
      cursor: snap.cursor,
      selected: p.selectedSlot,
      version: p.inventory.version,
    });
  }

  /** Throttled store updates — the UI never re-renders at frame rate. */
  private publish(dt: number): void {
    const { stores } = this.services;
    const m = this.sim.player.motor;
    this.publishInventory();
    this.playerPublishTimer -= dt;
    const p = this.sim.player;
    if (
      this.playerPublishTimer <= 0 ||
      p.version !== this.publishedPlayerVersion ||
      p.equipment.version !== this.publishedEquipVersion
    ) {
      this.playerPublishTimer = 0.1;
      this.publishPlayer();
    }
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
          drops: this.sim.drops.length,
          modifiedChunks: this.sim.world.modifiedChunkCount,
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
      selectedSlot: this.sim.player.selectedSlot,
      drops: this.sim.drops.length,
      torches: this.torches.count,
      presses: this.interaction.presses,
      hp: this.sim.player.hp,
      mp: this.sim.player.mp,
      level: this.sim.player.level,
      exp: this.sim.player.progress.exp,
      jobId: this.sim.player.jobId,
      alive: this.sim.player.alive,
      monsters: this.sim.monsters.monsters.filter((x) => x.alive).length,
      monsterSprites: this.combatView.monsters.count,
      adventurersActive: this.sim.adventurers.active.length,
      adventurerSprites: this.combatView.adventurers.count,
    };
  }

  /** Test hook: active adventurers (key, position) for inspection tests. */
  debugAdventurers(): { key: string; x: number; y: number; action: string; level: number }[] {
    return this.sim.adventurers.active.map((a) => ({
      key: a.key,
      x: a.character.motor.x,
      y: a.character.motor.y,
      action: a.action,
      level: a.character.level,
    }));
  }

  /** Test hook: spawn a monster near the player. */
  debugSummon(id: string): boolean {
    return this.sim.devSpawn(id);
  }

  /** Test hook: live monsters (id, def, position, hp). */
  debugMonsters(): { id: number; def: string; x: number; y: number; hp: number; alive: boolean }[] {
    return this.sim.monsters.monsters.map((m) => ({
      id: m.id,
      def: m.def.id,
      x: m.motor.x,
      y: m.motor.y,
      hp: m.hp,
      alive: m.alive,
    }));
  }

  /** Test/debug hook: tile id at a position (read-only). */
  debugTile(tx: number, ty: number): number {
    return this.sim.world.getFg(tx, ty);
  }

  /** Test/debug hook: count of an item in the player's inventory (read-only). */
  debugCount(itemId: string): number {
    return this.sim.player.inventory.count(itemId);
  }

  /** Test hook: flush pending saves and resolve when written. */
  debugFlushSave(): Promise<void> {
    return this.saves.flush();
  }

  private shutdown(): void {
    void this.saves.flush();
    this.saves.dispose();
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
    this.services.bridge.detach();
    this.input.off('pointerdown', this.onInspect, this);
    this.interaction.destroy();
    this.chunks.destroy();
    this.objects.destroy();
    this.drops.destroy();
    this.torches.destroy();
    this.lightmap.destroy();
    this.combatView.destroy();
    this.player.destroy();
  }
}
