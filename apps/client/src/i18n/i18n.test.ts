import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  JOB_DEFS,
  MONSTER_DEFS,
  OBJECT_DEFS,
  REGION_DEFS,
  SKILL_DEFS,
  STATUS_DEFS,
  TILE_DEFS,
  ZONE_NAME_KEY,
} from '@world/shared';
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
      ...ITEM_DEFS.flatMap((d) => [d.nameKey, d.descKey, `itemKind.${d.kind}`]),
      ...MONSTER_DEFS.map((d) => d.nameKey),
      ...SKILL_DEFS.flatMap((d) => [d.nameKey, d.descKey, `skillType.${d.type}`]),
      ...STATUS_DEFS.map((d) => d.nameKey),
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

describe('Korean particles', () => {
  it('picks particles from the last syllable of substituted words', async () => {
    const { josa } = await import('./index');
    expect(josa('휘니(이)라고 해요')).toBe('휘니라고 해요');
    expect(josa('은랑(이)라고 해요')).toBe('은랑이라고 해요');
    expect(josa('테아이(가) 왔다')).toBe('테아가 왔다');
    expect(josa('은랑이(가) 왔다')).toBe('은랑이 왔다');
    expect(josa('철 검을(를) 샀다')).toBe('철 검을 샀다');
    expect(josa('전사(으)로 전직')).toBe('전사로 전직');
    expect(josa('검(으)로')).toBe('검으로');
    expect(josa('활(으)로')).toBe('활로');
    expect(josa('Lv.10이(가)')).toBe('Lv.10이');
  });
});
