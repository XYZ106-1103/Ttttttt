import type { ZoomSetting } from '../app/settings';

/** Target internal (art-pixel) screen height. 1080p → zoom 2 → 540 art pixels tall. */
export const TARGET_INTERNAL_HEIGHT = 540;

/** Integer zoom keeps every art pixel the same size on screen (crisp pixel art). */
export function computeZoom(screenHeight: number, setting: ZoomSetting): number {
  if (setting !== 'auto') return setting;
  return Math.max(1, Math.round(screenHeight / TARGET_INTERNAL_HEIGHT));
}

/** Snap a world coordinate to the screen-pixel grid for a given zoom (no shimmering). */
export function snapToPixel(value: number, zoom: number): number {
  return Math.round(value * zoom) / zoom;
}
