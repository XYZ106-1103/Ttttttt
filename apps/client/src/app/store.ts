/**
 * Minimal observable store. The game writes, React reads via useSyncExternalStore.
 * Kept dependency-free and tiny on purpose — the game/UI boundary should stay explicit.
 */
export interface Store<T> {
  get(): T;
  set(update: Partial<T> | ((prev: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const patch = typeof update === 'function' ? update(state) : update;
      let changed = false;
      for (const k of Object.keys(patch) as (keyof T)[]) {
        if (!Object.is(state[k], patch[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
