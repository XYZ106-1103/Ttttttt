import type Phaser from 'phaser';
import {
  type Adventurer,
  GOLD_DROP,
  itemRegistry,
  relationLabel,
  TILE_SIZE,
  toneOf,
} from '@world/shared';
import { t } from '../../i18n';
import {
  type AdventurerDetail,
  type AdventurerSummary,
  type GuildView,
  type ListingView,
  type PriceView,
  pushChat,
  showToast,
  type Stores,
} from '../../app/stores';
import { openWindow } from '../../ui/windowActions';
import { NpcRenderer } from '../render/NpcRenderer';
import type { ClientSim } from '../sim/ClientSim';
import { guildName, itemName, nameOf, socialParams, spokenText } from './socialText';

/** How far (tiles) conversations of adventurers are heard in the chat log. */
const HEARING = 30;

/**
 * Presentation of the living world's social and economic side: village NPCs, nearby
 * conversations and world news in chat, party/guild/economy stores for the UI, and the
 * adventurer roster/card. Reads the simulation; never changes it.
 */
export class SocialPresenter {
  readonly npcs: NpcRenderer;
  private publishTimer = 0;
  private advTimer = 0;
  private partyKeys: string[] = [];
  private marketVersion = -1;
  private shopVersion = -1;

  constructor(
    scene: Phaser.Scene,
    worldLayer: Phaser.GameObjects.Layer,
    labelLayer: Phaser.GameObjects.Layer,
    private readonly sim: ClientSim,
    private readonly stores: Stores,
  ) {
    this.npcs = new NpcRenderer(scene, worldLayer, labelLayer, sim.world, sim.town.npcs);
  }

  // --- Per frame ----------------------------------------------------------------------------

  update(dt: number, zoom: number): void {
    const sim = this.sim;
    this.npcs.update(dt, sim.time, zoom, sim.player.motor.x, (id) => sim.town.near(id));
    this.consumeEvents();
    this.publishTimer -= dt;
    if (this.publishTimer <= 0) {
      this.publishTimer = 0.25;
      this.publishEconomy();
      this.publishSocial();
    }
    this.publishAdventurers();
  }

  private consumeEvents(): void {
    const sim = this.sim;
    const ev = sim.events;
    const pm = sim.player.motor;
    for (const l of ev.spoken) {
      const a = sim.adventurers.byKey(l.speaker);
      if (!a || Math.abs(a.character.motor.x - pm.x) > HEARING * TILE_SIZE) continue;
      pushChat(
        this.stores,
        'nearby',
        spokenText(sim, l.speaker, l.line, l.params),
        nameOf(sim, l.speaker),
      );
    }
    ev.spoken.length = 0;
    for (const n of ev.news) {
      pushChat(this.stores, 'news', t(`news.${n.kind}`, socialParams(sim, n.params)));
    }
    ev.news.length = 0;
    for (const s of ev.sales) {
      const text = t('ex.sold', { item: itemName(s.itemId), count: s.count, gold: s.net });
      pushChat(this.stores, 'trade', text);
      showToast(this.stores, text);
    }
    ev.sales.length = 0;
    for (const inv of ev.invites) {
      const name = nameOf(sim, inv.from);
      this.stores.social.set((st) => ({
        invites: [
          ...st.invites.filter((i) => i.from !== inv.from),
          { from: inv.from, name, purpose: inv.purpose },
        ],
      }));
    }
    ev.invites.length = 0;
    ev.social.length = 0;
  }

  // --- Stores -------------------------------------------------------------------------------

  private publishEconomy(): void {
    const sim = this.sim;
    const eco = sim.economy;
    const p = sim.player;
    const box = eco.market.peekMail(sim.selfKey);
    const ui = this.stores.ui.get();
    const exchangeOpen = ui.windows.includes('exchange');
    const shopOpen = ui.windows.includes('shop');
    let listings = this.stores.economy.get().listings;
    let prices = this.stores.economy.get().prices;
    if (exchangeOpen && eco.market.version !== this.marketVersion) {
      this.marketVersion = eco.market.version;
      listings = eco.market.all.map((l): ListingView => ({
        id: l.id,
        itemId: l.itemId,
        count: l.count,
        price: l.price,
        seller: l.seller === sim.selfKey ? p.name : nameOf(sim, l.seller),
        mine: l.seller === sim.selfKey,
        left: Math.max(0, l.expiresAt - sim.time),
      }));
    }
    if (exchangeOpen || shopOpen) {
      const ids = new Set<string>(listings.map((l) => l.itemId));
      for (let i = 0; i < p.inventory.size; i++) {
        const st = p.inventory.get(i);
        if (st) ids.add(st.itemId);
      }
      const next: Record<string, PriceView> = {};
      for (const id of ids) {
        next[id] = {
          ref: eco.prices.ref(id),
          trend: eco.prices.trend(id),
          suggested: eco.prices.suggested(id, eco.market.supply(id)),
        };
      }
      prices = next;
    }
    let shop = this.stores.economy.get().shop;
    let buyback = this.stores.economy.get().buyback;
    const npcId = this.stores.dialogue.get().target;
    if (shopOpen && npcId?.kind === 'npc') {
      const def = sim.town.npc(npcId.id)?.def;
      const s = def?.shopId ? eco.shop(def.shopId) : undefined;
      if (s && (s.version !== this.shopVersion || shop?.npcId !== npcId.id)) {
        this.shopVersion = s.version;
        shop = {
          npcId: npcId.id,
          items: s.items.map((it) => ({ ...it, price: s.sellPrice(it.itemId) })),
        };
      }
      if (s) {
        const bb: Record<string, number> = {};
        for (let i = 0; i < p.inventory.size; i++) {
          const st = p.inventory.get(i);
          if (st && bb[st.itemId] === undefined) bb[st.itemId] = s.buyPrice(st.itemId);
        }
        buyback = bb;
      }
    }
    this.stores.economy.set({
      gold: p.gold,
      mailGold: box?.gold ?? 0,
      mailItems: box?.items.reduce((n, st) => n + st.count, 0) ?? 0,
      unreadSales: box?.sales.length ?? 0,
      listings,
      maxListings: eco.market.config.maxListings,
      prices,
      shop,
      buyback,
    });
  }

