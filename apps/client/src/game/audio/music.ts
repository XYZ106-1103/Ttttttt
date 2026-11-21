/**
 * Procedural background music. Each theme is a small style sheet (tempo, key, mode, chord
 * progression, instruments, drum patterns); phrases of four bars are composed from it with a
 * seeded random walk (chord tones on strong beats, rests by density) and played with
 * synthesized instruments. Phrases repeat with variation (A A' B A), so themes have shape
 * without looping identically.
 */
import { Rng } from '@world/shared';
import { mtof, noise, type Out, tone } from './synth';

export type ThemeId = 'title' | 'day' | 'night' | 'cave' | 'town' | 'boss' | 'snow' | 'volcano';

interface Instrument {
  readonly type: OscillatorType;
  readonly gain: number;
  readonly lp: number;
}

export interface Theme {
  readonly id: ThemeId;
  readonly bpm: number;
  /** MIDI note of the key's root (around the bass register). */
  readonly root: number;
  /** Scale as semitone offsets from the root. */
  readonly scale: readonly number[];
  /** Chord per bar, as scale degrees (0-based), cycled. */
  readonly progression: readonly number[];
  readonly pad: Instrument & { readonly attack: number };
  readonly bass: Instrument & { readonly steps: readonly number[] };
  readonly lead: Instrument & {
    readonly density: number;
    readonly octave: number;
    readonly vibrato?: number;
  };
  /** Optional arpeggio (steps of 16 with a note). */
  readonly arp?: Instrument & { readonly steps: readonly number[] };
  /** Drums: 16-step patterns (1 = hit). */
  readonly drums?: {
    readonly gain: number;
    readonly kick: readonly number[];
    readonly snare: readonly number[];
    readonly hat: readonly number[];
  };
  /** Echo send (0..1). */
  readonly echo: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

const p = (s: string): number[] => [...s].map((c) => (c === 'x' ? 1 : 0));

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  title: {
    id: 'title',
    bpm: 72,
    root: 50,
    scale: LYDIAN,
    progression: [0, 4, 5, 3],
    pad: { type: 'sawtooth', gain: 0.05, lp: 1100, attack: 1.2 },
    bass: { type: 'triangle', gain: 0.12, lp: 600, steps: p('x.......x.......') },
    lead: { type: 'triangle', gain: 0.07, lp: 2600, density: 0.32, octave: 2, vibrato: 3 },
    arp: { type: 'sine', gain: 0.03, lp: 3000, steps: p('x...x...x...x...') },
    echo: 0.45,
  },
  day: {
    id: 'day',
    bpm: 96,
    root: 53,
    scale: MAJOR,
    progression: [0, 3, 4, 0, 5, 3, 1, 4],
    pad: { type: 'sawtooth', gain: 0.035, lp: 1500, attack: 0.5 },
    bass: { type: 'triangle', gain: 0.13, lp: 700, steps: p('x...x...x...x...') },
    lead: { type: 'square', gain: 0.035, lp: 2400, density: 0.45, octave: 2 },
    arp: { type: 'triangle', gain: 0.03, lp: 3200, steps: p('x.x.x.x.x.x.x.x.') },
    drums: {
      gain: 0.5,
      kick: p('x.......x.......'),
      snare: p('....x.......x...'),
      hat: p('..x...x...x...x.'),
    },
    echo: 0.25,
  },
  night: {
    id: 'night',
    bpm: 66,
    root: 57,
    scale: MINOR,
    progression: [0, 5, 3, 4],
    pad: { type: 'sawtooth', gain: 0.045, lp: 800, attack: 1.5 },
    bass: { type: 'sine', gain: 0.14, lp: 400, steps: p('x...............') },
    lead: { type: 'triangle', gain: 0.06, lp: 1800, density: 0.22, octave: 2, vibrato: 4 },
    echo: 0.55,
  },
  cave: {
    id: 'cave',
    bpm: 58,
    root: 49,
    scale: PHRYGIAN,
    progression: [0, 0, 1, 0, 6, 0, 1, 5],
    pad: { type: 'sawtooth', gain: 0.04, lp: 480, attack: 2 },
    bass: { type: 'sine', gain: 0.15, lp: 300, steps: p('x...............') },
    lead: { type: 'sine', gain: 0.06, lp: 1400, density: 0.14, octave: 2 },
    echo: 0.65,
  },
  town: {
    id: 'town',
    bpm: 108,
    root: 55,
    scale: MAJOR,
    progression: [0, 3, 4, 0, 0, 5, 3, 4],
    pad: { type: 'triangle', gain: 0.04, lp: 2000, attack: 0.2 },
    bass: { type: 'triangle', gain: 0.13, lp: 800, steps: p('x.....x.x.......') },
    lead: { type: 'square', gain: 0.032, lp: 2800, density: 0.55, octave: 2 },
    arp: { type: 'square', gain: 0.022, lp: 2600, steps: p('x.xx.xx.x.xx.xx.') },
    drums: {
      gain: 0.45,
      kick: p('x.....x.x.......'),
      snare: p('....x.......x...'),
      hat: p('x.x.x.x.x.x.x.x.'),
    },
    echo: 0.2,
  },
  snow: {
    id: 'snow',
    bpm: 76,
    root: 54,
    scale: LYDIAN,
    progression: [0, 4, 3, 0, 5, 4, 1, 4],
    pad: { type: 'triangle', gain: 0.045, lp: 1600, attack: 1.4 },
    bass: { type: 'sine', gain: 0.12, lp: 500, steps: p('x.......x.......') },
    lead: { type: 'sine', gain: 0.07, lp: 3600, density: 0.3, octave: 2, vibrato: 2 },
    arp: { type: 'triangle', gain: 0.025, lp: 4200, steps: p('x..x..x..x..x...') },
    echo: 0.6,
  },
  volcano: {
    id: 'volcano',
    bpm: 92,
    root: 50,
    scale: PHRYGIAN,
    progression: [0, 1, 0, 6, 0, 1, 5, 6],
    pad: { type: 'sawtooth', gain: 0.045, lp: 700, attack: 0.6 },
    bass: { type: 'sawtooth', gain: 0.1, lp: 600, steps: p('x..x..x.x..x..x.') },
    lead: { type: 'square', gain: 0.03, lp: 1800, density: 0.35, octave: 2 },
    drums: {
      gain: 0.5,
      kick: p('x.....x...x.....'),
      snare: p('....x.......x...'),
      hat: p('..x...x...x...x.'),
    },
    echo: 0.3,
  },
  boss: {
    id: 'boss',
    bpm: 144,
    root: 52,
    scale: HARMONIC,
    progression: [0, 0, 5, 4, 0, 0, 3, 4],
    pad: { type: 'sawtooth', gain: 0.04, lp: 1300, attack: 0.1 },
    bass: { type: 'sawtooth', gain: 0.09, lp: 900, steps: p('x.xxx.xxx.xxx.xx') },
    lead: { type: 'square', gain: 0.04, lp: 3000, density: 0.6, octave: 2 },
    drums: {
      gain: 0.6,
      kick: p('x...x...x...x.x.'),
      snare: p('....x.......x..x'),
      hat: p('xxxxxxxxxxxxxxxx'),
    },
    echo: 0.15,
  },
};

