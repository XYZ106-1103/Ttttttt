import type { BaseStats } from '@world/shared';
import { createSettingsStore, type Settings } from './settings';
import { createStore, type Store } from './store';

export type AppPhase = 'booting' | 'title' | 'playing' | 'error';

export interface AppState {
  readonly phase: AppPhase;
  readonly bootProgress: number;
  readonly bootLabel: string;
  readonly error: string | null;
  /** Full-screen fade (0 = clear, 1 = black) used for scene transitions. */
  readonly fade: number;
}

export interface PlayerState {
  readonly name: string;
  readonly jobId: string;
  readonly level: number;
  readonly exp: number;
  readonly expToNext: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly stats: BaseStats;
  readonly statPoints: number;
  readonly portrait: string | null;
}

export interface WorldState {
  readonly timeOfDay: number;
  readonly day: number;
  readonly regionId: string;
  readonly regionNameKey: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly seed: number;
}

export type ChatChannel = 'system' | 'local' | 'notice';

export interface ChatMessage {
  readonly id: number;
  readonly channel: ChatChannel;
  readonly author: string | null;
  readonly text: string;
}

export interface ChatState {
  readonly messages: readonly ChatMessage[];
}

export type WindowId = 'character' | 'settings' | 'keyGuide';

export interface UiState {
  readonly windows: readonly WindowId[];
  readonly chatOpen: boolean;
  readonly menuOpen: boolean;
  readonly debugVisible: boolean;
  /** Region banner shown when entering a region. */
  readonly banner: { readonly id: number; readonly regionKey: string } | null;
}

export interface DebugState {
  readonly fps: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly grounded: boolean;
  readonly chunksRendered: number;
  readonly chunksGenerated: number;
  readonly objects: number;
  readonly simSteps: number;
  readonly updateMs: number;
}

export interface Stores {
  readonly app: Store<AppState>;
  readonly player: Store<PlayerState>;
  readonly world: Store<WorldState>;
  readonly chat: Store<ChatState>;
  readonly ui: Store<UiState>;
  readonly debug: Store<DebugState>;
  readonly settings: Store<Settings>;
}

export function createStores(): Stores {
  return {
    app: createStore<AppState>({
      phase: 'booting',
      bootProgress: 0,
      bootLabel: '',
      error: null,
      fade: 1,
    }),
    player: createStore<PlayerState>({
      name: '',
      jobId: 'novice',
      level: 1,
      exp: 0,
      expToNext: 1,
      hp: 1,
      maxHp: 1,
      mp: 1,
      maxMp: 1,
      stats: { str: 0, dex: 0, int: 0, vit: 0, luk: 0 },
      statPoints: 0,
      portrait: null,
    }),
    world: createStore<WorldState>({
      timeOfDay: 0,
      day: 0,
      regionId: '',
      regionNameKey: '',
      tileX: 0,
      tileY: 0,
      seed: 0,
    }),
    chat: createStore<ChatState>({ messages: [] }),
    ui: createStore<UiState>({
      windows: [],
      chatOpen: false,
      menuOpen: false,
      debugVisible: false,
      banner: null,
    }),
    debug: createStore<DebugState>({
      fps: 0,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      grounded: false,
      chunksRendered: 0,
      chunksGenerated: 0,
      objects: 0,
      simSteps: 0,
      updateMs: 0,
    }),
    settings: createSettingsStore(),
  };
}

let chatId = 0;
const MAX_CHAT = 80;

export function pushChat(
  stores: Stores,
  channel: ChatChannel,
  text: string,
  author: string | null = null,
): void {
  stores.chat.set((s) => ({
    messages: [...s.messages, { id: ++chatId, channel, author, text }].slice(-MAX_CHAT),
  }));
}
