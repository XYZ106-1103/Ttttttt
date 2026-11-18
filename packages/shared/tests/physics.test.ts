import { describe, expect, it } from 'vitest';
import {
  createMotorState,
  DEFAULT_MOVEMENT,
  type MotorInput,
  type MotorState,
  SIM_DT,
  stepMotor,
  sweepX,
  sweepY,
  TILE_SIZE,
} from '../src';
import { gridFromAscii } from './helpers';

const T = TILE_SIZE;
const cfg = DEFAULT_MOVEMENT;

function input(partial: Partial<MotorInput> = {}): MotorInput {
  return { moveX: 0, jumpHeld: false, jumpPressed: false, down: false, ...partial };
}

/** Run the motor for `ticks` steps with a constant input (jumpPressed only on the first tick). */
function run(
  s: MotorState,
  grid: ReturnType<typeof gridFromAscii>,
  ticks: number,
  inp: Partial<MotorInput> = {},
) {
  for (let i = 0; i < ticks; i++) {
    stepMotor(
      s,
      input({ ...inp, jumpPressed: i === 0 ? !!inp.jumpPressed : false }),
      grid,
      cfg,
      SIM_DT,
    );
  }
  return s;
}

const flat = gridFromAscii([
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '....................',
  '####################',
]);
const groundY = 8 * T;

describe('TileCollider', () => {
  it('stops flush against a wall moving right and left', () => {
    const grid = gridFromAscii(['.....#....', '.....#....', '.....#....', '##########']);
    const body = { x: 2 * T, y: 3 * T, width: 14, height: 30 };
    sweepX(grid, body, 100);
    expect(body.x + 7).toBeCloseTo(5 * T, 5);
    sweepX(grid, body, 100);
    expect(body.x + 7).toBeCloseTo(5 * T, 5);
    const body2 = { x: 8 * T, y: 3 * T, width: 14, height: 30 };
    sweepX(grid, body2, -100);
    expect(body2.x - 7).toBeCloseTo(6 * T, 5);
  });

  it('lands on solid ground and does not tunnel at high speed', () => {
    const body = { x: 5 * T, y: 0, width: 14, height: 30 };
    const res = sweepY(flat, body, 10_000, { ignorePlatforms: false });
    expect(res.hitFloor).toBe(true);
    expect(body.y).toBe(groundY);
  });

  it('passes upward through platforms but lands on them from above', () => {
    const grid = gridFromAscii([
      '..........',
      '..........',
      '...====...',
      '..........',
      '..........',
      '##########',
    ]);
    const body = { x: 5 * T, y: 5 * T, width: 14, height: 30 };
    const up = sweepY(grid, body, -3 * T, { ignorePlatforms: false });
    expect(up.hitCeiling).toBe(false);
    expect(body.y).toBe(2 * T);
    // Now feet are exactly on the platform top: falling lands immediately.
    const down = sweepY(grid, body, 20, { ignorePlatforms: false });
    expect(down.hitFloor).toBe(true);
    expect(body.y).toBe(2 * T);
    // Dropping through ignores it.
    const drop = sweepY(grid, body, 20, { ignorePlatforms: true });
    expect(drop.hitFloor).toBe(false);
  });

  it('hits ceilings when moving up', () => {
    const grid = gridFromAscii([
      '##########',
      '..........',
      '..........',
      '..........',
      '##########',
    ]);
    const body = { x: 5 * T, y: 4 * T, width: 14, height: 30 };
    const res = sweepY(grid, body, -200, { ignorePlatforms: false });
    expect(res.hitCeiling).toBe(true);
    expect(body.y - body.height).toBe(T);
  });
});

