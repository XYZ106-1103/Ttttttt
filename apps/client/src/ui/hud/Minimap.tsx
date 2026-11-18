import { useEffect, useRef } from 'react';
import { TILE_DEFS, ZONE_NAME_KEY } from '@world/shared';
import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

const W = 92;
const H = 60;
const SCALE = 2;

const tileColors = new Map<number, [number, number, number]>();
for (const d of TILE_DEFS) {
  const n = parseInt(d.mapColor.slice(1), 16);
  tileColors.set(d.id, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

function skyColor(hour: number): [number, number, number] {
  const day = hour >= 6 && hour < 18.5;
  const dusk = (hour >= 5 && hour < 6) || (hour >= 18.5 && hour < 19.5);
  if (day) return [120, 176, 222];
  if (dusk) return [150, 120, 150];
  return [30, 38, 74];
}

function formatClock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Top-right minimap rendered from live world data a few times per second. */
export function Minimap() {
  const { stores, bridge } = useServices();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const region = useStore(stores.world, (s) => s.regionNameKey);
  const hour = useStore(stores.world, (s) => s.timeOfDay);
  const day = useStore(stores.world, (s) => s.day);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const img = ctx.createImageData(W, H);
    let blink = 0;
    const draw = (): void => {
      const world = bridge.getWorld();
      const pos = bridge.getPlayerTile();
      if (!world || !pos) return;
      const sky = skyColor(stores.world.get().timeOfDay);
      const x0 = pos.x - (W >> 1);
      const y0 = pos.y - Math.floor(H * 0.55);
      const d = img.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const tx = x0 + x;
          const ty = y0 + y;
          const i = (y * W + x) * 4;
          let c: [number, number, number] = sky;
          if (world.inTileBounds(tx, ty)) {
            const fg = world.peekChunk(Math.floor(tx / 32), Math.floor(ty / 32))
              ? world.getFg(tx, ty)
              : 0;
            if (fg) c = tileColors.get(fg) ?? c;
            else {
              const bg = world.peekChunk(Math.floor(tx / 32), Math.floor(ty / 32))
                ? world.getBg(tx, ty)
                : 0;
              if (bg) c = tileColors.get(bg) ?? c;
            }
          } else if (ty >= 0) c = [20, 20, 28];
          d[i] = c[0];
          d[i + 1] = c[1];
          d[i + 2] = c[2];
          d[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      blink++;
      const px = pos.x - x0;
      const py = pos.y - y0;
      ctx.fillStyle = blink % 2 === 0 ? '#ffe36a' : '#ffffff';
      ctx.fillRect(px - 1, py - 2, 3, 3);
      ctx.fillStyle = '#1a1220';
      ctx.fillRect(px - 1, py + 1, 3, 1);
    };
    draw();
    const id = window.setInterval(draw, 300);
    return () => window.clearInterval(id);
  }, [bridge, stores]);

  const isNight = hour < 5.5 || hour >= 19.5;
  return (
    <div className="pw-minimap pw-panel pw-panel--ornate" data-testid="hud-minimap">
      <div className="pw-minimap__head">
        <span className="pw-minimap__zone">{t(ZONE_NAME_KEY)}</span>
        <span className="pw-minimap__region">{region ? t(region) : ''}</span>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ width: W * SCALE, height: H * SCALE }}
      />
      <div className="pw-minimap__foot">
        <span className={`pw-clock__icon ${isNight ? 'is-night' : ''}`}>{isNight ? '☾' : '☀'}</span>
        <span className="pw-clock__time" data-testid="hud-clock">
          {formatClock(hour)}
        </span>
        <span className="pw-clock__day">{t('hud.day', { day: day + 1 })}</span>
      </div>
    </div>
  );
}
