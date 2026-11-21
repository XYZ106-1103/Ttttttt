import type { ReactNode } from 'react';
import type { WindowId } from '../../app/stores';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { closeWindow, focusWindow } from '../windowActions';
import { AdventurerWindow } from './AdventurerWindow';
import { DialogueWindow } from './DialogueWindow';
import { ExchangeWindow } from './ExchangeWindow';
import { GuildWindow } from './GuildWindow';
import { ShopWindow } from './ShopWindow';
import { EnhanceWindow } from './EnhanceWindow';
import { QuestWindow } from './QuestWindow';
import { TradeWindow } from './TradeWindow';
import { CharacterWindow } from './CharacterWindow';
import { RosterWindow } from './RosterWindow';
import { InventoryWindow } from './InventoryWindow';
import { JobAdvanceWindow } from './JobAdvanceWindow';
import { SkillWindow } from './SkillWindow';
import { WorldMapWindow } from './WorldMapWindow';
import { KeyGuideWindow } from './KeyGuideWindow';
import { SettingsWindow } from './SettingsWindow';
import { PlayerTradeWindow } from './PlayerTradeWindow';
import { PlayerWindow } from './PlayerWindow';

type WindowComponent = (props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) => ReactNode;

const COMPONENTS: Record<WindowId, WindowComponent> = {
  character: CharacterWindow,
  settings: SettingsWindow,
  keyGuide: KeyGuideWindow,
  inventory: InventoryWindow,
  worldMap: WorldMapWindow,
  skills: SkillWindow,
  adventurer: AdventurerWindow,
  roster: RosterWindow,
  jobAdvance: JobAdvanceWindow,
  dialogue: DialogueWindow,
  shop: ShopWindow,
  enhance: EnhanceWindow,
  quests: QuestWindow,
  exchange: ExchangeWindow,
  trade: TradeWindow,
  guild: GuildWindow,
  player: PlayerWindow,
  playerTrade: PlayerTradeWindow,
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