describe('CharacterMotor', () => {
  it('falls onto ground and becomes grounded', () => {
    const s = createMotorState(5 * T, 2 * T, cfg);
    run(s, flat, 120);
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(groundY);
  });

  it('accelerates to run speed and decelerates to rest', () => {
    const s = createMotorState(3 * T, groundY, cfg);
    s.grounded = true;
    run(s, flat, 30, { moveX: 1 });
    expect(s.vx).toBeCloseTo(cfg.runSpeed, 5);
    expect(s.facing).toBe(1);
    run(s, flat, 30);
    expect(s.vx).toBe(0);
  });

  it('jump height matches tuning and variable jump cuts it short', () => {
    const measure = (holdTicks: number) => {
      const s = createMotorState(5 * T, groundY, cfg);
      s.grounded = true;
      let minY = s.y;
      for (let i = 0; i < 120; i++) {
        stepMotor(s, input({ jumpPressed: i === 0, jumpHeld: i < holdTicks }), flat, cfg, SIM_DT);
        minY = Math.min(minY, s.y);
      }
      expect(s.grounded).toBe(true);
      return groundY - minY;
    };
    const full = measure(120);
    const tap = measure(1);
    // Full jump should clear 5 tiles (platform spacing in the start zone is 4 tiles).
    expect(full).toBeGreaterThan(5 * T);
    expect(full).toBeLessThan(6.5 * T);
    expect(tap).toBeLessThan(full * 0.45);
    expect(tap).toBeGreaterThan(T);
  });

  it('allows a jump within coyote time after walking off a ledge', () => {
    const grid = gridFromAscii([
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '..........',
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
    ]);
    const s = createMotorState(4 * T, 6 * T, cfg);
    s.grounded = true;
    // Walk right until we leave the ledge.
    let ticks = 0;
    while (s.grounded && ticks < 200) {
      stepMotor(s, input({ moveX: 1 }), grid, cfg, SIM_DT);
      ticks++;
    }
    expect(s.grounded).toBe(false);
    // Two ticks later (~33ms) a jump must still be accepted.
    stepMotor(s, input({ moveX: 1 }), grid, cfg, SIM_DT);
    stepMotor(s, input({ moveX: 1, jumpPressed: true, jumpHeld: true }), grid, cfg, SIM_DT);
    expect(s.events.jumped).toBe(true);
    expect(s.vy).toBeLessThan(0);
  });

  it('rejects a jump after coyote time has expired', () => {
    const s = createMotorState(5 * T, 2 * T, cfg); // airborne from the start
    run(s, flat, 3);
    stepMotor(s, input({ jumpPressed: true, jumpHeld: true }), flat, cfg, SIM_DT);
    expect(s.events.jumped).toBe(false);
  });

  it('buffers a jump pressed shortly before landing', () => {
    const s = createMotorState(5 * T, groundY - 6, cfg);
    s.vy = 300;
    stepMotor(s, input({ jumpPressed: true, jumpHeld: true }), flat, cfg, SIM_DT);
    let jumped = s.events.jumped;
    for (let i = 0; i < 6 && !jumped; i++) {
      stepMotor(s, input({ jumpHeld: true }), flat, cfg, SIM_DT);
      jumped = s.events.jumped;
    }
    expect(jumped).toBe(true);
  });

  it('auto-steps up one tile but not two', () => {
    const one = gridFromAscii([
      '............',
      '............',
      '............',
      '............',
      '.......#####',
      '############',
    ]);
    const s = createMotorState(3 * T, 5 * T, cfg);
    s.grounded = true;
    run(s, one, 60, { moveX: 1 });
    expect(s.y).toBe(4 * T);
    expect(s.x).toBeGreaterThan(8 * T);

    const two = gridFromAscii([
      '............',
      '............',
      '............',
      '.......#####',
      '.......#####',
      '############',
    ]);
    const s2 = createMotorState(3 * T, 5 * T, cfg);
    s2.grounded = true;
    run(s2, two, 60, { moveX: 1 });
    expect(s2.y).toBe(5 * T);
    expect(s2.x + cfg.bodyWidth / 2).toBeCloseTo(7 * T, 3);
  });

  it('snaps down single-tile steps without leaving the ground', () => {
    const grid = gridFromAscii([
      '............',
      '............',
      '............',
      '............',
      '#####.......',
      '############',
    ]);
    const s = createMotorState(2 * T, 4 * T, cfg);
    s.grounded = true;
    let everAirborne = false;
    for (let i = 0; i < 60; i++) {
      stepMotor(s, input({ moveX: 1 }), grid, cfg, SIM_DT);
      if (!s.grounded) everAirborne = true;
    }
    expect(everAirborne).toBe(false);
    expect(s.y).toBe(5 * T);
  });

  it('drops through a platform with down + jump', () => {
    const grid = gridFromAscii([
      '..........',
      '..........',
      '..........',
      '..........',
      '..====....',
      '..........',
      '..........',
      '..........',
      '..........',
      '##########',
    ]);
    const s = createMotorState(4 * T, 4 * T, cfg);
    run(s, grid, 5);
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(4 * T);
    stepMotor(s, input({ down: true, jumpPressed: true, jumpHeld: true }), grid, cfg, SIM_DT);
    expect(s.events.droppedThrough).toBe(true);
    run(s, grid, 90, { down: true });
    expect(s.y).toBe(9 * T);
  });

  it('is deterministic for identical inputs', () => {
    const a = createMotorState(5 * T, 2 * T, cfg);
    const b = createMotorState(5 * T, 2 * T, cfg);
    for (let i = 0; i < 300; i++) {
      const inp = input({
        moveX: Math.sin(i / 20) > 0 ? 1 : -1,
        jumpPressed: i % 50 === 0,
        jumpHeld: i % 50 < 20,
      });
      stepMotor(a, inp, flat, cfg, SIM_DT);
      stepMotor(b, inp, flat, cfg, SIM_DT);
    }
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
  });
});
