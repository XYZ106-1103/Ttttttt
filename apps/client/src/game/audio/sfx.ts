/**
 * Sound effect recipes. Each builds its sound from oscillators and noise at play time; `v` is a
 * per-play variation in [0, 1) so repeated sounds (steps, hits, swings) never sound identical.
 * Returns the end time so the engine can count active voices.
 */
import { mtof, noise, type Out, tone } from './synth';

type Recipe = (o: Out, v: number) => number;

const max = (...xs: number[]): number => Math.max(...xs);

function arpeggio(
  o: Out,
  notes: readonly number[],
  step: number,
  spec: {
    type?: OscillatorType;
    dur: number;
    gain: number;
    lp?: number;
  },
): number {
  let end = o.t;
  notes.forEach((n, i) => {
    end = max(end, tone(o, { ...spec, f: mtof(n), delay: i * step }));
  });
  return end;
}

function chord(
  o: Out,
  notes: readonly number[],
  spec: {
    type?: OscillatorType;
    dur: number;
    gain: number;
    delay?: number;
    a?: number;
  },
): number {
  let end = o.t;
  for (const n of notes) end = max(end, tone(o, { ...spec, f: mtof(n) }));
  return end;
}

export const SFX = {
  // --- Movement ------------------------------------------------------------------------------
  step: (o, v) => noise(o, { dur: 0.05, gain: 0.1, filter: 'lowpass', f: 700 + v * 300, f2: 300 }),
  step_stone: (o, v) =>
    max(
      noise(o, { dur: 0.035, gain: 0.07, filter: 'bandpass', f: 2200 + v * 600, q: 1.5 }),
      tone(o, { f: 900 + v * 200, dur: 0.02, gain: 0.02 }),
    ),
  step_wood: (o, v) =>
    max(
      tone(o, { type: 'triangle', f: 190 + v * 30, f2: 120, dur: 0.05, gain: 0.08 }),
      noise(o, { dur: 0.03, gain: 0.04, filter: 'bandpass', f: 900 }),
    ),
  jump: (o, v) =>
    max(
      tone(o, {
        type: 'square',
        f: 200 + v * 20,
        f2: 420,
        glide: 0.08,
        dur: 0.08,
        gain: 0.04,
        lp: 1800,
      }),
      noise(o, { dur: 0.1, gain: 0.04, filter: 'bandpass', f: 700, f2: 1600, q: 1.2 }),
    ),
  land: (o, v) =>
    max(
      noise(o, { dur: 0.12, gain: 0.18, filter: 'lowpass', f: 500, f2: 120 }),
      tone(o, { f: 95 + v * 10, f2: 45, dur: 0.1, gain: 0.22 }),
    ),
  dodge: (o, v) =>
    noise(o, {
      a: 0.02,
      dur: 0.18,
      gain: 0.16,
      filter: 'bandpass',
      f: 600 + v * 200,
      f2: 2600,
      q: 1.4,
    }),

  // --- Combat --------------------------------------------------------------------------------
  swing: (o, v) =>
    noise(o, {
      a: 0.015,
      dur: 0.13,
      gain: 0.15,
      filter: 'bandpass',
      f: 1100 + v * 400,
      f2: 3600,
      q: 2,
    }),
  swing_heavy: (o, v) =>
    max(
      noise(o, {
        a: 0.03,
        dur: 0.22,
        gain: 0.18,
        filter: 'bandpass',
        f: 450 + v * 100,
        f2: 1500,
        q: 1.6,
      }),
      tone(o, { f: 120, f2: 60, dur: 0.18, gain: 0.12, delay: 0.08 }),
    ),
  hit: (o, v) =>
    max(
      tone(o, { f: 170 + v * 40, f2: 60, dur: 0.09, gain: 0.32 }),
      noise(o, { dur: 0.05, gain: 0.18, filter: 'bandpass', f: 2400 + v * 800, q: 1 }),
    ),
  crit: (o, v) =>
    max(
      tone(o, { f: 190 + v * 30, f2: 55, dur: 0.12, gain: 0.38 }),
      noise(o, { dur: 0.07, gain: 0.22, filter: 'bandpass', f: 3000, q: 1 }),
      tone(o, { type: 'square', f: 1500, f2: 950, dur: 0.14, gain: 0.06, lp: 4500 }),
    ),
  hurt: (o, v) =>
    max(
      tone(o, { type: 'sawtooth', f: 320 + v * 40, f2: 110, dur: 0.18, gain: 0.1, lp: 1300 }),
      noise(o, { dur: 0.08, gain: 0.18, filter: 'lowpass', f: 900 }),
    ),
  bow_draw: (o) => tone(o, { type: 'triangle', a: 0.05, f: 180, f2: 420, dur: 0.35, gain: 0.04 }),
  bow: (o, v) =>
    max(
      tone(o, { type: 'triangle', f: 950 + v * 100, f2: 280, dur: 0.07, gain: 0.12 }),
      noise(o, { dur: 0.12, gain: 0.07, filter: 'highpass', f: 2500, f2: 5000 }),
    ),
  thunk: (o, v) =>
    max(
      tone(o, { f: 230 + v * 30, f2: 140, dur: 0.06, gain: 0.16 }),
      noise(o, { dur: 0.03, gain: 0.12, filter: 'bandpass', f: 1500 }),
    ),
  magic: (o, v) =>
    max(
      arpeggio(
        o,
        [84, 88, 91, 96].map((n) => n + Math.round(v * 2)),
        0.045,
        {
          dur: 0.22,
          gain: 0.05,
        },
      ),
      noise(o, { a: 0.05, dur: 0.3, gain: 0.025, filter: 'highpass', f: 6000 }),
    ),
  fireball: (o) =>
    max(
      noise(o, { a: 0.02, dur: 0.4, gain: 0.18, filter: 'lowpass', f: 1400, f2: 300 }),
      tone(o, { type: 'sawtooth', f: 95, f2: 60, dur: 0.3, gain: 0.07, lp: 600 }),
    ),
  frost: (o) =>
    max(
      tone(o, { f: 2000, dur: 0.5, gain: 0.03 }),
      tone(o, { f: 2640, dur: 0.45, gain: 0.025, delay: 0.03 }),
      tone(o, { f: 3300, dur: 0.4, gain: 0.02, delay: 0.06 }),
      noise(o, { a: 0.03, dur: 0.4, gain: 0.04, filter: 'highpass', f: 5000 }),
    ),
  heal: (o) => arpeggio(o, [79, 84, 88], 0.07, { dur: 0.3, gain: 0.06 }),
  mana: (o) => arpeggio(o, [76, 83, 88], 0.07, { type: 'triangle', dur: 0.3, gain: 0.06 }),
  explosion: (o) =>
    max(
      noise(o, { dur: 0.7, gain: 0.45, filter: 'lowpass', f: 2200, f2: 90 }),
      tone(o, { f: 85, f2: 30, dur: 0.55, gain: 0.38 }),
    ),
  perfect: (o) =>
    max(
      tone(o, { f: 1568, f2: 2093, glide: 0.08, dur: 0.3, gain: 0.06 }),
      noise(o, { a: 0.02, dur: 0.25, gain: 0.03, filter: 'highpass', f: 7000 }),
    ),
  blink: (o) =>
    max(
      tone(o, { f: 600, f2: 1800, dur: 0.12, gain: 0.06 }),
      noise(o, { dur: 0.1, gain: 0.04, filter: 'highpass', f: 4000 }),
    ),

  // --- Monsters ------------------------------------------------------------------------------
  monster_hit: (o, v) =>
    max(
      tone(o, { f: 420 + v * 80, f2: 200, dur: 0.08, gain: 0.13 }),
      noise(o, { dur: 0.06, gain: 0.1, filter: 'bandpass', f: 900 + v * 300 }),
    ),
  monster_die: (o, v) =>
    max(
      tone(o, { type: 'square', f: 520 + v * 60, f2: 80, dur: 0.3, gain: 0.07, lp: 1500 }),
      noise(o, { dur: 0.25, gain: 0.13, filter: 'lowpass', f: 1000, f2: 200 }),
    ),
  telegraph: (o) =>
    max(
      tone(o, { f: 880, dur: 0.07, gain: 0.05 }),
      tone(o, { f: 880, dur: 0.07, gain: 0.05, delay: 0.12 }),
    ),
  quake: (o) =>
    max(
      noise(o, { dur: 0.8, gain: 0.4, filter: 'lowpass', f: 320, f2: 60 }),
      tone(o, { f: 52, f2: 30, dur: 0.7, gain: 0.35 }),
    ),
  roar: (o) =>
    max(
      tone(o, {
        type: 'sawtooth',
        a: 0.08,
        f: 115,
        f2: 70,
        dur: 1.0,
        gain: 0.16,
        lp: 520,
        vib: 8,
        vibRate: 11,
      }),
      noise(o, { a: 0.08, dur: 1.0, gain: 0.16, filter: 'lowpass', f: 700, f2: 250 }),
    ),
  boss_spawn: (o) =>
    max(
      tone(o, { type: 'sawtooth', a: 0.3, f: 55, dur: 1.6, gain: 0.14, lp: 380 }),
      tone(o, { a: 0.1, f: 220, f2: 110, dur: 1.2, gain: 0.07 }),
      noise(o, { a: 0.4, dur: 1.2, gain: 0.08, filter: 'lowpass', f: 400 }),
    ),

  // --- Sandbox -------------------------------------------------------------------------------
  mine_dirt: (o, v) =>
    max(
      noise(o, { dur: 0.08, gain: 0.2, filter: 'lowpass', f: 750 + v * 200, f2: 250 }),
      tone(o, { f: 140 + v * 20, f2: 80, dur: 0.06, gain: 0.13 }),
    ),
  mine_stone: (o, v) =>
    max(
      tone(o, { type: 'square', f: 1750 + v * 300, f2: 1450, dur: 0.03, gain: 0.05, lp: 5000 }),
      noise(o, { dur: 0.05, gain: 0.16, filter: 'bandpass', f: 3000 + v * 500, q: 3 }),
    ),
  chop: (o, v) =>
    max(
      tone(o, { type: 'triangle', f: 260 + v * 40, f2: 175, dur: 0.08, gain: 0.18 }),
      noise(o, { dur: 0.05, gain: 0.1, filter: 'bandpass', f: 1200 }),
    ),
  break: (o, v) =>
    max(
      noise(o, { dur: 0.22, gain: 0.26, filter: 'lowpass', f: 3200, f2: 300 }),
      tone(o, { f: 160 + v * 30, f2: 70, dur: 0.12, gain: 0.15 }),
      noise(o, { dur: 0.03, gain: 0.08, filter: 'bandpass', f: 2600, delay: 0.06 }),
      noise(o, { dur: 0.03, gain: 0.06, filter: 'bandpass', f: 1900, delay: 0.11 }),
    ),
  tree_fall: (o) =>
    max(
      noise(o, { a: 0.1, dur: 0.6, gain: 0.2, filter: 'bandpass', f: 400, f2: 900, q: 0.8 }),
      tone(o, { f: 90, f2: 45, dur: 0.4, gain: 0.25, delay: 0.45 }),
      noise(o, { dur: 0.3, gain: 0.25, filter: 'lowpass', f: 600, delay: 0.45 }),
    ),
  place: (o, v) =>
    max(
      tone(o, { f: 210 + v * 30, f2: 150, dur: 0.06, gain: 0.18 }),
      noise(o, { dur: 0.04, gain: 0.08, filter: 'lowpass', f: 1500 }),
    ),
  pickup: (o, v) =>
    tone(o, {
      type: 'square',
      f: 880 + v * 60,
      f2: 1320,
      glide: 0.05,
      dur: 0.07,
      gain: 0.04,
      lp: 3000,
    }),
  coin: (o) =>
    max(
      tone(o, { type: 'square', f: mtof(83), dur: 0.05, gain: 0.04, lp: 5000 }),
      tone(o, { type: 'square', f: mtof(88), dur: 0.22, gain: 0.04, lp: 5000, delay: 0.06 }),
    ),
  drink: (o) =>
    max(
      tone(o, { f: 420, f2: 900, dur: 0.06, gain: 0.06 }),
      tone(o, { f: 520, f2: 1000, dur: 0.06, gain: 0.05, delay: 0.09 }),
      tone(o, { f: 620, f2: 1150, dur: 0.07, gain: 0.05, delay: 0.18 }),
    ),

  // --- Progress ------------------------------------------------------------------------------
  level_up: (o) =>
    max(
      arpeggio(o, [72, 76, 79, 84, 88], 0.075, {
        type: 'square',
        dur: 0.25,
        gain: 0.045,
        lp: 3200,
      }),
      chord(o, [84, 88, 91, 96], { type: 'triangle', a: 0.02, dur: 0.9, gain: 0.025, delay: 0.38 }),
    ),
  job_change: (o) =>
    max(
      arpeggio(o, [67, 72, 76, 79, 84, 88, 91], 0.07, {
        type: 'square',
        dur: 0.3,
        gain: 0.04,
        lp: 3000,
      }),
      tone(o, { type: 'sawtooth', a: 0.2, f: mtof(48), dur: 1.4, gain: 0.05, lp: 900 }),
      noise(o, { a: 0.3, dur: 0.9, gain: 0.03, filter: 'highpass', f: 6000, delay: 0.4 }),
    ),
  death: (o) =>
    max(
      tone(o, { type: 'sawtooth', f: 400, f2: 90, dur: 1.0, gain: 0.08, lp: 1000 }),
      tone(o, { type: 'triangle', f: mtof(57), dur: 1.2, gain: 0.05, delay: 0.3 }),
      tone(o, { type: 'triangle', f: mtof(53), dur: 1.4, gain: 0.05, delay: 0.6 }),
    ),
  respawn: (o) =>
    max(
      tone(o, { a: 0.1, f: 200, f2: 800, dur: 0.6, gain: 0.05 }),
      noise(o, { a: 0.2, dur: 0.5, gain: 0.025, filter: 'highpass', f: 6000 }),
    ),
  victory: (o) =>
    max(
      arpeggio(o, [67, 72, 76, 72, 76, 79], 0.11, {
        type: 'square',
        dur: 0.25,
        gain: 0.045,
        lp: 3000,
      }),
      tone(o, { type: 'square', f: mtof(84), dur: 1.0, gain: 0.04, lp: 3000, delay: 0.66 }),
    ),

  // --- Interface -----------------------------------------------------------------------------
  ui_click: (o) => tone(o, { type: 'square', f: 1150, dur: 0.02, gain: 0.025, lp: 4000 }),
  ui_open: (o) => tone(o, { type: 'triangle', f: 560, f2: 880, dur: 0.07, gain: 0.05 }),
  ui_close: (o) => tone(o, { type: 'triangle', f: 880, f2: 560, dur: 0.07, gain: 0.04 }),
  notify: (o) =>
    max(
      tone(o, { f: mtof(84), dur: 0.15, gain: 0.05 }),
      tone(o, { f: mtof(91), dur: 0.25, gain: 0.05, delay: 0.1 }),
    ),
  trade: (o) =>
    max(
      tone(o, { type: 'square', f: mtof(83), dur: 0.05, gain: 0.04, lp: 5000 }),
      tone(o, { type: 'square', f: mtof(88), dur: 0.15, gain: 0.04, lp: 5000, delay: 0.06 }),
      arpeggio(o, [79, 84, 88], 0.06, { dur: 0.3, gain: 0.04 }),
    ),
  error: (o) =>
    max(
      tone(o, { type: 'square', f: 165, dur: 0.08, gain: 0.04, lp: 1100 }),
      tone(o, { type: 'square', f: 140, dur: 0.1, gain: 0.04, lp: 1100, delay: 0.1 }),
    ),
} satisfies Record<string, Recipe>;

export type SfxName = keyof typeof SFX;
export const SFX_NAMES = Object.keys(SFX) as SfxName[];
