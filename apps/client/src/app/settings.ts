import { createStore, type Store } from './store';

export type ZoomSetting = 'auto' | 1 | 2 | 3 | 4;
export type Language = 'ko' | 'en';

export interface Settings {
  readonly zoom: ZoomSetting;
  readonly uiScale: number;
  readonly showFps: boolean;
  readonly language: Language;
  readonly screenShake: boolean;
  /** Volumes 0..1. */
  readonly masterVolume: number;
  readonly musicVolume: number;
  readonly sfxVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  zoom: 'auto',
  uiScale: 1,
  showFps: false,
  language: 'ko',
  screenShake: true,
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
};

const STORAGE_KEY = 'project-world.settings.v1';

/** Settings are a per-device convenience, so localStorage is fine. Every access is guarded. */
function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function createSettingsStore(): Store<Settings> {
  const store = createStore<Settings>(load());
  store.subscribe(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(store.get()));
    } catch {
      /* storage unavailable (private mode, quota) — settings simply won't persist */
    }
  });
  return store;
}
