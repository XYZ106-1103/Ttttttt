import { ChatBox } from './ChatBox';
import { DebugOverlay } from './DebugOverlay';
import { ExpBar } from './ExpBar';
import { MenuBar } from './MenuBar';
import { Minimap } from './Minimap';
import { Hotbar } from './Hotbar';
import { PickupFeed } from './PickupFeed';
import { RegionBanner } from './RegionBanner';
import { StatusPanel } from './StatusPanel';

export function Hud() {
  return (
    <div className="pw-hud" data-testid="hud">
      <StatusPanel />
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
