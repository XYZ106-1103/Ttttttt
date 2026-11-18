/**
 * Worn equipment (armor and accessories). Weapons are held from the hotbar, sandbox-style.
 * All operations validate slot category and level requirements so this can run on the server.
 */
import type { EquipCategory, StatBonus } from '../data/items';
import type { Inventory, ItemStack } from './Inventory';
import { type ItemRegistry, itemRegistry } from './ItemRegistry';

export type EquipSlotId = 'head' | 'body' | 'feet' | 'acc1' | 'acc2';
export const EQUIP_SLOTS: readonly EquipSlotId[] = ['head', 'body', 'feet', 'acc1', 'acc2'];

const SLOT_CATEGORY: Readonly<Record<EquipSlotId, EquipCategory>> = {
  head: 'head',
  body: 'body',
  feet: 'feet',
  acc1: 'accessory',
  acc2: 'accessory',
};

export type EquipFail = 'not_equipment' | 'wrong_slot' | 'level' | 'invalid' | 'no_space';

export type EquipmentData = Partial<Record<EquipSlotId, ItemStack | null>>;

export class Equipment {
  private readonly slots: Record<EquipSlotId, ItemStack | null> = {
    head: null,
    body: null,
    feet: null,
    acc1: null,
    acc2: null,
  };
  version = 0;

  constructor(private readonly items: ItemRegistry = itemRegistry) {}

  get(slot: EquipSlotId): ItemStack | null {
    return this.slots[slot];
  }

  snapshot(): Record<EquipSlotId, ItemStack | null> {
    return { ...this.slots };
  }

  /** Why `itemId` cannot go into `slot` for a character of `level` (null = allowed). */
  check(itemId: string, slot: EquipSlotId, level: number): EquipFail | null {
    const def = this.items.get(itemId);
    if (!def?.equip) return 'not_equipment';
    if (!EQUIP_SLOTS.includes(slot)) return 'invalid';
    if (SLOT_CATEGORY[slot] !== def.equip.category) return 'wrong_slot';
    if (level < def.equip.reqLevel) return 'level';
    return null;
  }

  /** Slot an item would go to by default (first free accessory slot, else the first). */
  slotFor(itemId: string): EquipSlotId | null {
    const cat = this.items.get(itemId)?.equip?.category;
    if (!cat) return null;
    if (cat !== 'accessory') return cat;
    return this.slots.acc1 && !this.slots.acc2 ? 'acc2' : 'acc1';
  }

  /** Equip the item in an inventory slot, swapping any worn item back into that slot. */
  equipFrom(inv: Inventory, index: number, level: number): EquipFail | null {
    const stack = inv.get(index);
    if (!stack) return 'invalid';
    const slot = this.slotFor(stack.itemId);
    if (!slot) return 'not_equipment';
    const fail = this.check(stack.itemId, slot, level);
    if (fail) return fail;
    const worn = this.slots[slot];
    inv.replaceAt(index, worn);
    this.slots[slot] = { itemId: stack.itemId, count: 1 };
    this.version++;
    return null;
  }

  /** Move a worn item back to the inventory. */
  unequip(inv: Inventory, slot: EquipSlotId): EquipFail | null {
    const worn = this.slots[slot];
    if (!worn) return 'invalid';
    if (inv.capacityFor(worn.itemId) < 1) return 'no_space';
    inv.add(worn.itemId, 1);
    this.slots[slot] = null;
    this.version++;
    return null;
  }

  /**
   * Inventory-window click on an equipment slot with the cursor stack: put the held item on
   * (swapping the worn one into the cursor) or pick the worn item up.
   */
  click(inv: Inventory, slot: EquipSlotId, level: number): EquipFail | null {
    const cur = inv.cursor;
    if (cur) {
      const fail = this.check(cur.itemId, slot, level);
      if (fail) return fail;
      const worn = this.slots[slot];
      inv.swapCursor(worn);
      this.slots[slot] = { itemId: cur.itemId, count: 1 };
      this.version++;
      return null;
    }
    const worn = this.slots[slot];
    if (!worn) return 'invalid';
    inv.swapCursor(worn);
    this.slots[slot] = null;
    this.version++;
    return null;
  }

  bonuses(): StatBonus[] {
    const out: StatBonus[] = [];
    for (const s of EQUIP_SLOTS) {
      const st = this.slots[s];
      const bonus = st ? this.items.get(st.itemId)?.equip?.bonus : undefined;
      if (bonus) out.push(bonus);
    }
    return out;
  }

  toJSON(): EquipmentData {
    return this.snapshot();
  }

  /** Load saved data, dropping anything that is not valid for its slot. */
  load(data: EquipmentData | null | undefined): void {
    for (const s of EQUIP_SLOTS) this.slots[s] = null;
    if (data && typeof data === 'object') {
      for (const s of EQUIP_SLOTS) {
        const st = data[s];
        if (
          st &&
          typeof st.itemId === 'string' &&
          this.check(st.itemId, s, Number.MAX_SAFE_INTEGER) === null
        )
          this.slots[s] = { itemId: st.itemId, count: 1 };
      }
    }
    this.version++;
  }
}
