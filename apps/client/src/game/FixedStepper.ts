/**
 * Fixed-timestep accumulator. Simulation advances in exact `dt` steps regardless of display
 * refresh rate (60/144/240 Hz); rendering interpolates with `alpha`.
 */
export class FixedStepper {
  readonly dt: number;
  readonly maxSteps: number;
  private acc = 0;
  /** Interpolation factor between the previous and current simulation states, [0, 1). */
  alpha = 0;
  /** Steps executed during the last advance() call (diagnostics). */
  lastSteps = 0;

  constructor(dt: number, maxSteps = 5) {
    this.dt = dt;
    this.maxSteps = maxSteps;
  }

  advance(frameSeconds: number, step: () => void): number {
    // Clamp long frames (tab switch, debugger) to avoid a spiral of death.
    this.acc += Math.min(Math.max(frameSeconds, 0), this.dt * this.maxSteps);
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxSteps) {
      step();
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxSteps) this.acc = Math.min(this.acc, this.dt);
    this.alpha = this.acc / this.dt;
    this.lastSteps = steps;
    return steps;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
