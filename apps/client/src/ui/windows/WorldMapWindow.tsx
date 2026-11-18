import { CHUNK_SIZE, TILE_DEFS } from '@world/shared';
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useServices } from '../context';

const COLORS = new Map<number, [number, number, number]>();
for (const d of TILE_DEFS) {
  const n = parseInt(d.mapColor.slice(1), 16);
  COLORS.set(d.id, [(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}
const FOG: [number, number, number] = [11, 13, 22];
const SKY: [number, number, number] = [118, 170, 214];
const CAVE: [number, number, number] = [24, 22, 30];

/**
 * Full-screen world map of explored chunks. One pixel per tile; zoom with the wheel, drag to pan.
 */
export function WorldMapWindow({
  onClose,
}: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { bridge } = useServices();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ zoom: 2, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [marker, setMarker] = useState({ px: 0, py: 0, sx: 0, sy: 0 });

  useEffect(() => {
    const world = bridge.getWorld();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!world || !canvas || !ctx) return;
    canvas.width = world.widthTiles;
    canvas.height = world.heightTiles;
    setSize({ w: world.widthTiles, h: world.heightTiles });
    const img = ctx.createImageData(world.widthTiles, world.heightTiles);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = FOG[0];
      d[i + 1] = FOG[1];
      d[i + 2] = FOG[2];
      d[i + 3] = 255;
    }
    for (const index of bridge.getExplored()) {
      const cx = index % world.widthChunks;
      const cy = Math.floor(index / world.widthChunks);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const tx = cx * CHUNK_SIZE + lx;
          const ty = cy * CHUNK_SIZE + ly;
          const fg = world.getFg(tx, ty);
          let c: [number, number, number];
          if (fg) c = COLORS.get(fg) ?? CAVE;
          else if (world.getBg(tx, ty)) {
            const w = COLORS.get(world.getBg(tx, ty)) ?? CAVE;
            c = [w[0] * 0.55, w[1] * 0.55, w[2] * 0.55];
          } else c = ty < world.surfaceY(tx) + 4 ? SKY : CAVE;
          const p = (ty * world.widthTiles + tx) * 4;
          d[p] = c[0];
          d[p + 1] = c[1];
          d[p + 2] = c[2];
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const me = bridge.getPlayerTile();
    const spawnX = world.generator.spawnTileX;
    const spawnY = world.surfaceY(spawnX);
    if (me) {
      setMarker({ px: me.x, py: me.y, sx: spawnX, sy: spawnY });
      const box = viewportRef.current?.getBoundingClientRect();
      const bw = box?.width || 1200;
      const bh = box?.height || 600;
      const zoom = 3;
      setView({ zoom, x: bw / 2 - me.x * zoom, y: bh / 2 - me.y * zoom });
    }
  }, [bridge]);

  const onWheel = (e: React.WheelEvent): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const zoom = Math.max(1, Math.min(8, v.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const k = zoom / v.zoom;
      return { zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  return (
    <div
      className="pw-map"
      data-testid="window-worldmap"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="pw-map__frame pw-panel pw-panel--ornate">
        <div className="pw-map__head">
          <span className="pw-window__title">{t('window.worldMap')}</span>
          <span className="pw-note">{t('map.hint')}</span>
          <button
            type="button"
            className="pw-window__close"
            onClick={onClose}
            aria-label={t('window.close')}
          >
            ×
          </button>
        </div>
        <div
          ref={viewportRef}
          className="pw-map__viewport"
          onWheel={onWheel}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const dr = drag.current;
            if (dr)
              setView((v) => ({ ...v, x: dr.vx + e.clientX - dr.x, y: dr.vy + e.clientY - dr.y }));
          }}
          onPointerUp={() => (drag.current = null)}
        >
          <div
            className="pw-map__content"
            style={{
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
              width: size.w,
              height: size.h,
            }}
          >
            <canvas ref={canvasRef} />
            <span
              className="pw-map__marker is-spawn"
              style={{ left: marker.sx, top: marker.sy }}
              title={t('map.spawn')}
            />
            <span
              className="pw-map__marker is-you"
              style={{ left: marker.px, top: marker.py }}
              title={t('map.you')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