  private publishSocial(): void {
    const sim = this.sim;
    const society = sim.society;
    const pm = sim.player.motor;
    const near = (x: number) => Math.abs(x - pm.x) < 40 * TILE_SIZE;
    const party = society.parties.of(sim.selfKey);
    // Party join/leave messages.
    const keys = party?.members ?? [];
    for (const k of keys)
      if (!this.partyKeys.includes(k) && k !== sim.selfKey && this.partyKeys.length > 0)
        pushChat(this.stores, 'party', t('party.joined', { name: nameOf(sim, k) }));
    for (const k of this.partyKeys)
      if (!keys.includes(k) && k !== sim.selfKey)
        pushChat(this.stores, 'party', t('party.left', { name: nameOf(sim, k) }));
    if (keys.length === 0 && this.partyKeys.length > 0)
      pushChat(this.stores, 'party', t('party.disbanded'));
    if (keys.length > 0 && this.partyKeys.length === 0)
      for (const k of keys)
        if (k !== sim.selfKey)
          pushChat(this.stores, 'party', t('party.joined', { name: nameOf(sim, k) }));
    this.partyKeys = [...keys];

    const member = (k: string) => {
      if (k === sim.selfKey) {
        const p = sim.player;
        return {
          key: k,
          name: p.name,
          level: p.level,
          jobId: p.jobId,
          hp: Math.ceil(p.hp),
          maxHp: p.stats.maxHp,
          alive: p.alive,
          leader: party?.leader === k,
          near: true,
        };
      }
      const c = sim.adventurers.byKey(k)?.character;
      return {
        key: k,
        name: nameOf(sim, k),
        level: c?.level ?? 1,
        jobId: c?.jobId ?? 'novice',
        hp: Math.ceil(c?.hp ?? 0),
        maxHp: c?.stats.maxHp ?? 1,
        alive: c?.alive ?? false,
        leader: party?.leader === k,
        near: c ? near(c.motor.x) : false,
      };
    };
    const g = society.guilds.of(sim.selfKey);
    let guild: GuildView | null = null;
    if (g) {
      guild = {
        id: g.id,
        name: guildName(sim, g.id),
        emblem: g.emblem,
        leaderName: nameOf(sim, g.leader),
        fame: g.fame,
        members: g.members.map((k) => {
          const c = k === sim.selfKey ? sim.player : sim.adventurers.byKey(k)?.character;
          return {
            key: k,
            name: nameOf(sim, k),
            level: c?.level ?? 1,
            jobId: c?.jobId ?? 'novice',
            leader: g.leader === k,
            near: !!c && near(c.motor.x),
          };
        }),
        log: g.log
          .slice(-12)
          .reverse()
          .map((e) => ({
            kind: e.kind,
            who: nameOf(sim, e.who),
            detail: e.detail ?? '',
            ago: sim.time - e.t,
          })),
      };
    }
    const nearNpc = sim.town.npcs.find((n) => sim.town.near(n.def.id))?.def.id ?? null;
    this.stores.social.set({
      party: party ? party.members.map(member) : null,
      partyLeader: party?.leader === sim.selfKey,
      guild,
      guilds: society.guilds.all
        .map((x) => ({
          id: x.id,
          name: guildName(sim, x.id),
          emblem: x.emblem,
          leaderName: nameOf(sim, x.leader),
          members: x.members.length,
          fame: x.fame,
        }))
        .sort((a, b) => b.fame - a.fame),
      nearNpc,
    });
  }

