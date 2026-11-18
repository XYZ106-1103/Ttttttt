import { describe, expect, it } from 'vitest';
import { InputManager } from './InputManager';

const key = (code: string, extra: Partial<{ repeat: boolean; target: unknown }> = {}) => ({
  code,
  repeat: extra.repeat ?? false,
  target: (extra.target ?? null) as EventTarget | null,
  preventDefault: () => {},
});

describe('InputManager', () => {
  it('tracks held keys and horizontal axis', () => {
    const im = new InputManager();
    im.handleKeyDown(key('KeyD'));
    expect(im.axisX()).toBe(1);
    im.handleKeyDown(key('ArrowLeft'));
    expect(im.axisX()).toBe(0);
    im.handleKeyUp(key('KeyD'));
    expect(im.axisX()).toBe(-1);
  });

  it('reports a press exactly once and ignores key repeat', () => {
    const im = new InputManager();
    im.handleKeyDown(key('Space'));
    im.handleKeyDown(key('Space', { repeat: true }));
    expect(im.consumePressed('jump')).toBe(true);
    expect(im.consumePressed('jump')).toBe(false);
    expect(im.isHeld('jump')).toBe(true);
  });

  it('ignores keys typed into text fields', () => {
    const im = new InputManager();
    im.handleKeyDown(key('KeyD', { target: { tagName: 'INPUT' } }));
    expect(im.axisX()).toBe(0);
  });

  it('gates gameplay actions but still fires UI actions', () => {
    const im = new InputManager();
    const ui: string[] = [];
    im.onUiAction((a) => ui.push(a));
    im.gameplayEnabled = false;
    im.handleKeyDown(key('KeyD'));
    im.handleKeyDown(key('Space'));
    im.handleKeyDown(key('KeyC'));
    expect(im.axisX()).toBe(0);
    expect(im.consumePressed('jump')).toBe(false);
    expect(ui).toEqual(['character']);
  });

  it('releases everything on blur', () => {
    const im = new InputManager();
    im.handleKeyDown(key('KeyA'));
    im.releaseAll();
    expect(im.axisX()).toBe(0);
  });
});
