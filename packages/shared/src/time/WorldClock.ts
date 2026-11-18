import { clamp01, smoothstep } from '../math/scalar';

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

export interface WorldClockOptions {
  /** Real seconds for one full in-game day. */
  dayLengthSeconds?: number;
  /** Starting time of day in hours [0, 24). */
  startHour?: number;
}

/**
 * In-game time of day. Advanced by the fixed simulation step; everything time-dependent (lighting,
 * AI schedules, shop hours, spawns) reads from here.
 */
export class WorldClock {
  dayLengthSeconds: number;
  /** Hours in [0, 24). */
  private hours: number;
  /** Number of completed days since the world started. */
  day = 0;

  constructor(options: WorldClockOptions = {}) {
    this.dayLengthSeconds = options.dayLengthSeconds ?? 24 * 60;
    this.hours = WorldClock.normalize(options.startHour ?? 8);
  }

  static normalize(hours: number): number {
    const h = hours % 24;
    return h < 0 ? h + 24 : h;
  }

  get timeOfDay(): number {
    return this.hours;
  }

  setTime(hours: number): void {
    this.hours = WorldClock.normalize(hours);
  }

  advance(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    const next = this.hours + (dtSeconds / this.dayLengthSeconds) * 24;
    this.day += Math.floor(next / 24);
    this.hours = WorldClock.normalize(next);
  }

  get hour(): number {
    return Math.floor(this.hours);
  }

  get minute(): number {
    return Math.floor((this.hours - Math.floor(this.hours)) * 60);
  }

  get phase(): DayPhase {
    const h = this.hours;
    if (h >= 5 && h < 7.5) return 'dawn';
    if (h >= 7.5 && h < 17.5) return 'day';
    if (h >= 17.5 && h < 20) return 'dusk';
    return 'night';
  }

  /** Smooth sunlight factor: 0 at night, 1 at full day. */
  get daylight(): number {
    const h = this.hours;
    const rise = smoothstep(4.5, 8, h);
    const set = 1 - smoothstep(17, 20.5, h);
    return clamp01(Math.min(rise, set));
  }

  /** Formatted "HH:MM". */
  format(): string {
    return `${String(this.hour).padStart(2, '0')}:${String(this.minute).padStart(2, '0')}`;
  }
}
