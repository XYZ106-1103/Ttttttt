import { BossBar } from './BossBar';
import { BuffBar } from './BuffBar';
import { ChatBox } from './ChatBox';
import { CombatOverlay } from './CombatOverlay';
import { DebugOverlay } from './DebugOverlay';
import { ExpBar } from './ExpBar';
import { MenuBar } from './MenuBar';
import { Minimap } from './Minimap';
import { Hotbar } from './Hotbar';
import { PartyFrames } from './PartyFrames';
import { PickupFeed } from './PickupFeed';
import { PlayerPrompts } from './PlayerPrompts';
import { RegionBanner } from './RegionBanner';
import { StatusPanel } from './StatusPanel';

export function Hud() {
  return (
    <div className="pw-hud" data-testid="hud">
      <CombatOverlay />
      <StatusPanel />
      <PartyFrames />
      <PlayerPrompts />
      <BuffBar />
      <BossBar />
      <Minimap />
      <RegionBanner />
      <ChatBox />
      <Hotbar />
      <PickupFeed />
      <MenuBar />
      <ExpBar />
      <DebugOverlay />
    </div>
  );
}
