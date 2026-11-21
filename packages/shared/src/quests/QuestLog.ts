/**
 * One character's quests: what is active and how far along, which story quests are done and
 * when each bounty was last finished. Saved with the character and sent to its owner as private
 * state (plain JSON); every loaded value is sanitized.
 */
import type { BiomeId } from '../data/biomes';
import {
  dailyBounties,
  getQuestDef,
  MAX_ACTIVE_QUESTS,
  type QuestDef,
  STORY_QUESTS,
} from '../data/quests';
import type { Inventory } from '../sandbox/Inventory';

export interface ActiveQuest {
  readonly id: string;
  /** Progress per objective (collect objectives are read from the inventory instead). */
  readonly progress: number[];
}

export interface QuestLogData {
  readonly active: readonly ActiveQuest[];
  readonly done: readonly string[];
  /** Bounty id → in-game day it was last turned in. */
  readonly bounties: Readonly<Record<string, number>>;
}

export type QuestFail =
  | 'unknown'
  | 'level'
  | 'locked'
  | 'done'
  | 'active'
  | 'full'
  | 'not_offered'
  | 'not_active'
  | 'incomplete'
  | 'no_room'
  | 'too_far';

export class QuestLog {
  private activeList: ActiveQuest[] = [];
  private readonly doneSet = new Set<string>();
  private readonly bountyDays = new Map<string, number>();
  version = 0;

  get active(): readonly ActiveQuest[] {
    return this.activeList;
  }

  isDone(id: string): boolean {
    return this.doneSet.has(id);
  }

  isActive(id: string): boolean {
    return this.activeList.some((q) => q.id === id);
  }

  /** Story quests that can be accepted now, then today's open bounties. */
  available(key: string, level: number, day: number): QuestDef[] {
    const out: QuestDef[] = [];
    for (const q of STORY_QUESTS) {
      if (this.doneSet.has(q.id) || this.isActive(q.id)) continue;
      if (q.prereq && !this.doneSet.has(q.prereq)) continue;
      out.push(q);
      break; // one chapter at a time
    }
    for (const q of dailyBounties(key, day, level))
      if (!this.isActive(q.id) && this.bountyDays.get(q.id) !== day) out.push(q);
    return out;
  }

  canAccept(def: QuestDef | undefined, key: string, level: number, day: number): QuestFail | null {
    if (!def) return 'unknown';
    if (this.isActive(def.id)) return 'active';
    if (def.kind === 'story') {
      if (this.doneSet.has(def.id)) return 'done';
      if (def.prereq && !this.doneSet.has(def.prereq)) return 'locked';
    } else if (
      this.bountyDays.get(def.id) === day ||
      !dailyBounties(key, day, level).some((q) => q.id === def.id)
    )
      return 'not_offered';
    if (level < def.minLevel) return 'level';
    if (this.activeList.length >= MAX_ACTIVE_QUESTS) return 'full';
    return null;
  }

  accept(def: QuestDef): void {
    this.activeList.push({ id: def.id, progress: def.objectives.map(() => 0) });
    this.version++;
  }

  abandon(id: string): boolean {
    const n = this.activeList.length;
    this.activeList = this.activeList.filter((q) => q.id !== id);
    if (this.activeList.length !== n) this.version++;
    return this.activeList.length !== n;
  }

  /** Current progress of an objective (collect objectives count the inventory). */
  progressOf(q: ActiveQuest, i: number, inv: Inventory): number {
    const o = getQuestDef(q.id)?.objectives[i];
    if (!o) return 0;
    if (o.kind === 'collect') return Math.min(o.count, inv.count(o.item));
    return Math.min(o.count, q.progress[i] ?? 0);
  }

  complete(q: ActiveQuest, inv: Inventory): boolean {
    const def = getQuestDef(q.id);
    return !!def && def.objectives.every((o, i) => this.progressOf(q, i, inv) >= o.count);
  }