export interface NoteEvent {
  /** Step within the phrase (16 per bar). */
  readonly step: number;
  /** Length in steps. */
  readonly len: number;
  readonly midi: number;
  readonly vel: number;
}

export interface Phrase {
  readonly bars: number;
  /** Chord notes (MIDI) per bar. */
  readonly chords: readonly (readonly number[])[];
  readonly lead: readonly NoteEvent[];
  readonly bass: readonly NoteEvent[];
}

export const PHRASE_BARS = 4;
const STEPS = 16;

/** MIDI note of a scale degree (any integer; wraps into octaves). */
export function degree(theme: Theme, d: number, octave = 0): number {
  const n = theme.scale.length;
  const o = Math.floor(d / n);
  const i = ((d % n) + n) % n;
  return theme.root + (theme.scale[i] ?? 0) + 12 * (o + octave);
}

/**
 * Compose one phrase. The form A A' B A repeats a motif across phrases: `index` picks the
 * section, `seed` the theme's material.
 */
export function composePhrase(theme: Theme, index: number, seed: number): Phrase {
  const section = [0, 1, 2, 0][index % 4] ?? 0;
  const motif = new Rng((seed ^ (section * 0x9e37)) >>> 0);
  const vary = new Rng((seed + index * 7919) >>> 0);
  const prog = theme.progression;
  const firstBar = (index * PHRASE_BARS) % prog.length;
  const chords: number[][] = [];
  const lead: NoteEvent[] = [];
  const bass: NoteEvent[] = [];
  let pos = 2; // melody walk position (scale degrees above the chord root)
  for (let b = 0; b < PHRASE_BARS; b++) {
    const root = prog[(firstBar + b) % prog.length] ?? 0;
    const chord = [root, root + 2, root + 4].map((d) => degree(theme, d, 1));
    chords.push(chord);
    for (let s = 0; s < STEPS; s++) {
      if (theme.bass.steps[s])
        bass.push({
          step: b * STEPS + s,
          len: 2,
          midi: degree(theme, root, 0),
          vel: s === 0 ? 1 : 0.8,
        });
    }
    // Melody on eighth notes; strong beats prefer chord tones.
    for (let s = 0; s < STEPS; s += 2) {
      const r = section === 1 && b >= 2 ? vary.next() : motif.next();
      if (r > theme.lead.density && s !== 0) continue;
      const strong = s % 8 === 0;
      const stepMove = Math.round((motif.next() - 0.5) * 4);
      pos = Math.max(-2, Math.min(9, pos + stepMove));
      let d = root + pos;
      if (strong) {
        const tones = [root, root + 2, root + 4, root + 7];
        d = tones.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best), root);
      }
      const len = motif.next() < 0.3 ? 4 : 2;
      lead.push({
        step: b * STEPS + s,
        len,
        midi: degree(theme, d, theme.lead.octave),
        vel: strong ? 1 : 0.75,
      });
    }
  }
  return { bars: PHRASE_BARS, chords, lead, bass };
}

