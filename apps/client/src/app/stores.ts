import type { BaseStats, EquipSlotId, ItemStack } from '@world/shared';
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
  /** A saved world exists (title shows "Continue"). */
  readonly hasSave: boolean;
  /** Saves survive reloads (false when IndexedDB is unavailable). */
  readonly persistent: boolean;
  /** Message shown on the title screen (e.g. why an online session ended). */
  readonly notice: string | null;
}

export interface InventoryState {
  readonly slots: readonly (ItemStack | null)[];
  readonly cursor: ItemStack | null;
  readonly selected: number;
  readonly version: number;
}

export interface FeedEntry {
  readonly id: number;
  readonly itemId: string;
  readonly count: number;
}

export interface FeedState {
  readonly pickups: readonly FeedEntry[];
  readonly toast: { readonly id: number; readonly text: string } | null;
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
  /** Stats including gear bonuses. */
  readonly totals: BaseStats;
  readonly statPoints: number;
  readonly skillPoints: number;
  readonly skills: Readonly<Record<string, number>>;
  readonly skillBar: readonly (string | null)[];
  readonly equipment: Readonly<Record<EquipSlotId, ItemStack | null>>;
  readonly derived: DerivedView;
  readonly portrait: string | null;
  /** Bumps whenever progression changes. */
  readonly version: number;
}

export interface DerivedView {
  readonly attack: number;
  readonly magic: number;
  readonly defense: number;
  readonly critRate: number;
  readonly critDamage: number;
  readonly moveSpeed: number;
  readonly attackSpeed: number;
  readonly hpRegen: number;
  readonly mpRegen: number;
}

export interface SkillSlotState {
  readonly id: string | null;
  /** Seconds left. */
  readonly cooldown: number;
  readonly cooldownMax: number;
  readonly mpCost: number;
  readonly usable: boolean;
}

export interface BuffState {
  readonly id: string;
  readonly left: number;
  readonly total: number;
  readonly kind: 'buff' | 'debuff';
}

export interface BossState {
  readonly id: number;
  readonly nameKey: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly phase: number;
}

export interface CombatState {
  readonly skillBar: readonly SkillSlotState[];
  /** 0..1 of the dodge cooldown remaining. */
  readonly dodge: number;
  readonly potion: number;
  readonly potionMax: number;
  readonly healPotions: number;
  readonly manaPotions: number;
  readonly buffs: readonly BuffState[];
  readonly boss: BossState | null;
  readonly dead: boolean;
  readonly respawnIn: number;
  /** Bow draw 0..1 (0 = not drawing). */
  readonly charge: number;
  /** Counters that trigger one-shot UI effects. */
  readonly hitFlash: number;
  readonly levelUp: number;
  readonly lastLevel: number;
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

export type ChatChannel = 'system' | 'local' | 'notice' | 'nearby' | 'news' | 'party' | 'trade';

export interface ChatMessage {
  readonly id: number;
  readonly channel: ChatChannel;
  readonly author: string | null;
  readonly text: string;
}

export interface ChatState {
  readonly messages: readonly ChatMessage[];
}

export interface AdventurerSummary {
  readonly key: string;
  readonly name: string;
  readonly level: number;
  readonly jobId: string;
  readonly archetype: string;
  readonly active: boolean;
  /** Current action (active) or abstract activity. */
  readonly doing: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  /** Tile column relative to the spawn. */
  readonly x: number;
  readonly affinity: number;
  /** Relation label toward the player (stranger, friend, rival...). */
  readonly relation: string;
  readonly guild: string | null;
  /** In the player's party. */
  readonly partyMate: boolean;
}

export interface AdventurerMemoryView {
  readonly kind: string;
  readonly detail?: string;
  /** Resolved name of who it involved. */
  readonly who?: string;
  readonly ago: number;
}

export interface AdventurerTieView {
  readonly key: string;
  readonly name: string;
  readonly label: string;
  readonly affinity: number;
}

export interface AdventurerDetail extends AdventurerSummary {
  readonly personality: Readonly<Record<string, number>>;
  readonly tone: string;
  readonly skill: number;
  readonly preferredJob: string;
  readonly nightOwl: boolean;
  readonly goal: {
    readonly kind: string;
    readonly params: Readonly<Record<string, string | number>>;
  } | null;
  readonly memories: readonly AdventurerMemoryView[];
  readonly scores: readonly (readonly [string, number])[];
  readonly met: number;
  readonly helped: number;
  readonly talks: number;
  readonly trades: number;
  readonly raids: number;
  readonly weapon: string | null;
  /** Strongest ties to other adventurers (friends and rivals). */
  readonly ties: readonly AdventurerTieView[];
  /** Close enough to talk to. */
  readonly talkable: boolean;
}

export interface AdventurersState {
  readonly list: readonly AdventurerSummary[];
  readonly selected: string | null;
  readonly detail: AdventurerDetail | null;
}

export type WindowId =
  | 'dialogue'
  | 'shop'
  | 'exchange'
  | 'trade'
  | 'guild'
  | 'adventurer'
  | 'roster'
  | 'character'
  | 'settings'
  | 'keyGuide'
  | 'inventory'
  | 'worldMap'
  | 'skills'
  | 'jobAdvance';

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
  readonly drops: number;
  readonly modifiedChunks: number;
}