  /** Mark a quest finished (the caller has checked it is complete and paid the reward). */
  finish(id: string, day: number): void {
    const def = getQuestDef(id);
    this.activeList = this.activeList.filter((q) => q.id !== id);
    if (def?.kind === 'story') this.doneSet.add(id);
    else this.bountyDays.set(id, day);
    this.version++;
  }

  private bump(test: (o: QuestDef['objectives'][number]) => number | null): boolean {
    let changed = false;
    for (const q of this.activeList) {
      const def = getQuestDef(q.id);
      def?.objectives.forEach((o, i) => {
        const v = test(o);
        if (v === null) return;
        const next = Math.min(o.count, v);
        if (next > (q.progress[i] ?? 0)) {
          q.progress[i] = next;
          changed = true;
        }
      });
    }
    if (changed) this.version++;
    return changed;
  }

  onKill(monsterId: string): boolean {
    let changed = false;
    for (const q of this.activeList) {
      getQuestDef(q.id)?.objectives.forEach((o, i) => {
        if (o.kind === 'kill' && o.target === monsterId && (q.progress[i] ?? 0) < o.count) {
          q.progress[i] = (q.progress[i] ?? 0) + 1;
          changed = true;
        }
      });
    }
    if (changed) this.version++;
    return changed;
  }

  onCraft(itemId: string, count: number): boolean {
    let changed = false;
    for (const q of this.activeList) {
      getQuestDef(q.id)?.objectives.forEach((o, i) => {
        if (o.kind === 'craft' && o.item === itemId && (q.progress[i] ?? 0) < o.count) {
          q.progress[i] = Math.min(o.count, (q.progress[i] ?? 0) + count);
          changed = true;
        }
      });
    }
    if (changed) this.version++;
    return changed;
  }

  onEnhance(plus: number): boolean {
    return this.bump((o) => (o.kind === 'enhance' ? plus : null));
  }

  onReach(biome: BiomeId): boolean {
    return this.bump((o) => (o.kind === 'reach' && o.biome === biome ? 1 : null));
  }

  /** Does any active quest still want this objective kind (cheap pre-check for the sim)? */
  wants(kind: QuestDef['objectives'][number]['kind']): boolean {
    return this.activeList.some((q) =>
      getQuestDef(q.id)?.objectives.some(
        (o, i) => o.kind === kind && (q.progress[i] ?? 0) < o.count,
      ),
    );
  }

  toJSON(): QuestLogData {
    return {
      active: this.activeList.map((q) => ({ id: q.id, progress: [...q.progress] })),
      done: [...this.doneSet],
      bounties: Object.fromEntries(this.bountyDays),
    };
  }

  load(data: Partial<QuestLogData> | null | undefined): void {
    this.activeList = [];
    this.doneSet.clear();
    this.bountyDays.clear();
    if (data && typeof data === 'object') {
      for (const id of Array.isArray(data.done) ? data.done : [])
        if (typeof id === 'string' && getQuestDef(id)?.kind === 'story') this.doneSet.add(id);
      const b = data.bounties && typeof data.bounties === 'object' ? data.bounties : {};
      for (const [id, day] of Object.entries(b))
        if (getQuestDef(id)?.kind === 'bounty' && Number.isFinite(Number(day)))
          this.bountyDays.set(id, Math.floor(Number(day)));
      for (const q of Array.isArray(data.active) ? data.active : []) {
        const def = q && typeof q.id === 'string' ? getQuestDef(q.id) : undefined;
        if (!def || this.isActive(def.id) || this.activeList.length >= MAX_ACTIVE_QUESTS) continue;
        if (def.kind === 'story' && this.doneSet.has(def.id)) continue;
        const raw = Array.isArray(q.progress) ? q.progress : [];
        this.activeList.push({
          id: def.id,
          progress: def.objectives.map((o, i) =>
            Math.max(0, Math.min(o.count, Math.floor(Number(raw[i]) || 0))),
          ),
        });
      }
    }
    this.version++;
  }
}
