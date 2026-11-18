import { alpha, type Color, mix, TRANSPARENT } from './color';

/**
 * A plain RGBA pixel buffer with the drawing primitives procedural pixel art needs.
 * Deliberately DOM-free: generators can run in tests, in workers or in build scripts.
 */
export class PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint32Array<ArrayBuffer>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint32Array(width * height);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Color {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    return this.data[y * this.width + x] ?? TRANSPARENT;
  }

  isOpaque(x: number, y: number): boolean {
    return alpha(this.get(x, y)) > 0;
  }

  set(x: number, y: number, c: Color): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (!this.inBounds(xi, yi)) return;
    this.data[yi * this.width + xi] = c;
  }

  /** Alpha-composite `c` over the existing pixel. */
  blend(x: number, y: number, c: Color): void {
    const a = alpha(c);
    if (a === 0) return;
    if (a === 255) {
      this.set(x, y, c);
      return;
    }
    const dst = this.get(x, y);
    if (alpha(dst) === 0) {
      this.set(x, y, c);
      return;
    }
    const blended = mix(dst, c, a / 255);
    this.set(x, y, (blended & 0x00ffffff) | (Math.max(alpha(dst), a) << 24));
  }

  fillRect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x, y, c);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: Color): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  /** Copy another canvas onto this one (transparent pixels skipped). */
  blit(src: PixelCanvas, dx: number, dy: number, flipX = false): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.data[y * src.width + x] ?? 0;
        if (alpha(c) === 0) continue;
        const tx = flipX ? dx + src.width - 1 - x : dx + x;
        this.blend(tx, dy + y, c);
      }
    }
  }

  /** Copy a rectangular region from another canvas. */
  blitRegion(
    src: PixelCanvas,
    sx: number,
    sy: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
  ): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = src.get(sx + x, sy + y);
        if (alpha(c) !== 0) this.set(dx + x, dy + y, c);
      }
    }
  }

  /**
   * Add a 1px outline around all opaque pixels.
   * `corners` also outlines diagonal neighbors (thicker, rounder look).
   */
  outline(c: Color, corners = false): void {
    const marks: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.isOpaque(x, y)) continue;
        const n =
          this.isOpaque(x - 1, y) ||
          this.isOpaque(x + 1, y) ||
          this.isOpaque(x, y - 1) ||
          this.isOpaque(x, y + 1) ||
          (corners &&
            (this.isOpaque(x - 1, y - 1) ||
              this.isOpaque(x + 1, y - 1) ||
              this.isOpaque(x - 1, y + 1) ||
              this.isOpaque(x + 1, y + 1)));
        if (n) marks.push(y * this.width + x);
      }
    }
    for (const i of marks) this.data[i] = c;
  }

  clear(): void {
    this.data.fill(0);
  }

  clone(): PixelCanvas {
    const c = new PixelCanvas(this.width, this.height);
    c.data.set(this.data);
    return c;
  }

  /** Count of opaque pixels (used by tests to sanity-check generated art). */
  opaqueCount(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if ((this.data[i] ?? 0) >>> 24 > 0) n++;
    return n;
  }

  /** Raw bytes in RGBA order, suitable for ImageData. */
  toBytes(): Uint8ClampedArray<ArrayBuffer> {
    return new Uint8ClampedArray(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }
}

/** Parse an ASCII template into a grid of palette keys ('.' or ' ' = empty). */
export function parseTemplate(rows: readonly string[]): string[][] {
  return rows.map((r) => r.split(''));
}

/** Draw a template with a palette lookup at (dx, dy). Unknown keys are skipped. */
export function drawTemplate(
  target: PixelCanvas,
  rows: readonly string[],
  palette: Readonly<Record<string, Color>>,
  dx: number,
  dy: number,
  flipX = false,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < row.length; x++) {
      const key = row[x] ?? '.';
      if (key === '.' || key === ' ') continue;
      const c = palette[key];
      if (c === undefined) continue;
      const tx = flipX ? dx + row.length - 1 - x : dx + x;
      target.set(tx, dy + y, c);
    }
  }
}
