import { useSyncExternalStore } from 'react';
import type { Store } from '../../app/store';

/** Subscribe a component to a store slice. Selectors should return stable primitives/objects. */
export function useStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
