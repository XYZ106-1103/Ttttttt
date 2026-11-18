/**
 * Everything a character needs on the GPU, as plain transferable data (RGBA bytes + frame
 * tables). Pure and DOM-free, so it runs in a Web Worker for AI adventurers.
 */
import type { Appearance } from './appearance';
import { composeArmFrames, composeCharacterSheet, type SheetFrame } from './CharacterComposer';

export interface ComposedSheet {
  readonly withArm: boolean;
  readonly width: number;
  readonly height: number;
  readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  readonly frames: readonly SheetFrame[];
  readonly animations: readonly {
    readonly key: string;
    readonly count: number;
    readonly frameRate: number;
    readonly repeat: number;
  }[];
}

export interface ComposedCharacter {
  readonly sheets: readonly ComposedSheet[];
  readonly arm: {
    readonly width: number;
    readonly height: number;
    readonly bytes: Uint8ClampedArray<ArrayBuffer>;
  };
}

export function composeCharacterAssets(appearance: Appearance): ComposedCharacter {
  const sheets = [true, false].map((withArm): ComposedSheet => {
    const sheet = composeCharacterSheet(appearance, undefined, withArm);
    return {
      withArm,
      width: sheet.canvas.width,
      height: sheet.canvas.height,
      bytes: sheet.canvas.toBytes(),
      frames: sheet.frames,
      animations: sheet.animations.map((a) => ({
        key: a.key,
        count: a.frames.length,
        frameRate: a.frameRate,
        repeat: a.repeat,
      })),
    };
  });
  const arm = composeArmFrames(appearance);
  return { sheets, arm: { width: arm.width, height: arm.height, bytes: arm.toBytes() } };
}

/** Buffers to transfer (zero-copy) when posting composed assets between threads. */
export function transferables(c: ComposedCharacter): ArrayBuffer[] {
  return [...c.sheets.map((s) => s.bytes.buffer), c.arm.bytes.buffer];
}
