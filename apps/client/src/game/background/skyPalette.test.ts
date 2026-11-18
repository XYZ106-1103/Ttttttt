import { describe, expect, it } from 'vitest';
import { SKY_KEYS, skyAt } from './skyPalette';

describe('skyAt', () => {
  it('matches keyframes exactly at their hours', () => {
    const noon = SKY_KEYS.find((k) => k.hour === 12)!;
    const s = skyAt(12);
    expect(s.top).toBe(parseInt(noon.top.slice(1), 16));
    expect(s.ambient).toEqual(noon.ambient);
  });

  it('is continuous across midnight and darker at night than at noon', () => {
    const a = skyAt(23.99);
    const b = skyAt(0.01);
    expect(Math.abs(a.ambient[0] - b.ambient[0])).toBeLessThan(0.02);
    expect(skyAt(0).ambient[0]).toBeLessThan(skyAt(12).ambient[0]);
    expect(skyAt(0).stars).toBeGreaterThan(0.9);
    expect(skyAt(12).stars).toBe(0);
  });
});
