/// <reference lib="webworker" />
/** Web Worker: composes character sprite sheets off the main thread. */
import type { Appearance } from '../art/character/appearance';
import { composeCharacterAssets, transferables } from '../art/character/composeAssets';

interface Request {
  readonly id: string;
  readonly appearance: Appearance;
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, appearance } = e.data;
  try {
    const assets = composeCharacterAssets(appearance);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { id, assets },
      transferables(assets),
    );
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: String(err) });
  }
};