export interface ListingView {
  readonly id: number;
  readonly itemId: string;
  readonly count: number;
  readonly price: number;
  readonly seller: string;
  readonly mine: boolean;
  /** Seconds until it expires. */
  readonly left: number;
}

export interface PriceView {
  readonly ref: number;
  readonly trend: number;
  readonly suggested: number;
}

export interface ShopItemView {
  readonly itemId: string;
  readonly stock: number;
  readonly max: number;
  readonly price: number;
}

export interface EconomyState {
  readonly gold: number;
  readonly mailGold: number;
  readonly mailItems: number;
  readonly unreadSales: number;
  /** Exchange listings (refreshed while the exchange window is open). */
  readonly listings: readonly ListingView[];
  readonly maxListings: number;
  /** Market prices for items currently listed or held. */
  readonly prices: Readonly<Record<string, PriceView>>;
  readonly shop: { readonly npcId: string; readonly items: readonly ShopItemView[] } | null;
  /** What the open shop pays for each inventory item. */
  readonly buyback: Readonly<Record<string, number>>;
}

export interface PartyMemberView {
  readonly key: string;
  readonly name: string;
  readonly level: number;
  readonly jobId: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly leader: boolean;
  readonly near: boolean;
}

export interface GuildMemberView {
  readonly key: string;
  readonly name: string;
  readonly level: number;
  readonly jobId: string;
  readonly leader: boolean;
  readonly near: boolean;
}

export interface GuildView {
  readonly id: string;
  readonly name: string;
  readonly emblem: number;
  readonly leaderName: string;
  readonly fame: number;
  readonly members: readonly GuildMemberView[];
  readonly log: readonly {
    readonly kind: string;
    readonly who: string;
    readonly detail: string;
    readonly ago: number;
  }[];
}

export interface GuildListItem {
  readonly id: string;
  readonly name: string;
  readonly emblem: number;
  readonly leaderName: string;
  readonly members: number;
  readonly fame: number;
}

export interface SocialState {
  readonly party: readonly PartyMemberView[] | null;
  readonly partyLeader: boolean;
  readonly guild: GuildView | null;
  readonly guilds: readonly GuildListItem[];
  readonly invites: readonly {
    readonly from: string;
    readonly name: string;
    readonly purpose: string;
  }[];
  /** NPC the player stands next to. */
  readonly nearNpc: string | null;
}

/** Who the dialogue window is talking to. */
export type DialogueTarget =
  | { readonly kind: 'npc'; readonly id: string }
  | { readonly kind: 'adventurer'; readonly key: string };

export interface DialogueState {
  readonly target: DialogueTarget | null;
  /** Bumps every time a dialogue is (re)opened. */
  readonly seq: number;
}

