import { clamp, damp } from '@world/shared';

export interface CameraTarget {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly facing: number;
  readonly grounded: boolean;
}

export interface CameraBounds {
  readonly width: number;
  readonly height: number;
}

/**
 * Platformer camera: smooth horizontal follow with velocity look-ahead, and vertical
 * "platform snapping" — it re-centers on the ground height you land on instead of bobbing
 * with every jump. Pure math; the scene applies the resulting view rectangle.
 */
export class CameraController {
  /** View top-left in world pixels. */
  left = 0;
  top = 0;
  private cx = 0;
  private cy = 0;
  private lookAhead = 0;
  private anchorY = 0;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;
  shakeEnabled = true;

  /** Jump straight to a target (spawn, teleport, scene start). */
  snap(target: CameraTarget, viewW: number, viewH: number, bounds: CameraBounds): void {
    this.cx = target.x;
    this.anchorY = target.y;
    this.cy = target.y - viewH * 0.12;
    this.lookAhead = 0;
    this.apply(viewW, viewH, bounds, 0);
  }

  /** Smoothly pan toward an arbitrary point (title screen cinematic). */
  panTo(
    x: number,
    y: number,
    viewW: number,
    viewH: number,
    bounds: CameraBounds,
    dt: number,
  ): void {
    this.cx = damp(this.cx, x, 0.6, dt);
    this.cy = damp(this.cy, y, 0.8, dt);
    this.apply(viewW, viewH, bounds, dt);
  }

  update(
    target: CameraTarget,
    viewW: number,
    viewH: number,
    bounds: CameraBounds,
    dt: number,
  ): void {
    const speedFrac = clamp(Math.abs(target.vx) / 170, 0, 1);
    const desiredLook = Math.sign(target.vx || target.facing) * viewW * 0.07 * speedFrac;
    this.lookAhead = damp(this.lookAhead, desiredLook, 0.35, dt);
    this.cx = damp(this.cx, target.x + this.lookAhead, 0.1, dt);

    // Vertical: follow the ground the player stands on; while airborne only follow when the
    // player leaves a comfort window (big falls, tall climbs).
    if (target.grounded) this.anchorY = target.y;
    else {
      const above = this.anchorY - target.y;
      if (above > viewH * 0.28) this.anchorY = target.y + viewH * 0.28;
      if (target.y > this.anchorY) this.anchorY = target.y;
    }
    const desiredY = this.anchorY - viewH * 0.12;
    const falling = target.y > this.anchorY - 1 && !target.grounded;
    this.cy = damp(this.cy, desiredY, falling ? 0.06 : 0.16, dt);
    this.apply(viewW, viewH, bounds, dt);
  }

  shake(intensity: number, duration: number): void {
    if (!this.shakeEnabled) return;
    this.shakeIntensity = Math.max(
      this.shakeIntensity * (this.shakeTime / Math.max(this.shakeDuration, 1e-6)),
      intensity,
    );
    this.shakeDuration = duration;
    this.shakeTime = duration;
  }

  private apply(viewW: number, viewH: number, bounds: CameraBounds, dt: number): void {
    let left = this.cx - viewW / 2;
    let top = this.cy - viewH / 2;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dt);
      const k = this.shakeIntensity * (this.shakeTime / this.shakeDuration);
      left += (Math.random() * 2 - 1) * k;
      top += (Math.random() * 2 - 1) * k;
    }
    this.left = clamp(left, 0, Math.max(0, bounds.width - viewW));
    this.top = clamp(top, 0, Math.max(0, bounds.height - viewH));
  }
}
