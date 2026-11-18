import type { ItemStack } from '@world/shared';
import { useServices } from '../context';

/** Pixel-crisp item icon with an optional stack count. */
export function ItemIcon({
  stack,
  size = 32,
}: {
  readonly stack: ItemStack | null;
  readonly size?: number;
}) {
  const { icons } = useServices();
  if (!stack) return null;
  const src = icons[stack.itemId];
  return (
    <span className="pw-item" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" width={size} height={size} draggable={false} /> : null}
      {stack.count > 1 ? <span className="pw-item__count">{stack.count}</span> : null}
    </span>
  );
}
