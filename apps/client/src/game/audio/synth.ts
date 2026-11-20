/**
 * Small Web Audio synthesis toolkit: enveloped oscillators and filtered noise bursts. Every
 * sound in the game (effects and music) is built from these at play time — no audio files.
 */

/** Where and when a sound is built. */
export interface Out {
  readonly ctx: BaseAudioContext;
  readonly dest: AudioNode;
  /** Start time (context seconds). */
  readonly t: number;
}

const FLOOR = 0.0001;
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise per context, shared by every noise voice. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < d.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      d[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/** Attack to `peak`, then an exponential fall to silence over `decay`. */
function envelope(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  // Silent from the very beginning: a gain node's default is 1, and a source whose start time
  // rounds one frame earlier than this envelope would otherwise let a full-volume sample through
  // (an audible click).
  g.setValueAtTime(0, 0);
  g.setValueAtTime(FLOOR, t);
  g.exponentialRampToValueAtTime(Math.max(FLOOR, peak), t + Math.max(0.001, attack));
  g.exponentialRampToValueAtTime(FLOOR, t + Math.max(0.001, attack) + Math.max(0.005, decay));
}

export interface ToneSpec {
  readonly type?: OscillatorType;
  /** Start frequency (Hz). */
  readonly f: number;
  /** End frequency for a pitch sweep. */
  readonly f2?: number;
  /** Sweep time (defaults to the whole sound). */
  readonly glide?: number;
  /** Decay time after the attack (seconds). */
  readonly dur: number;
  readonly a?: number;
  readonly gain: number;
  /** Low-pass cutoff (Hz). */
  readonly lp?: number;
  /** Start delay (seconds). */
  readonly delay?: number;
  readonly detune?: number;
  /** Vibrato depth (Hz) and rate. */
  readonly vib?: number;
  readonly vibRate?: number;
}

/** An enveloped oscillator, optionally swept and low-passed. Returns its end time. */
export function tone(o: Out, s: ToneSpec): number {
  const { ctx } = o;
  const t = o.t + (s.delay ?? 0);
  const a = s.a ?? 0.005;
  const end = t + a + s.dur;
  const osc = ctx.createOscillator();
  osc.type = s.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(1, s.f), t);
  if (s.f2 !== undefined)
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, s.f2), t + (s.glide ?? a + s.dur));
  if (s.detune) osc.detune.setValueAtTime(s.detune, t);
  let node: AudioNode = osc;
  if (s.lp) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(s.lp, t);
    node.connect(f);
    node = f;
  }
  const g = ctx.createGain();
  envelope(g.gain, t, s.gain, a, s.dur);
  node.connect(g);
  g.connect(o.dest);
  if (s.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(s.vibRate ?? 6, t);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(s.vib, t);
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }
  osc.start(t);
  osc.stop(end + 0.05);
  return end;
}

export interface NoiseSpec {
  readonly dur: number;
  readonly a?: number;
  readonly gain: number;
  readonly filter?: BiquadFilterType;
  /** Filter frequency (Hz) and optional sweep target. */
  readonly f?: number;
  readonly f2?: number;
  readonly q?: number;
  readonly delay?: number;
}

/** A filtered, enveloped noise burst. Returns its end time. */
export function noise(o: Out, s: NoiseSpec): number {
  const { ctx } = o;
  const t = o.t + (s.delay ?? 0);
  const a = s.a ?? 0.003;
  const end = t + a + s.dur;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = s.filter ?? 'lowpass';
  f.frequency.setValueAtTime(s.f ?? 2000, t);
  if (s.f2 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, s.f2), end);
  f.Q.setValueAtTime(s.q ?? 0.8, t);
  const g = ctx.createGain();
  envelope(g.gain, t, s.gain, a, s.dur);
  src.connect(f);
  f.connect(g);
  g.connect(o.dest);
  src.start(t, Math.random() * 1.5);
  src.stop(end + 0.05);
  return end;
}

/** Equal-tempered frequency of a MIDI note. */
export function mtof(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