/** Online connection status (offline play: mode 'offline'). */
export interface NetState {
  readonly mode: 'offline' | 'online';
  readonly state: 'online' | 'reconnecting' | 'closed';
  /** Round-trip time to the server (ms). */
  readonly rtt: number;
  readonly admin: boolean;
  /** Other players in view. */
  readonly peers: number;
}

export interface Stores {
  readonly app: Store<AppState>;
  readonly net: Store<NetState>;
  readonly player: Store<PlayerState>;
  readonly world: Store<WorldState>;
  readonly chat: Store<ChatState>;
  readonly ui: Store<UiState>;
  readonly debug: Store<DebugState>;
  readonly settings: Store<Settings>;
  readonly inventory: Store<InventoryState>;
  readonly feed: Store<FeedState>;
  readonly combat: Store<CombatState>;
  readonly adventurers: Store<AdventurersState>;
  readonly economy: Store<EconomyState>;
  readonly social: Store<SocialState>;
  readonly dialogue: Store<DialogueState>;
}

const ZERO_STATS = { str: 0, dex: 0, int: 0, vit: 0, luk: 0 };

export function createStores(): Stores {
  return {
    net: createStore<NetState>({
      mode: 'offline',
      state: 'online',
      rtt: 0,
      admin: false,
      peers: 0,
    }),
    app: createStore<AppState>({
      phase: 'booting',
      bootProgress: 0,
      bootLabel: '',
      error: null,
      fade: 1,
      hasSave: false,
      persistent: true,
      notice: null,
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
      stats: ZERO_STATS,
      totals: ZERO_STATS,
      statPoints: 0,
      skillPoints: 0,
      skills: {},
      skillBar: [null, null, null, null],
      equipment: { head: null, body: null, feet: null, acc1: null, acc2: null },
      derived: {
        attack: 0,
        magic: 0,
        defense: 0,
        critRate: 0,
        critDamage: 0,
        moveSpeed: 1,
        attackSpeed: 1,
        hpRegen: 0,
        mpRegen: 0,
      },
      portrait: null,
      version: -1,
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
      drops: 0,
      modifiedChunks: 0,
    }),
    settings: createSettingsStore(),
    inventory: createStore<InventoryState>({ slots: [], cursor: null, selected: 0, version: -1 }),
    feed: createStore<FeedState>({ pickups: [], toast: null }),
    combat: createStore<CombatState>({
      skillBar: [],
      dodge: 0,
      potion: 0,
      potionMax: 1,
      healPotions: 0,
      manaPotions: 0,
      buffs: [],
      boss: null,
      dead: false,
      respawnIn: 0,
      charge: 0,
      hitFlash: 0,
      levelUp: 0,
      lastLevel: 1,
    }),
    adventurers: createStore<AdventurersState>({ list: [], selected: null, detail: null }),
    economy: createStore<EconomyState>({
      gold: 0,
      mailGold: 0,
      mailItems: 0,
      unreadSales: 0,
      listings: [],
      maxListings: 12,
      prices: {},
      shop: null,
      buyback: {},
    }),
    social: createStore<SocialState>({
      party: null,
      partyLeader: false,
      guild: null,
      guilds: [],
      invites: [],
      nearNpc: null,
    }),
    dialogue: createStore<DialogueState>({ target: null, seq: 0 }),
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

let feedId = 0;

/** Add a pickup to the feed (merging with a recent entry of the same item). */
export function pushPickup(stores: Stores, itemId: string, count: number): void {
  stores.feed.set((f) => {
    const last = f.pickups[f.pickups.length - 1];
    if (last && last.itemId === itemId) {
      return {
        pickups: [...f.pickups.slice(0, -1), { id: ++feedId, itemId, count: last.count + count }],
      };
    }
    return { pickups: [...f.pickups, { id: ++feedId, itemId, count }].slice(-6) };
  });
}

export function dropPickup(stores: Stores, id: number): void {
  stores.feed.set((f) => ({ pickups: f.pickups.filter((p) => p.id !== id) }));
}

export function showToast(stores: Stores, text: string): void {
  stores.feed.set({ toast: { id: ++feedId, text } });
}
