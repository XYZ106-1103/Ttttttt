import type { Stores, WindowId } from '../app/stores';

export function toggleWindow(stores: Stores, id: WindowId): void {
  stores.ui.set((u) => ({
    windows: u.windows.includes(id) ? u.windows.filter((w) => w !== id) : [...u.windows, id],
  }));
}

export function closeWindow(stores: Stores, id: WindowId): void {
  stores.ui.set((u) => ({ windows: u.windows.filter((w) => w !== id) }));
}

export function focusWindow(stores: Stores, id: WindowId): void {
  stores.ui.set((u) =>
    u.windows[u.windows.length - 1] === id
      ? {}
      : { windows: [...u.windows.filter((w) => w !== id), id] },
  );
}

/** Open (or bring to front) a window. */
export function openWindow(stores: Stores, id: WindowId): void {
  stores.ui.set((u) => ({ windows: [...u.windows.filter((w) => w !== id), id] }));
}
