import { describe, expect, it } from 'vitest';
import { seedFromString, SIM_DT, IDLE_INPUT } from '@world/shared';
import { createFrameEvents } from '../entities/FrameEvents';
import { GameSimulation } from '../sim/GameSimulation';
import type { AmbienceState, AudioEngine, PlayOptions } from './AudioEngine';
import { GameAudio } from './GameAudio';
import { composePhrase, degree, PHRASE_BARS, type ThemeId, THEMES } from './music';
import { SFX_NAMES, type SfxName } from './sfx';

describe('procedural music', () => {
  it('composes the same phrase from the same seed, and varies across phrases', () => {
    const t = THEMES.day;
    expect(composePhrase(t, 0, 42)).toEqual(composePhrase(t, 0, 42));
    // A A' B A: the B section differs from A.
    expect(composePhrase(t, 2, 42).lead).not.toEqual(composePhrase(t, 0, 42).lead);
  });

  it('keeps every note in the key, in range, inside the phrase, on chord tones on downbeats', () => {
    for (const id of Object.keys(THEMES) as ThemeId[]) {
      const t = THEMES[id];
      const inKey = new Set(t.scale.map((s) => (t.root + s) % 12));
      for (let i = 0; i < 8; i++) {
        const ph = composePhrase(t, i, 1234 + i);
        expect(ph.chords).toHaveLength(PHRASE_BARS);
        expect(ph.lead.length).toBeGreaterThan(0);
        for (const n of [...ph.lead, ...ph.bass]) {
          expect(inKey.has(n.midi % 12)).toBe(true);
          expect(n.midi).toBeGreaterThanOrEqual(24);
          expect(n.midi).toBeLessThanOrEqual(108);
          expect(n.step).toBeGreaterThanOrEqual(0);
          expect(n.step).toBeLessThan(PHRASE_BARS * 16);
        }
        for (const n of ph.lead.filter((x) => x.step % 8 === 0)) {
          const bar = Math.floor(n.step / 16);
          const chordClasses = new Set((ph.chords[bar] ?? []).map((m) => m % 12));
          expect(chordClasses.has(n.midi % 12)).toBe(true);
        }
      }
    }
  });

  it('maps scale degrees across octaves', () => {
    const t = THEMES.day;
    expect(degree(t, 7) - degree(t, 0)).toBe(12);
    expect(degree(t, -7) - degree(t, 0)).toBe(-12);
  });
});

/** Records what the game asks the engine to play. */
class FakeEngine {
  readonly played: { name: SfxName; opts?: PlayOptions }[] = [];
  themeId: ThemeId | null = null;
  amb: AmbienceState | null = null;
  play(name: SfxName, opts?: PlayOptions): boolean {
    this.played.push({ name, opts });
    return true;
  }
  setListener(): void {}
  setTheme(id: ThemeId | null): void {
    this.themeId = id;
  }
  get theme(): ThemeId | null {
    return this.themeId;
  }
  ambience(a: AmbienceState): void {
    this.amb = a;
  }
  names(): SfxName[] {
    return this.played.map((p) => p.name);
  }
}

function setup() {
  const sim = new GameSimulation({
    seed: seedFromString('audio'),
    worldId: 'audio',
    playerName: 'tester',
    adventurers: 0,
    monsters: false,
    warmUp: false,
  });
  sim.respawnPlayer();
  for (let i = 0; i < 30; i++) sim.tick(SIM_DT, IDLE_INPUT);
  const engine = new FakeEngine();
  const audio = new GameAudio(engine as unknown as AudioEngine, sim);
  return { sim, engine, audio };
}

describe('game sounds', () => {
  it('has a recipe for every effect name', () => {
    expect(SFX_NAMES.length).toBeGreaterThan(40);
  });

  it('plays footsteps, jumps and landings from the movement events', () => {
    const { engine, audio } = setup();
    const f = createFrameEvents();
    f.stepped = 1;
    f.jumped = true;
    f.landed = true;
    f.landingSpeed = 500;
    audio.consume(f);
    expect(engine.names()).toEqual(expect.arrayContaining(['jump', 'land']));
    expect(engine.names().some((n) => n.startsWith('step'))).toBe(true);
  });

  it('turns combat, mining and progress events into the right effects', () => {
    const { sim, engine, audio } = setup();
    const p = sim.player;
    const ev = sim.events;
    const tx = Math.floor(p.motor.x / 16);
    const ty = Math.round(p.motor.y / 16);
    ev.uses.push({ action: 'mine', tx, ty, broke: false, drops: [] } as never);
    ev.uses.push({ action: 'place', tx, ty: ty - 3, broke: false, drops: [] } as never);
    ev.combat.push({
      type: 'damage',
      targetId: p.id,
      attackerId: 999,
      amount: 5,
      x: p.motor.x,
      y: p.motor.y,
      crit: false,
      source: 'hit',
    } as never);
    ev.levelUps.push(2);
    ev.notices.push({ kind: 'jobChanged', jobId: 'warrior' } as never);
    ev.pickups.push({ itemId: 'gold', count: 3 } as never);
    audio.consume(createFrameEvents());
    const names = engine.names();
    expect(names).toEqual(
      expect.arrayContaining(['place', 'hurt', 'level_up', 'job_change', 'coin']),
    );
    expect(names.some((n) => n === 'mine_dirt' || n === 'mine_stone' || n === 'chop')).toBe(true);
  });

  it('positions other characters’ sounds in the world and keeps own sounds centred', () => {
    const { sim, engine, audio } = setup();
    const p = sim.player;
    sim.events.combat.push({
      type: 'death',
      targetId: 4242,
      x: p.motor.x + 200,
      y: p.motor.y,
    } as never);
    sim.events.pickups.push({ itemId: 'wood', count: 1 } as never);
    audio.consume(createFrameEvents());
    const death = engine.played.find((x) => x.name === 'monster_die');
    expect(death?.opts?.x).toBeCloseTo(p.motor.x + 200);
    expect(engine.played.find((x) => x.name === 'pickup')?.opts?.x).toBeUndefined();
  });

  it('chooses music and ambience from where the player is and the time of day', () => {
    const { sim, engine, audio } = setup();
    audio.update(0.016, 'title', { x: 0, y: 0 });
    expect(engine.themeId).toBe('title');
    sim.clock.setTime(12);
    audio.update(0.016, 'playing', { x: 0, y: 0 });
    expect(engine.themeId).toBe('town'); // the spawn is the village
    sim.clock.setTime(23);
    for (let i = 0; i < 200; i++) audio.update(0.016, 'playing', { x: 0, y: 0 });
    expect(engine.themeId).toBe('night');
    expect(engine.amb?.crickets).toBe(true);
    // Deep underground: a cave, no crickets.
    const m = sim.player.motor;
    m.y = (sim.world.surfaceY(Math.floor(m.x / 16)) + 30) * 16;
    for (let i = 0; i < 200; i++) audio.update(0.016, 'playing', { x: 0, y: 0 });
    expect(engine.themeId).toBe('cave');
    expect(engine.amb).toMatchObject({ cave: true, crickets: false });
  });
});
