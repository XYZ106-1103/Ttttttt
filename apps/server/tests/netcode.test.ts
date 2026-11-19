/**
 * End-to-end netcode: the real client (`NetClient` + `OnlineSimulation` from the web client)
 * against the real server over WebSocket. The local player's predicted position must agree with
 * the server's authoritative one, with steady input and with bursty input (a slow client
 * rendering 10 frames per second sends its ticks in clumps).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDLE_ACTION, type MotorInput, SIM_DT } from '@world/shared';
import { NetClient } from '../../client/src/net/NetClient';
import { OnlineSimulation } from '../../client/src/game/sim/OnlineSimulation';
import { newPlayer, sleep, startServer, type TestServer } from './helpers';

let srv: TestServer;

beforeEach(async () => {
  srv = await startServer();
});

afterEach(async () => {
  await srv.close();
});

/** Run right, jump, keep running, turn around, stop. */
function inputAt(t: number): MotorInput {
  const moveX = t < 2 ? 1 : t < 3 ? -1 : 0;
  const jumpPressed = (t >= 1 && t < 1 + SIM_DT) || (t >= 2.4 && t < 2.4 + SIM_DT);
  const jumpHeld = (t >= 1 && t < 1.3) || (t >= 2.4 && t < 2.6);
  return { moveX, jumpPressed, jumpHeld, down: false };
}

async function join(email: string, name: string): Promise<OnlineSimulation> {
  const p = await newPlayer(srv.url, email, name);
  const net = await NetClient.connect(`${srv.url.replace('http', 'ws')}/ws`, p.token, p.char);
  const sim = new OnlineSimulation(net, net.welcome);
  for (let i = 0; i < 100 && !sim.ready; i++) await sleep(20);
  expect(sim.ready).toBe(true);
  return sim;
}

/** Drive the client in real time; `framesPerBurst` ticks run together (1 = a smooth 60 fps). */
async function drive(sim: OnlineSimulation, seconds: number, framesPerBurst: number) {
  let t = 0;
  let worst = 0;
  const start = performance.now();
  while (t < seconds) {
    for (let i = 0; i < framesPerBurst && t < seconds; i++) {
      sim.tick(SIM_DT, inputAt(t), null, IDLE_ACTION);
      t += SIM_DT;
    }
    // Ignore the first moments while the first snapshots settle the position.
    if (t > 0.3) worst = Math.max(worst, sim.maxCorrection);
    sim.maxCorrection = 0;
    const due = start + t * 1000;
    await sleep(Math.max(0, due - performance.now()));
  }
  // Let the last inputs reach the server and its snapshots come back.
  for (let i = 0; i < 20; i++) {
    sim.tick(SIM_DT, { moveX: 0, jumpPressed: false, jumpHeld: false, down: false });
    await sleep(17);
  }
  worst = Math.max(worst, sim.maxCorrection);
  return worst;
}

describe('netcode: prediction and reconciliation', () => {
  it('keeps the predicted player in step with the server (smooth 60 fps client)', async () => {
    const sim = await join('smooth@x.dev', 'Smooth');
    const worst = await drive(sim, 3.5, 1);
    const server = srv.world.sim.playerOf(sim.selfKey);
    expect(server).toBeTruthy();
    // The server agrees with where the client ended up.
    expect(Math.abs((server?.motor.x ?? 0) - sim.player.motor.x)).toBeLessThan(1);
    expect(worst).toBeLessThan(2);
    sim.close();
  });

  it('stays in step for a slow client sending its ticks in bursts (10 fps)', async () => {
    const sim = await join('bursty@x.dev', 'Bursty');
    const worst = await drive(sim, 3.5, 6);
    const server = srv.world.sim.playerOf(sim.selfKey);
    expect(Math.abs((server?.motor.x ?? 0) - sim.player.motor.x)).toBeLessThan(1);
    expect(worst).toBeLessThan(2);
    sim.close();
  });

  it('a very slow client (5 fps, long bursts) keeps moving and ends where the server is', async () => {
    const sim = await join('slow@x.dev', 'Slow');
    const x0 = sim.player.motor.x;
    await drive(sim, 2, 12);
    const server = srv.world.sim.playerOf(sim.selfKey);
    expect((server?.motor.x ?? 0) - x0).toBeGreaterThan(100);
    expect(Math.abs((server?.motor.x ?? 0) - sim.player.motor.x)).toBeLessThan(1);
    sim.close();
  });

  it('shows other players moving (interpolated) and replicates the world', async () => {
    const a = await join('mover@x.dev', 'Mover');
    const b = await join('viewer@x.dev', 'Viewer');
    await drive(a, 1.2, 1);
    for (let i = 0; i < 20; i++) {
      b.tick(SIM_DT, { moveX: 0, jumpPressed: false, jumpHeld: false, down: false });
      await sleep(17);
    }
    const seen = b.peers().find((p) => p.key === a.selfKey);
    expect(seen?.name).toBe('Mover');
    expect(Math.abs((seen?.motor.x ?? 0) - a.player.motor.x)).toBeLessThan(4);
    a.close();
    b.close();
  });
});
