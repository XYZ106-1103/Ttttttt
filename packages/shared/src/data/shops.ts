/**
 * NPC shops. Stock is finite and restocks over time, so shop prices respond to supply: the less
 * is left, the more it costs. Shops buy anything with a value (at a fraction of the market
 * reference price) — the main way new gold enters the world besides monster coins.
 */
export interface ShopStock {
  readonly item: string;
  readonly max: number;
  /** Units restocked per in-game hour. */
  readonly restock: number;
}

export interface ShopDef {
  readonly id: string;
  readonly nameKey: string;
  /** Selling price = base value × markup (× up to 1.5 when stock runs low). */
  readonly markup: number;
  /** Buy-back price = market reference × buyRate (lower while the shop is glutted). */
  readonly buyRate: number;
  readonly stock: readonly ShopStock[];
}

export const SHOP_DEFS: readonly ShopDef[] = [
  {
    id: 'general_store',
    nameKey: 'shop.general_store',
    markup: 2,
    buyRate: 0.4,
    stock: [
      { item: 'healing_potion', max: 60, restock: 8 },
      { item: 'mana_potion', max: 40, restock: 6 },
      { item: 'torch', max: 80, restock: 10 },
      { item: 'wood_platform', max: 60, restock: 10 },
      { item: 'worn_pickaxe', max: 3, restock: 1 },
      { item: 'worn_axe', max: 3, restock: 1 },
      { item: 'training_sword', max: 2, restock: 1 },
      { item: 'oak_staff', max: 2, restock: 1 },
      { item: 'oak_bow', max: 2, restock: 1 },
      { item: 'worn_dagger', max: 2, restock: 1 },
      { item: 'traveler_hood', max: 2, restock: 0.5 },
      { item: 'traveler_coat', max: 2, restock: 0.5 },
      { item: 'traveler_boots', max: 2, restock: 0.5 },
      { item: 'copper_pickaxe', max: 1, restock: 0.25 },
    ],
  },
  {
    id: 'smithy',
    nameKey: 'shop.smithy',
    markup: 2,
    buyRate: 0.4,
    stock: [
      { item: 'enhance_stone', max: 40, restock: 6 },
      { item: 'copper_pickaxe', max: 2, restock: 0.5 },
      { item: 'copper_axe', max: 2, restock: 0.5 },
      { item: 'copper_sword', max: 1, restock: 0.25 },
      { item: 'copper_helmet', max: 1, restock: 0.25 },
      { item: 'copper_armor', max: 1, restock: 0.25 },
      { item: 'copper_greaves', max: 1, restock: 0.25 },
    ],
  },
];

export function getShopDef(id: string): ShopDef | undefined {
  return SHOP_DEFS.find((s) => s.id === id);
}
