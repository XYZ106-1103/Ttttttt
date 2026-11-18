import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

export function DebugOverlay() {
  const { stores } = useServices();
  const visible = useStore(stores.ui, (s) => s.debugVisible);
  const showFps = useStore(stores.settings, (s) => s.showFps);
  const d = useStore(stores.debug, (s) => s);
  const w = useStore(stores.world, (s) => s);
  if (!visible && !showFps) return null;
  if (!visible) return <div className="pw-fps">{d.fps} FPS</div>;
  return (
    <div className="pw-debug pw-panel" data-testid="debug-overlay">
      <div className="pw-debug__title">{t('debug.title')} (F3)</div>
      <div>
        FPS {d.fps} · update {d.updateMs.toFixed(2)} ms
      </div>
      <div>
        pos {d.x}, {d.y} · tile {w.tileX}, {w.tileY}
      </div>
      <div>
        vel {d.vx}, {d.vy} · {d.grounded ? 'grounded' : 'airborne'}
      </div>
      <div>
        chunks rendered {d.chunksRendered} · generated {d.chunksGenerated}
      </div>
      <div>objects {d.objects}</div>
      <div>sim ticks {d.simSteps}</div>
      <div>seed {w.seed}</div>
    </div>
  );
}
