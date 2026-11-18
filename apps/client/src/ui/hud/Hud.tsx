import { ChatBox } from './ChatBox';
import { DebugOverlay } from './DebugOverlay';
import { ExpBar } from './ExpBar';
import { MenuBar } from './MenuBar';
import { Minimap } from './Minimap';
import { QuickSlots } from './QuickSlots';
import { RegionBanner } from './RegionBanner';
import { StatusPanel } from './StatusPanel';

export function Hud() {
  return (
    <div className="pw-hud" data-testid="hud">
      <StatusPanel />
      <Minimap />
      <RegionBanner />
      <ChatBox />
      <QuickSlots />
      <MenuBar />
      <ExpBar />
      <DebugOverlay />
    </div>
  );
}
