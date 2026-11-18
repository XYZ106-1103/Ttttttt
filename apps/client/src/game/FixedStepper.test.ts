import { describe, expect, it } from 'vitest';
import { FixedStepper } from './FixedStepper';

describe('FixedStepper', () => {
  it('runs whole steps and exposes the remainder as alpha', () => {
    const s = new FixedStepper(1 / 60);
    let n = 0;
    s.advance(1 / 60 + 1 / 120, () => n++);
    expect(n).toBe(1);
    expect(s.alpha).toBeCloseTo(0.5, 5);
    s.advance(1 / 120, () => n++);
    expect(n).toBe(2);
  });

  it('is frame-rate independent (144 Hz vs 30 Hz give the same step count)', () => {
    const a = new FixedStepper(1 / 60);
    const b = new FixedStepper(1 / 60);
    let na = 0;
    let nb = 0;
    for (let i = 0; i < 144; i++) a.advance(1 / 144, () => na++);
    for (let i = 0; i < 30; i++) b.advance(1 / 30, () => nb++);
    expect(Math.abs(na - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(nb - 60)).toBeLessThanOrEqual(1);
  });

  it('caps catch-up steps after a long stall', () => {
    const s = new FixedStepper(1 / 60, 5);
    let n = 0;
    s.advance(10, () => n++);
    expect(n).toBe(5);
    s.advance(0, () => n++);
    expect(n).toBeLessThanOrEqual(6);
  });
});
