/**
 * Damped spring toward 1.0, used for squash & stretch.
 *
 * Integrated with fixed sub-steps (semi-implicit Euler) so it stays stable no matter how long a
 * rendered frame takes — a plain Euler step explodes on frame hitches (dt ≈ 0.1 s).
 */
export class Spring {
  value = 1;
  velocity = 0;
  private static readonly STEP = 1 / 240;

  constructor(
    private readonly stiffness: number,
    private readonly damping: number,
    private readonly min = 0.5,
    private readonly max = 1.6,
  ) {}

  update(dt: number): number {
    let remaining = Math.min(Math.max(dt, 0), 0.25);
    while (remaining > 0) {
      const h = Math.min(remaining, Spring.STEP);
      const a = -(this.value - 1) * this.stiffness - this.velocity * this.damping;
      this.velocity += a * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
    if (this.value < this.min || this.value > this.max) {
      this.value = Math.min(this.max, Math.max(this.min, this.value));
      this.velocity = 0;
    }
    return this.value;
  }

  kick(value: number): void {
    this.value = value;
    this.velocity = 0;
  }
}
