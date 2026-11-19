import { describe, expect, it } from 'vitest';
import {
  decodeInputs,
  decodeSnapshot,
  ENT_ADVENTURER,
  ENT_MONSTER,
  encodeInputs,
  encodeSnapshot,
  findAction,
  IDLE_ACTION,
  parseClientMessage,
  ProtocolError,
  Rng,
  type Snapshot,
} from '../src';

describe('network protocol', () => {
  it('round-trips input batches', () => {
    const frames = [
      {
        seq: 7,
        move: { moveX: -1, jumpHeld: true, jumpPressed: true, down: false },
        use: { tx: 1024, ty: -3 },
        action: {
          ...IDLE_ACTION,
          attackHeld: true,
          aimX: 12.5,
          aimY: -40,
          skillSlot: 2,
          dodge: true,
        },
      },
      {
        seq: 8,
        move: { moveX: 0.5, jumpHeld: false, jumpPressed: false, down: true },
        use: null,
        action: IDLE_ACTION,
      },
    ];
    const back = decodeInputs(encodeInputs(frames));
    expect(back).toHaveLength(2);
    expect(back[0]?.use).toEqual({ tx: 1024, ty: -3 });
    expect(back[0]?.action.skillSlot).toBe(2);
    expect(back[0]?.action.dodge).toBe(true);
    expect(back[1]?.move.moveX).toBeCloseTo(0.5);
    expect(back[1]?.move.down).toBe(true);
  });

  it('round-trips snapshots with a shared string table', () => {
    const s: Snapshot = {
      tick: 99,
      time: 12.25,
      ack: 41,
      hour: 9.5,
      day: 3,
      self: {
        x: 100,
        y: 200,
        vx: 1,
        vy: -2,
        facing: -1,
        grounded: true,
        jumping: false,
        alive: true,
        coyoteTimer: 0.1,
        jumpBufferTimer: 0,
        dropTimer: 0,
        airTime: 0,
      },
      entities: [
        {
          kind: ENT_ADVENTURER,
          id: 5,
          key: 'adv-01',
          name: '',
          look: 0,
          x: 1,
          y: 2,
          vx: 0,
          vy: 0,
          facing: 1,
          flags: 3,
          hp: 50,
          maxHp: 80,
          level: 6,
          job: 'warrior',
          held: 'copper_sword',
          action: 'fight',
          aimX: 4,
          aimY: 5,
        },
        {
          kind: ENT_MONSTER,
          id: 9,
          def: 'dew_slime',
          anim: 'hop',
          x: 3,
          y: 4,
          vx: 0,
          vy: 0,
          facing: -1,
          flags: 1,
          hp: 10,
          maxHp: 40,
          deadTime: 0,
          statuses: ['burn', 'slow'],
        },
      ],
    };
    const back = decodeSnapshot(encodeSnapshot(s));
    expect(back.tick).toBe(99);
    expect(back.self?.facing).toBe(-1);
    expect(back.entities[0]).toMatchObject({ key: 'adv-01', job: 'warrior', held: 'copper_sword' });
    expect(back.entities[1]).toMatchObject({ def: 'dew_slime', statuses: ['burn', 'slow'] });
  });

  it('never accepts garbage: random bytes only ever raise ProtocolError', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 2000; i++) {
      const n = rng.int(0, 64);
      const buf = new Uint8Array(n);
      for (let k = 0; k < n; k++) buf[k] = rng.int(0, 255);
      if (n > 0) buf[0] = rng.chance(0.5) ? 2 : 1;
      for (const decode of [decodeInputs, decodeSnapshot]) {
        try {
          decode(buf);
        } catch (err) {
          expect(err).toBeInstanceOf(ProtocolError);
        }
      }
    }
  });

  it('validates text messages strictly', () => {
    expect(() => parseClientMessage('nope')).toThrow(ProtocolError);
    expect(() => parseClientMessage('{"t":"chat","ch":"all","text":""}')).toThrow(ProtocolError);
    expect(() =>
      parseClientMessage(JSON.stringify({ t: 'chat', ch: 'all', text: 'x'.repeat(500) })),
    ).toThrow(ProtocolError);
    expect(() => parseClientMessage('{"t":"hello","token":"x","v":1}')).toThrow(ProtocolError);
    expect(parseClientMessage('{"t":"ping","n":3}')).toEqual({ t: 'ping', n: 3 });
    expect(findAction('punch')?.id).toBe('punch');
  });
});
