import { ITEM_DEFS, type ItemDef } from '../data/items';

/** Validated lookup over item data. */
export class ItemRegistry {
  private readonly byId = new Map<string, ItemDef>();

  constructor(defs: readonly ItemDef[] = ITEM_DEFS) {
    for (const d of defs) {
      if (this.byId.has(d.id)) throw new Error(`Duplicate item id: ${d.id}`);
      if (d.maxStack < 1) throw new Error(`Invalid maxStack for ${d.id}`);
      this.byId.set(d.id, d);
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): ItemDef | undefined {
    return this.byId.get(id);
  }

  require(id: string): ItemDef {
    const d = this.byId.get(id);
    if (!d) throw new Error(`Unknown item: ${id}`);
    return d;
  }

  maxStack(id: string): number {
    return this.byId.get(id)?.maxStack ?? 0;
  }

  all(): IterableIterator<ItemDef> {
    return this.byId.values();
  }
}

export const itemRegistry = new ItemRegistry();
