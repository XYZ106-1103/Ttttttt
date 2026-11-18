import { describe, expect, it } from 'vitest';
import { JOB_DEFS, OBJECT_DEFS, REGION_DEFS, TILE_DEFS, ZONE_NAME_KEY } from '@world/shared';
import { en } from './en';
import { setLanguage, t } from './index';
import { ko } from './ko';

describe('i18n', () => {
  it('has identical key sets for every language', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  });

  it('resolves every display-name key referenced by game data', () => {
    const keys = [
      ...TILE_DEFS.map((d) => d.nameKey),
      ...OBJECT_DEFS.map((d) => d.nameKey),
      ...JOB_DEFS.flatMap((d) => [d.nameKey, d.descriptionKey]),
      ...REGION_DEFS.map((d) => d.nameKey),
      ZONE_NAME_KEY,
    ];
    for (const k of keys) expect(k in ko, k).toBe(true);
  });

  it('substitutes parameters', () => {
    setLanguage('en');
    expect(t('hud.day', { day: 3 })).toBe('Day 3');
    setLanguage('ko');
    expect(t('hud.day', { day: 3 })).toBe('3일차');
  });
});
