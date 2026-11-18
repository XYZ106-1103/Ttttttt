import type { WindowId } from '../../app/stores';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { closeWindow, focusWindow } from '../windowActions';
import { CharacterWindow } from './CharacterWindow';
import { KeyGuideWindow } from './KeyGuideWindow';
import { SettingsWindow } from './SettingsWindow';

const COMPONENTS: Record<WindowId, typeof CharacterWindow> = {
  character: CharacterWindow,
  settings: SettingsWindow,
  keyGuide: KeyGuideWindow,
};

/** Renders open windows in focus order (last = top). */
export function WindowLayer() {
  const { stores } = useServices();
  const windows = useStore(stores.ui, (s) => s.windows);
  return (
    <>
      {windows.map((id, i) => {
        const C = COMPONENTS[id];
        return (
          <C
            key={id}
            zIndex={100 + i}
            onClose={() => closeWindow(stores, id)}
            onFocus={() => focusWindow(stores, id)}
          />
        );
      })}
    </>
  );
}
