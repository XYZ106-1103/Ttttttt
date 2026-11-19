import type { Language } from '../app/settings';
import { en } from './en';
import { ko, type MessageKey } from './ko';

export type { MessageKey };

const tables: Record<Language, Record<MessageKey, string>> = { ko, en };

let current: Language = 'ko';

export function setLanguage(lang: Language): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

export function getLanguage(): Language {
  return current;
}

/** Translate a key, substituting {placeholders}. Unknown keys fall back to the key itself. */
export function t(key: MessageKey | string, params?: Record<string, string | number>): string {
  const table = tables[current] as Record<string, string>;
  let text = table[key] ?? (ko as Record<string, string>)[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
    if (current === 'ko') text = josa(text);
  }
  return text;
}

// Digits read with a final consonant: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 (ㄹ: 1, 7, 8).
const DIGIT_FINAL = [true, true, false, true, false, false, true, true, true, false];
const DIGIT_RIEUL = [false, true, false, false, false, false, false, true, true, false];

function finalOf(ch: string): 'none' | 'rieul' | 'other' {
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) {
    const f = (c - 0xac00) % 28;
    return f === 0 ? 'none' : f === 8 ? 'rieul' : 'other';
  }
  if (c >= 48 && c <= 57) {
    const d = c - 48;
    return DIGIT_RIEUL[d] ? 'rieul' : DIGIT_FINAL[d] ? 'other' : 'none';
  }
  return 'none';
}

const JOSA: readonly [RegExp, (f: 'none' | 'rieul' | 'other') => string][] = [
  [/이\(가\)/g, (f) => (f === 'none' ? '가' : '이')],
  [/을\(를\)/g, (f) => (f === 'none' ? '를' : '을')],
  [/은\(는\)/g, (f) => (f === 'none' ? '는' : '은')],
  [/와\(과\)/g, (f) => (f === 'none' ? '와' : '과')],
  [/\(으\)로/g, (f) => (f === 'other' ? '으로' : '로')],
  [/\(이\)라고/g, (f) => (f === 'none' ? '라고' : '이라고')],
  [/\(이\)에요/g, (f) => (f === 'none' ? '예요' : '이에요')],
  [/\(이\)다/g, (f) => (f === 'none' ? '다' : '이다')],
  [/\(이\)야/g, (f) => (f === 'none' ? '야' : '이야')],
  [/\(이\)냐/g, (f) => (f === 'none' ? '냐' : '이냐')],
];

/** Pick Korean particles after substituted words: "{name}이(가)" → "테아가" / "은랑이". */
export function josa(text: string): string {
  let out = text;
  for (const [re, pick] of JOSA) {
    out = out.replace(re, (m, offset: number) => {
      const prev = out.slice(0, offset).replace(/[\s'"’)\]]+$/, '');
      const ch = prev.slice(-1);
      return ch ? pick(finalOf(ch)) : m;
    });
  }
  return out;
}

/** Whether a message key exists (for keys built from server codes). */
export function hasMessage(key: string): boolean {
  return key in (ko as Record<string, string>);
}
