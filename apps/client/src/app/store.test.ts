import { describe, expect, it } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('notifies only on actual changes', () => {
    const s = createStore({ a: 1, b: 'x' });
    let n = 0;
    s.subscribe(() => n++);
    s.set({ a: 1 });
    expect(n).toBe(0);
    s.set({ a: 2 });
    s.set((prev) => ({ b: prev.b + 'y' }));
    expect(n).toBe(2);
    expect(s.get()).toEqual({ a: 2, b: 'xy' });
  });
});
