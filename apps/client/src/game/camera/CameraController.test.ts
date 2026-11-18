import { describe, expect, it } from 'vitest';
import { CameraController } from './CameraController';

const bounds = { width: 10000, height: 4000 };
const target = (x: number, y: number, grounded = true) => ({ x, y, vx: 0, facing: 1, grounded });

describe('CameraController', () => {
  it('snaps so the target is horizontally centered', () => {
    const c = new CameraController();
    c.snap(target(5000, 2000), 960, 540, bounds);
    expect(c.left + 480).toBeCloseTo(5000, 5);
  });

  it('never shows outside the world', () => {
    const c = new CameraController();
    c.snap(target(10, 10), 960, 540, bounds);
    expect(c.left).toBe(0);
    expect(c.top).toBe(0);
    c.snap(target(9990, 3990), 960, 540, bounds);
    expect(c.left).toBe(bounds.width - 960);
    expect(c.top).toBe(bounds.height - 540);
  });

  it('does not bob vertically during a small jump', () => {
    const c = new CameraController();
    c.snap(target(5000, 2000), 960, 540, bounds);
    const top0 = c.top;
    for (let i = 0; i < 30; i++) c.update(target(5000, 2000 - 60, false), 960, 540, bounds, 1 / 60);
    expect(Math.abs(c.top - top0)).toBeLessThan(1);
  });

  it('follows a fall immediately', () => {
    const c = new CameraController();
    c.snap(target(5000, 2000), 960, 540, bounds);
    const top0 = c.top;
    for (let i = 0; i < 60; i++) c.update(target(5000, 2400, false), 960, 540, bounds, 1 / 60);
    expect(c.top).toBeGreaterThan(top0 + 300);
  });
});
