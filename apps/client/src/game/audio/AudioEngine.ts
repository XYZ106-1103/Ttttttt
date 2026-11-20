/**
 * The game's sound: one AudioContext with music, effect and ambience buses under a master volume
 * and a limiter. Effects are positioned relative to the listener (stereo pan, distance falloff)
 * and rate-limited per sound so crowds of events never turn into noise. Browsers only allow audio
 * after a user gesture, so the context is unlocked on the first click or key press. Without Web
 * Audio (tests, old browsers) every call is a no-op.
 */
import { MusicPlayer, type ThemeId } from './music';
import { SFX, type SfxName } from './sfx';
import { noiseBuffer, type Out, tone } from './synth';

export interface VolumeSettings {
  readonly master: number;
  readonly music: number;
  readonly sfx: number;
}

export interface PlayOptions {
  /** World position (pixels); omitted = heard at full volume, centred (UI, own actions). */
  readonly x?: number;
  readonly y?: number;
  readonly volume?: number;
}

export interface AmbienceState {
  /** 0..1 how much open-air wind is heard (surface vs underground). */
  readonly wind: number;
  /** Night insects (surface at night). */
  readonly crickets: boolean;
  /** Dripping water and hollow space (caves). */
  readonly cave: boolean;
}

/** Minimum time between two plays of the same effect (seconds). */
const MIN_GAP: Partial<Record<SfxName, number>> = {
  step: 0.07,
  step_stone: 0.07,
  step_wood: 0.07,
  hit: 0.025,
  monster_hit: 0.03,
  mine_dirt: 0.05,
  mine_stone: 0.05,
  chop: 0.05,
  pickup: 0.05,
  coin: 0.06,
  swing: 0.04,
  error: 0.4,
  ui_click: 0.03,
  telegraph: 0.2,
};
const MAX_VOICES = 28;
/** Beyond this distance (pixels) positioned sounds are not played. */
const HEARING = 640;

