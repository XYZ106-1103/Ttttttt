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
  if (params)
    for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}
