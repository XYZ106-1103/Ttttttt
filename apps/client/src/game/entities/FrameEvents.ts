import type { MotorEvents } from '@world/shared';

/** Motor events accumulated over all simulation ticks within one rendered frame. */
export interface FrameEvents {
  jumped: boolean;
  landed: boolean;
  landingSpeed: number;
  stepped: number;
  droppedThrough: boolean;
}

export function createFrameEvents(): FrameEvents {
  return { jumped: false, landed: false, landingSpeed: 0, stepped: 0, droppedThrough: false };
}

export function resetFrameEvents(e: FrameEvents): void {
  e.jumped = false;
  e.landed = false;
  e.landingSpeed = 0;
  e.stepped = 0;
  e.droppedThrough = false;
}

export function accumulate(into: FrameEvents, ev: Readonly<MotorEvents>): void {
  into.jumped ||= ev.jumped;
  if (ev.landed) {
    into.landed = true;
    into.landingSpeed = Math.max(into.landingSpeed, ev.landingSpeed);
  }
  into.stepped += ev.stepped;
  into.droppedThrough ||= ev.droppedThrough;
}
