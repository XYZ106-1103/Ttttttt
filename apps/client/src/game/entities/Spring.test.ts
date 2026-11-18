import { describe, expect, it } from 'vitest';
import { Spring } from './Spring';

describe('Spring', () => {
  it('settles back to 1 at 60 fps', () => {
    const s = new Spring(260, 18);
    s.kick(1.2);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(s.value).toBeCloseTo(1, 3);
  });

  it('stays stable with very long frames (regression: stretched sprite on hitches)', () => {
    const s = new Spring(260, 18);
    s.kick(0.74);
    for (let i = 0; i < 30; i++) {
      s.update(0.1);
      expect(s.value).toBeGreaterThan(0.5);
      expect(s.value).toBeLessThan(1.6);
    }
    expect(s.value).toBeCloseTo(1, 2);
  });
});
