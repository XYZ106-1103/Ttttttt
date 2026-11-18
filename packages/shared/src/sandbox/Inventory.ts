import { type ItemRegistry, itemRegistry } from './ItemRegistry';

export interface ItemStack {
  readonly itemId: string;
  readonly count: number;
}

export interface InventoryData {
  readonly slots: readonly (ItemStack | null)[];
  readonly cursor: ItemStack | null;
}

export const INVENTORY_SIZE = 40;
export const HOTBAR_SIZE = 10;

/**
 * Slot-based inventory with a "cursor" stack (the stack held by the mouse while the inventory
 * window is open). Every mutation validates ids and counts, so the same class can run
 * authoritatively on the server (PHASE 6) — a client can only *request* operations.
 */
export class Inventory {
  readonly size: number;
  private readonly slots: (ItemStack | null)[];
  private cursorStack: ItemStack | null = null;
  /** Increments on every change (UI change detection, save dirty-tracking). */
  version = 0;

  constructor(
    size = INVENTORY_SIZE,
    private readonly items: ItemRegistry = itemRegistry,
  ) {
    this.size = size;
    this.slots = new Array<ItemStack | null>(size).fill(null);
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  get cursor(): ItemStack | null {
    return this.cursorStack;
  }

  snapshot(): InventoryData {
    return { slots: [...this.slots], cursor: this.cursorStack };
  }

  private touch(): void {
    this.version++;
  }

  private validIndex(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < this.size;
  }

  count(itemId: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.itemId === itemId) n += s.count;
    return n;
  }

  /** How many of `itemId` could be added right now. */
  capacityFor(itemId: string): number {
    const max = this.items.maxStack(itemId);
    if (max === 0) return 0;
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.itemId === itemId) room += max - s.count;
    }
    return room;
  }

  /**
   * Add items, filling existing stacks first (hotbar order), then empty slots.
   * Returns the amount that did NOT fit.
   */
  add(itemId: string, count: number): number {
    if (!this.items.has(itemId) || !Number.isInteger(count) || count <= 0)
      return Math.max(0, count | 0);
    const max = this.items.maxStack(itemId);
    let left = count;
    for (let i = 0; i < this.size && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.itemId === itemId && s.count < max) {
        const n = Math.min(left, max - s.count);
        this.slots[i] = { itemId, count: s.count + n };
        left -= n;
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { itemId, count: n };
        left -= n;
      }
    }
    if (left !== count) this.touch();
    return left;
  }

  /** Remove `count` of an item from anywhere. All-or-nothing. */
  remove(itemId: string, count: number): boolean {
    if (!Number.isInteger(count) || count <= 0 || this.count(itemId) < count) return false;
    let left = count;
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.itemId === itemId) {
        const n = Math.min(left, s.count);
        this.slots[i] = s.count - n > 0 ? { itemId, count: s.count - n } : null;
        left -= n;
      }
    }
    this.touch();
    return true;
  }

  /** Remove from a specific slot. Returns the removed amount. */
  removeAt(index: number, count: number): number {
    const s = this.validIndex(index) ? this.slots[index] : null;
    if (!s || !Number.isInteger(count) || count <= 0) return 0;
    const n = Math.min(count, s.count);
    this.slots[index] = s.count - n > 0 ? { itemId: s.itemId, count: s.count - n } : null;
    this.touch();
    return n;
  }

  /** Move/merge/swap between two slots (drag & drop). */
  move(from: number, to: number): boolean {
    if (!this.validIndex(from) || !this.validIndex(to) || from === to) return false;
    const a = this.slots[from] ?? null;
    const b = this.slots[to] ?? null;
    if (!a) return false;
    if (b && b.itemId === a.itemId) {
      const max = this.items.maxStack(a.itemId);
      const n = Math.min(a.count, max - b.count);
      if (n <= 0) {
        this.slots[from] = b;
        this.slots[to] = a;
      } else {
        this.slots[to] = { itemId: a.itemId, count: b.count + n };
        this.slots[from] = a.count - n > 0 ? { itemId: a.itemId, count: a.count - n } : null;
      }
    } else {
      this.slots[from] = b;
      this.slots[to] = a;
    }
    this.touch();
    return true;
  }

  /**
   * Inventory-window click semantics (cursor stack):
   * - left: pick up / put down / merge / swap with the cursor
   * - right: pick up half / put down one
   */
  click(index: number, button: 'left' | 'right'): boolean {
    if (!this.validIndex(index)) return false;
    const slot = this.slots[index] ?? null;
    const cur = this.cursorStack;
    if (button === 'left') {
      if (!cur && !slot) return false;
      if (cur && slot && cur.itemId === slot.itemId) {
        const max = this.items.maxStack(slot.itemId);
        const n = Math.min(cur.count, max - slot.count);
        if (n > 0) {
          this.slots[index] = { itemId: slot.itemId, count: slot.count + n };
          this.cursorStack =
            cur.count - n > 0 ? { itemId: cur.itemId, count: cur.count - n } : null;
        } else {
          this.slots[index] = cur;
          this.cursorStack = slot;
        }
      } else {
        this.slots[index] = cur;
        this.cursorStack = slot;
      }
      this.touch();
      return true;
    }
    if (!cur) {
      if (!slot) return false;
      const take = Math.ceil(slot.count / 2);
      this.cursorStack = { itemId: slot.itemId, count: take };
      this.slots[index] =
        slot.count - take > 0 ? { itemId: slot.itemId, count: slot.count - take } : null;
      this.touch();
      return true;
    }
    if (slot && slot.itemId !== cur.itemId) return false;
    const max = this.items.maxStack(cur.itemId);
    if (slot && slot.count >= max) return false;
    this.slots[index] = { itemId: cur.itemId, count: (slot?.count ?? 0) + 1 };
    this.cursorStack = cur.count - 1 > 0 ? { itemId: cur.itemId, count: cur.count - 1 } : null;
    this.touch();
    return true;
  }

  /** Put the cursor stack back into the inventory. Returns what did not fit (to drop in world). */
  returnCursor(): ItemStack | null {
    const cur = this.cursorStack;
    if (!cur) return null;
    this.cursorStack = null;
    const left = this.add(cur.itemId, cur.count);
    this.touch();
    return left > 0 ? { itemId: cur.itemId, count: left } : null;
  }

  toJSON(): InventoryData {
    return this.snapshot();
  }

  /** Load saved data, dropping unknown items and clamping counts (never trust saves blindly). */
  load(data: Partial<InventoryData> | null | undefined): void {
    this.slots.fill(null);
    this.cursorStack = null;
    const clean = (s: unknown): ItemStack | null => {
      if (!s || typeof s !== 'object') return null;
      const { itemId, count } = s as { itemId?: unknown; count?: unknown };
      if (typeof itemId !== 'string' || !this.items.has(itemId)) return null;
      const n = Math.min(Math.floor(Number(count)), this.items.maxStack(itemId));
      return Number.isFinite(n) && n > 0 ? { itemId, count: n } : null;
    };
    (data?.slots ?? []).slice(0, this.size).forEach((s, i) => (this.slots[i] = clean(s)));
    const cur = clean(data?.cursor);
    if (cur) this.add(cur.itemId, cur.count);
    this.touch();
  }
}