  /** Roster and the inspected adventurer's card (2 Hz while visible). */
  publishAdventurers(force = false): void {
    const sim = this.sim;
    const { stores } = this;
    const ui = stores.ui.get();
    const visible = ui.windows.includes('adventurer') || ui.windows.includes('roster');
    this.advTimer -= 1 / 60;
    if (!force && (!visible || this.advTimer > 0)) return;
    this.advTimer = 0.5;
    const now = sim.time;
    const spawnX = sim.world.generator.spawnTileX;
    const summary = (a: Adventurer): AdventurerSummary => {
      const c = a.character;
      const g = sim.society.guilds.of(a.key);
      return {
        key: a.key,
        name: nameOf(sim, a.key),
        level: c.level,
        jobId: c.jobId,
        archetype: a.profile.archetype,
        active: a.tier === 'active',
        doing: !c.alive
          ? 'dead'
          : a.tier === 'active'
            ? now < a.listenUntil
              ? 'talk'
              : a.action
            : `abstract_${a.activity}`,
        hp: Math.ceil(c.hp),
        maxHp: c.stats.maxHp,
        alive: c.alive,
        x: Math.floor(c.motor.x / TILE_SIZE) - spawnX,
        affinity: a.memory.relations.get(sim.selfKey)?.affinity ?? 0,
        relation: relationLabel(a.memory.relations.get(sim.selfKey)),
        guild: g ? guildName(sim, g.id) : null,
        partyMate: sim.society.parties.same(sim.selfKey, a.key),
      };
    };
    const list = sim.adventurers.all.map(summary);
    const key = stores.adventurers.get().selected;
    const a = key ? sim.adventurers.byKey(key) : undefined;
    let detail: AdventurerDetail | null = null;
    if (a) {
      const g = a.goal;
      const rel = a.memory.relations.get(sim.selfKey);
      const goalParams = (): Record<string, string | number> => {
        if (!g) return {};
        switch (g.kind) {
          case 'level':
            return { level: g.target };
          case 'item':
            return { item: g.itemId, count: g.count };
          case 'slay':
            return { monster: g.monsterId, n: g.progress, count: g.count };
          case 'explore':
            return { x: Math.round(g.targetX - spawnX) };
          case 'wealth':
            return { gold: g.target };
          case 'raid':
            return { monster: g.monsterId };
        }
      };
      const ties = [...a.memory.relations.entries()]
        .filter(([k, r]) => k !== sim.selfKey && Math.abs(r.affinity) >= 0.2)
        .sort((x, y) => Math.abs(y[1].affinity) - Math.abs(x[1].affinity))
        .slice(0, 5)
        .map(([k, r]) => ({
          key: k,
          name: nameOf(sim, k),
          label: relationLabel(r),
          affinity: r.affinity,
        }));
      detail = {
        ...summary(a),
        personality: a.profile.personality,
        tone: toneOf(a.profile.personality),
        skill: a.profile.skill,
        preferredJob: a.profile.preferredJob,
        nightOwl: a.profile.nightOwl,
        goal: g ? { kind: g.kind, params: goalParams() } : null,
        memories: a.memory.recall(now, 6).map((m) => ({
          kind: m.kind,
          detail:
            m.kind === 'guild' && m.detail
              ? guildName(sim, m.detail)
              : m.kind === 'traded' && m.detail
                ? itemName(m.detail)
                : m.detail,
          who: m.subject ? nameOf(sim, m.subject) : undefined,
          ago: now - m.t,
        })),
        scores: Object.entries(a.scores)
          .map(([k, v]) => [k, Math.round((v ?? 0) * 100) / 100] as const)
          .sort((x, y) => y[1] - x[1]),
        met: rel?.met ?? 0,
        helped: rel?.helped ?? 0,
        talks: rel?.talks ?? 0,
        trades: rel?.trades ?? 0,
        raids: rel?.raids ?? 0,
        weapon: a.character.heldWeapon()
          ? (a.character.inventory.get(a.character.selectedSlot)?.itemId ?? null)
          : null,
        ties,
        talkable: sim.town.talkable(a.key) !== null,
      };
    }
    stores.adventurers.set({ list, detail });
  }

  // --- Input --------------------------------------------------------------------------------

  /** Right-click at a world point: talk to an NPC. Returns true if handled. */
  onRightClick(wx: number, wy: number): boolean {
    const n = this.sim.town.npcAt(wx, wy);
    if (!n) return false;
    if (!this.sim.town.near(n.def.id)) {
      showToast(this.stores, t('npc.tooFar'));
      return true;
    }
    this.openDialogue({ kind: 'npc', id: n.def.id });
    return true;
  }

  openDialogue(target: { kind: 'npc'; id: string } | { kind: 'adventurer'; key: string }): void {
    this.stores.dialogue.set((d) => ({ target, seq: d.seq + 1 }));
    openWindow(this.stores, 'dialogue');
  }

  /** Coin pickups read better as gold in the feed. */
  static pickupLabel(itemId: string): string {
    return itemId === GOLD_DROP ? t('gold.pickup') : (itemRegistry.get(itemId)?.nameKey ?? itemId);
  }

  destroy(): void {
    this.npcs.destroy();
  }
}
