import { type Browser, expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
  actionsShown: number;
  lastActionAt: number;
  online: boolean;
  ready: boolean;
  x: number;
  y: number;
  zoom: number;
  camera: { left: number; top: number };
  peers: number;
  peerSprites: number;
  selectedSlot: number;
}

interface Peer {
  key: string;
  name: string;
  x: number;
  y: number;
}

/** Right-click another player until their menu opens (bodies move; NPCs may be in the way). */
async function openPlayerMenu(page: Page, name: string): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const s = await snap(page);
    const p = (await peers(page)).find((x) => x.name === name);
    if (p)
      await page.mouse.click((p.x - s.camera.left) * s.zoom, (p.y - 22 - s.camera.top) * s.zoom, {
        button: 'right',
      });
    if (await page.getByTestId('window-player').isVisible()) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('window-player')).toBeVisible();
}

interface Hooks {
  snapshot(): Snapshot;
  peers(): Peer[];
  tile(tx: number, ty: number): number;
  count(itemId: string): number;
  stores: { chat: { get(): { messages: { text: string; author: string | null }[] } } };
}

type Win = { __PW__: Hooks };

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as Win).__PW__.snapshot());
const peers = (page: Page): Promise<Peer[]> =>
  page.evaluate(() => (window as unknown as Win).__PW__.peers());
const tileAt = (page: Page, tx: number, ty: number): Promise<number> =>
  page.evaluate(([x, y]) => (window as unknown as Win).__PW__.tile(x, y), [tx, ty] as const);
const count = (page: Page, itemId: string): Promise<number> =>
  page.evaluate((id) => (window as unknown as Win).__PW__.count(id), itemId);
const chatTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as Win).__PW__.stores.chat.get().messages.map((m) => m.text),
  );

/** Register a fresh account, create a character with a look, and enter the online world. */
async function enterOnline(
  browser: Browser,
  name: string,
  look: number,
  /** Artificial one-way delay on the game socket (ms), to test prediction under latency. */
  lagMs = 0,
): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  if (lagMs > 0)
    await page.routeWebSocket(/\/ws/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => setTimeout(() => server.send(m), lagMs));
      server.onMessage((m) => setTimeout(() => ws.send(m), lagMs));
    });
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('online-button').click();
  await page.getByTestId('online-register-tab').click();
  await page.getByTestId('online-email').fill(`${name.toLowerCase()}@e2e.dev`);
  await page.getByTestId('online-password').fill('password123');
  await page.getByTestId('online-submit').click();
  await page.getByTestId('online-new-character').click();
  await page.getByTestId('online-name').fill(name);
  await page.locator('.pw-online__look').nth(look).click();
  await page.getByTestId('online-create').click();
  await page.getByTestId(`online-enter-${name}`).click();
  await expect
    .poll(async () => {
      const s = await snap(page);
      return s?.online && s.ready && s.mode === 'playing';
    })
    .toBe(true);
  return page;
}