/**
 * Plays themes in real time: a look-ahead scheduler builds notes a little before they are due,
 * and theme changes crossfade at the next bar.
 */
export class MusicPlayer {
  private theme: Theme | null = null;
  private pending: Theme | null = null;
  private phrase: Phrase | null = null;
  private phraseIndex = 0;
  private step = 0;
  private nextTime = 0;
  private seed = 0x51ced;
  private readonly bus: GainNode;
  private readonly echoIn: GainNode;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    // A soft feedback echo gives the synth music space.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.35;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.echoIn.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.bus);
  }

  get current(): ThemeId | null {
    return (this.pending ?? this.theme)?.id ?? null;
  }

  /** Switch to a theme (crossfades at the next bar; same theme: nothing). */
  play(id: ThemeId | null): void {
    const next = id ? THEMES[id] : null;
    if (next === (this.pending ?? this.theme)) return;
    if (!this.theme) {
      if (!next) return;
      this.start(next);
      return;
    }
    this.pending = next;
  }

  /** Drive scheduling from a timer (live context). */
  run(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.schedule(this.ctx.currentTime + 0.15), 30);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private start(theme: Theme): void {
    this.theme = theme;
    this.pending = null;
    this.phraseIndex = 0;
    this.step = 0;
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    this.phrase = composePhrase(theme, 0, this.seed);
    const t = Math.max(this.ctx.currentTime + 0.05, this.nextTime);
    this.nextTime = t;
    const g = this.bus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(1, t + 2.5);
  }

  /** Schedule every step due before `until` (also used for offline rendering). */
  schedule(until: number): void {
    while (this.theme && this.nextTime < until) {
      const theme = this.theme;
      const stepDur = 60 / theme.bpm / 4;
      const t = this.nextTime;
      const inBar = this.step % STEPS;
      if (inBar === 0 && this.pending !== null && this.pending !== theme) {
        // Fade out, then begin the new theme from its first phrase.
        const next = this.pending;
        const g = this.bus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(Math.max(0.0001, g.value), t);
        g.linearRampToValueAtTime(0.0001, t + 1.5);
        this.nextTime = t + 1.5;
        this.theme = null;
        if (next) this.start(next);
        continue;
      }
      this.playStep(theme, t, stepDur);
      this.step++;
      if (this.step >= PHRASE_BARS * STEPS) {
        this.step = 0;
        this.phraseIndex++;
        this.phrase = composePhrase(theme, this.phraseIndex, this.seed);
      }
      this.nextTime += stepDur;
    }
  }

  private playStep(theme: Theme, t: number, stepDur: number): void {
    const phrase = this.phrase;
    if (!phrase) return;
    const ctx = this.ctx;
    const dry: Out = { ctx, dest: this.bus, t };
    const wet: Out = { ctx, dest: this.echoIn, t };
    const bar = Math.floor(this.step / STEPS);
    const inBar = this.step % STEPS;
    const chord = phrase.chords[bar] ?? [];
    const barDur = stepDur * STEPS;
    if (inBar === 0)
      for (const n of chord) {
        for (const det of [-7, 7])
          tone(dry, {
            type: theme.pad.type,
            f: mtof(n),
            detune: det,
            a: Math.min(theme.pad.attack, barDur * 0.5),
            dur: barDur * 0.9,
            gain: theme.pad.gain / 2,
            lp: theme.pad.lp,
          });
      }
    for (const b of phrase.bass)
      if (b.step === this.step)
        tone(dry, {
          type: theme.bass.type,
          f: mtof(b.midi),
          a: 0.01,
          dur: stepDur * b.len * 1.6,
          gain: theme.bass.gain * b.vel,
          lp: theme.bass.lp,
        });
    for (const n of phrase.lead)
      if (n.step === this.step) {
        const spec = {
          type: theme.lead.type,
          f: mtof(n.midi),
          a: 0.012,
          dur: stepDur * n.len * 1.4,
          gain: theme.lead.gain * n.vel,
          lp: theme.lead.lp,
          vib: theme.lead.vibrato,
          vibRate: 5,
        };
        tone(dry, spec);
        if (theme.echo > 0) tone(wet, { ...spec, gain: spec.gain * theme.echo });
      }
    if (theme.arp?.steps[inBar] && chord.length > 0) {
      const n = chord[Math.floor(this.step / 2) % chord.length] ?? chord[0] ?? 60;
      tone(dry, {
        type: theme.arp.type,
        f: mtof(n + 12),
        dur: stepDur * 1.2,
        gain: theme.arp.gain,
        lp: theme.arp.lp,
      });
    }
    const d = theme.drums;
    if (d) {
      if (d.kick[inBar]) tone(dry, { f: 130, f2: 42, glide: 0.12, dur: 0.16, gain: 0.32 * d.gain });
      if (d.snare[inBar]) {
        noise(dry, { dur: 0.12, gain: 0.16 * d.gain, filter: 'bandpass', f: 1900, q: 0.9 });
        tone(dry, { f: 190, f2: 140, dur: 0.07, gain: 0.08 * d.gain });
      }
      if (d.hat[inBar])
        noise(dry, {
          dur: 0.03,
          gain: (inBar % 4 === 0 ? 0.06 : 0.04) * d.gain,
          filter: 'highpass',
          f: 7500,
        });
    }
  }
}