type Ctor = typeof AudioContext;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private music: MusicPlayer | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private readonly lastPlayed = new Map<SfxName, number>();
  private voices = 0;
  private listener = { x: 0, y: 0 };
  private volumes: VolumeSettings = { master: 0.8, music: 0.6, sfx: 0.8 };
  private wantedTheme: ThemeId | null = null;
  private amb: AmbienceState = { wind: 0, crickets: false, cave: false };
  private nextChirp = 0;
  private nextDrip = 0;
  /** Diagnostics: effects played and the most recent ones. */
  played = 0;
  readonly recent: SfxName[] = [];

  constructor() {
    const g = globalThis as unknown as { window?: Window; document?: Document };
    if (!g.window || !g.document || !AudioEngine.ctor()) return;
    const unlock = (): void => {
      this.unlock();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private static ctor(): Ctor | null {
    const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }

  get enabled(): boolean {
    return this.ctx !== null;
  }

  get state(): string {
    return this.ctx?.state ?? 'off';
  }

  /** Create or resume the context (must run inside a user gesture the first time). */
  unlock(): void {
    const C = AudioEngine.ctor();
    if (!C) return;
    if (!this.ctx) {
      try {
        this.ctx = new C({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build(ctx: AudioContext): void {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(limiter);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    for (const b of [this.musicBus, this.sfxBus, this.ambBus]) b.connect(this.master);
    this.music = new MusicPlayer(ctx, this.musicBus);
    this.music.run();
    // Wind: looping noise through a slowly wandering band-pass.
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambBus);
    src.start();
    this.wind = { gain, filter };
    this.applyVolumes();
    if (this.wantedTheme) this.music.play(this.wantedTheme);
  }

  setVolumes(v: VolumeSettings): void {
    this.volumes = v;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.musicBus || !this.sfxBus || !this.ambBus) return;
    const t = ctx.currentTime;
    const curve = (x: number) => Math.max(0, Math.min(1, x)) ** 2;
    this.master.gain.setTargetAtTime(curve(this.volumes.master), t, 0.05);
    this.musicBus.gain.setTargetAtTime(curve(this.volumes.music) * 0.9, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.05);
    this.ambBus.gain.setTargetAtTime(curve(this.volumes.sfx) * 0.8, t, 0.05);
  }

  /** Where the listener is (the player, or the camera on the title screen). */
  setListener(x: number, y: number): void {
    this.listener = { x, y };
  }

  /** Background music theme (null: silence). */
  setTheme(id: ThemeId | null): void {
    this.wantedTheme = id;
    this.music?.play(id);
  }

  get theme(): ThemeId | null {
    return this.music?.current ?? this.wantedTheme;
  }

  /** Play an effect. Returns false when it was skipped (muted, too far, too soon, too busy). */
  play(name: SfxName, opts: PlayOptions = {}): boolean {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.sfxBus) return false;
    const now = ctx.currentTime;
    const gap = MIN_GAP[name] ?? 0.015;
    if (now - (this.lastPlayed.get(name) ?? -1) < gap) return false;
    if (this.voices >= MAX_VOICES) return false;
    let volume = opts.volume ?? 1;
    let pan = 0;
    if (opts.x !== undefined) {
      const dx = opts.x - this.listener.x;
      const dy = (opts.y ?? this.listener.y) - this.listener.y;
      const dist = Math.hypot(dx, dy);
      if (dist > HEARING) return false;
      volume *= 1 / (1 + (dist / 260) ** 2);
      pan = Math.max(-0.85, Math.min(0.85, dx / 360));
      if (volume < 0.03) return false;
    }
    this.lastPlayed.set(name, now);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner);
    panner.connect(this.sfxBus);
    const end = SFX[name]({ ctx, dest: gain, t: now + 0.005 }, Math.random());
    this.voices++;
    this.played++;
    this.recent.push(name);
    if (this.recent.length > 24) this.recent.shift();
    setTimeout(
      () => {
        this.voices--;
        panner.disconnect();
      },
      (end - now) * 1000 + 120,
    );
    return true;
  }

  /** Ambient beds and one-shots; call every frame with the current surroundings. */
  ambience(a: AmbienceState): void {
    this.amb = a;
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || !this.wind || !this.ambBus) return;
    const t = ctx.currentTime;
    const wobble = 0.6 + 0.4 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1);
    this.wind.gain.gain.setTargetAtTime(0.05 * a.wind * wobble, t, 0.8);
    this.wind.filter.frequency.setTargetAtTime(380 + 260 * wobble, t, 1.2);
    const out: Out = { ctx, dest: this.ambBus, t };
    if (a.crickets && t >= this.nextChirp) {
      const f = 4200 + Math.random() * 900;
      const pulses = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < pulses; i++)
        tone({ ...out, t: t + i * 0.055 }, { f, dur: 0.03, gain: 0.012 + Math.random() * 0.008 });
      this.nextChirp = t + 0.4 + Math.random() * 1.6;
    }
    if (a.cave && t >= this.nextDrip) {
      const f = 900 + Math.random() * 1400;
      tone(out, { f: f * 1.5, f2: f, dur: 0.12, gain: 0.035 });
      tone({ ...out, t: t + 0.33 }, { f: f * 1.5, f2: f, dur: 0.12, gain: 0.01 });
      this.nextDrip = t + 1.5 + Math.random() * 4;
    }
  }

  /** Diagnostics for tests and the debug overlay. */
  stats(): Record<string, unknown> {
    return {
      state: this.state,
      played: this.played,
      voices: this.voices,
      theme: this.theme,
      recent: [...this.recent],
      ambience: this.amb,
    };
  }

  /**
   * Render effects or a music theme offline and measure them (peak, RMS, length) — used by the
   * quality checks; also returns 16-bit WAV bytes for listening.
   */
  static async renderOffline(
    what: { sfx: SfxName[] } | { theme: ThemeId; seconds: number },
  ): Promise<{
    peak: number;
    rms: number;
    seconds: number;
    wav: Uint8Array;
    perSound: Record<string, number>;
  }> {
    const rate = 44100;
    const sounds = 'sfx' in what ? what.sfx : [];
    const seconds = 'sfx' in what ? sounds.length * 1.6 + 0.5 : what.seconds;
    const ctx = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
    const bus = ctx.createGain();
    bus.connect(ctx.destination);
    const starts: number[] = [];
    if ('sfx' in what) {
      sounds.forEach((n, i) => {
        starts.push(0.1 + i * 1.6);
        SFX[n]({ ctx, dest: bus, t: 0.1 + i * 1.6 }, 0.5);
      });
    } else {
      const m = new MusicPlayer(ctx, bus);
      m.play(what.theme);
      m.schedule(seconds);
    }
    const buf = await ctx.startRendering();
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    let peak = 0;
    let sum = 0;
    for (const c of ch)
      for (let i = 0; i < c.length; i++) {
        const v = c[i] ?? 0;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
    const perSound: Record<string, number> = {};
    sounds.forEach((n, i) => {
      const a = Math.floor((starts[i] ?? 0) * rate);
      const b = Math.min(ch[0]?.length ?? 0, a + Math.floor(1.5 * rate));
      let p = 0;
      for (let k = a; k < b; k++) p = Math.max(p, Math.abs(ch[0]?.[k] ?? 0));
      perSound[n] = p;
    });
    return {
      peak,
      rms: Math.sqrt(sum / (ch.length * (ch[0]?.length ?? 1))),
      seconds,
      wav: encodeWav(ch, rate),
      perSound,
    };
  }
}

/** 16-bit stereo PCM WAV. */
function encodeWav(channels: Float32Array[], rate: number): Uint8Array {
  const len = channels[0]?.length ?? 0;
  const bytes = new Uint8Array(44 + len * 4);
  const v = new DataView(bytes.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + len * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, len * 4, true);
  let o = 44;
  for (let i = 0; i < len; i++)
    for (const c of channels) {
      const s = Math.max(-1, Math.min(1, c[i] ?? 0));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  return bytes;
}