test.describe('PROJECT WORLD — PHASE 6 online play', () => {
  test('two players share one world: movement, chat and terrain changes', async ({ browser }) => {
    const tag = String(Date.now() % 100000);
    const alice = await enterOnline(browser, `Al${tag}`, 1);
    const bob = await enterOnline(browser, `Bo${tag}`, 3);

    // Each sees the other (drawn with their own look).
    await expect.poll(async () => (await snap(bob)).peerSprites).toBe(1);
    await expect.poll(async () => (await snap(alice)).peers).toBe(1);

    // Alice runs: Bob sees her where she is.
    const x0 = (await snap(alice)).x;
    await alice.keyboard.down('d');
    await alice.waitForTimeout(900);
    await alice.keyboard.up('d');
    await alice.waitForTimeout(600);
    const x1 = (await snap(alice)).x;
    expect(x1 - x0).toBeGreaterThan(40);
    await expect
      .poll(async () => {
        const seen = (await peers(bob))[0];
        return seen ? Math.abs(seen.x - x1) : 999;
      })
      .toBeLessThan(4);

    // Chat travels through the server.
    await alice.keyboard.press('Enter');
    await alice.getByTestId('chat-input').fill('hello from Alice');
    await alice.keyboard.press('Enter');
    await expect.poll(async () => (await chatTexts(bob)).includes('hello from Alice')).toBe(true);

    // Alice digs the ground next to her with the pickaxe: the tile disappears for Bob too.
    const s = await snap(alice);
    const tx = Math.floor(s.x / 16) + 1;
    const ty = Math.round(s.y / 16);
    await alice.mouse.move(
      (tx * 16 + 8 - s.camera.left) * s.zoom,
      (ty * 16 + 8 - s.camera.top) * s.zoom,
    );
    await alice.mouse.down();
    await expect.poll(() => tileAt(bob, tx, ty), { timeout: 20_000 }).toBe(0);
    await alice.mouse.up();
    await expect.poll(() => tileAt(alice, tx, ty)).toBe(0);

    // Leaving returns to the title screen; Bob no longer sees Alice.
    await alice.keyboard.press('Escape');
    await alice.getByTestId('menu-title').click();
    await expect(alice.getByTestId('title-screen')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await snap(bob)).peers).toBe(0);
    await alice.context().close();
    await bob.context().close();
  });

  test('own attacks start instantly even with 300 ms of round-trip lag', async ({ browser }) => {
    const tag = String(Date.now() % 100000);
    const page = await enterOnline(browser, `La${tag}`, 2, 150);
    await page.keyboard.press('3'); // training sword
    await expect.poll(async () => (await snap(page)).selectedSlot).toBe(2);
    await page.waitForTimeout(800);
    const s = await snap(page);
    const before = s.actionsShown;
    const sx = (s.x + 40 - s.camera.left) * s.zoom;
    const sy = (s.y - 20 - s.camera.top) * s.zoom;
    await page.mouse.move(sx, sy);
    const t0 = await page.evaluate(() => performance.now());
    await page.mouse.down();
    await page.mouse.up();
    await expect
      .poll(async () => (await snap(page)).actionsShown, { timeout: 5_000 })
      .toBe(before + 1);
    const shownAt = (await snap(page)).lastActionAt;
    // Without prediction the swing would wait for the server (≥ 300 ms round trip).
    console.log(`own swing shown after ${Math.round(shownAt - t0)} ms (lag 150 ms each way)`);
    expect(shownAt - t0).toBeLessThan(200);
    // The server's echo of the same swing is not shown a second time.
    await page.waitForTimeout(1500);
    expect((await snap(page)).actionsShown).toBe(before + 1);
    await page.context().close();
  });

  test('players party up, trade face to face and whisper', async ({ browser }) => {
    const tag = String(Date.now() % 100000);
    const alice = await enterOnline(browser, `Pa${tag}`, 0);
    const bob = await enterOnline(browser, `Pb${tag}`, 2);
    await expect
      .poll(async () => (await peers(alice)).some((p) => p.name === `Pb${tag}`))
      .toBe(true);
    // Step apart from the crowd at the spawn so the right-click lands on Bob.
    await bob.keyboard.down('d');
    await bob.waitForTimeout(500);
    await bob.keyboard.up('d');
    await bob.waitForTimeout(500);

    // Party invitation through the player menu.
    await openPlayerMenu(alice, `Pb${tag}`);
    await alice.getByTestId('player-invite').click();
    await bob.getByTestId('invite-accept').click();
    await expect(alice.getByTestId('hud-party')).toBeVisible();
    await expect(bob.getByTestId('hud-party')).toBeVisible();

    // Trade: Alice offers her torches, Bob offers nothing; both confirm.
    const torchesA = await count(alice, 'torch');
    const torchesB = await count(bob, 'torch');
    expect(torchesA).toBeGreaterThan(0);
    await openPlayerMenu(alice, `Pb${tag}`);
    await alice.getByTestId('player-trade').click();
    await bob.getByTestId('trade-accept').click();
    await expect(alice.getByTestId('window-player-trade')).toBeVisible();
    await expect(bob.getByTestId('window-player-trade')).toBeVisible();
    const slot = await alice.evaluate(() =>
      (
        window as unknown as {
          __PW__: { stores: { inventory: { get(): { slots: ({ itemId: string } | null)[] } } } };
        }
      ).__PW__.stores.inventory
        .get()
        .slots.findIndex((x) => x?.itemId === 'torch'),
    );
    await alice.getByTestId(`ptrade-inv-${slot}`).click();
    await expect(bob.getByTestId('ptrade-theirs')).toContainText('×');
    await alice.getByTestId('ptrade-confirm').click();
    await bob.getByTestId('ptrade-confirm').click();
    await expect(alice.getByTestId('window-player-trade')).toBeHidden();
    await expect.poll(() => count(bob, 'torch')).toBe(torchesA + torchesB);
    await expect.poll(() => count(alice, 'torch')).toBe(0);

    // Whisper.
    await bob.keyboard.press('Enter');
    await bob.getByTestId('chat-input').fill(`/w Pa${tag} thanks!`);
    await bob.keyboard.press('Enter');
    await expect.poll(async () => (await chatTexts(alice)).includes('thanks!')).toBe(true);
    await alice.context().close();
    await bob.context().close();
  });
});
