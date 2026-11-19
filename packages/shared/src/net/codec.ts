/**
 * Minimal binary reader/writer for the hot network paths (inputs, snapshots). Reads are bounds-
 * checked: malformed or truncated messages throw ProtocolError instead of producing garbage.
 */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

// Available in browsers and Node; declared locally because the shared package has no DOM lib.
declare const TextEncoder: new () => { encode(s: string): Uint8Array };
declare const TextDecoder: new (
  label?: string,
  options?: { fatal?: boolean },
) => { decode(bytes: Uint8Array): string };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor(capacity = 1024) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
    return this;
  }
  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.pos, v);
    this.pos += 1;
    return this;
  }
  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
    return this;
  }
  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.pos, v | 0, true);
    this.pos += 4;
    return this;
  }
  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
    return this;
  }
  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
    return this;
  }
  /** UTF-8 string, up to 255 bytes. */
  str(s: string): this {
    const bytes = encoder.encode(s);
    const n = Math.min(255, bytes.length);
    this.u8(n);
    this.ensure(n);
    this.buf.set(bytes.subarray(0, n), this.pos);
    this.pos += n;
    return this;
  }

  get length(): number {
    return this.pos;
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class Reader {
  private readonly view: DataView;
  private pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new ProtocolError('truncated message');
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** Finite float or ProtocolError (NaN/Infinity never enter the simulation). */
  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    if (!Number.isFinite(v)) throw new ProtocolError('non-finite number');
    return v;
  }
  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    if (!Number.isFinite(v)) throw new ProtocolError('non-finite number');
    return v;
  }
  str(): string {
    const n = this.u8();
    this.need(n);
    try {
      const s = decoder.decode(this.buf.subarray(this.pos, this.pos + n));
      this.pos += n;
      return s;
    } catch {
      throw new ProtocolError('invalid utf-8');
    }
  }

  get done(): boolean {
    return this.pos >= this.buf.length;
  }
}
