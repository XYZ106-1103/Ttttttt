import { type Browser, expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
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
}

interface Hooks {
  snapshot(): Snapshot;
  peers(): Peer[];
  tile(tx: number, ty: number): number;
  stores: { chat: { get(): { messages: { text: string; author: string | null }[] } } };
}

type Win = { __PW__: Hooks };

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as Win).__PW__.snapshot());
const peers = (page: Page): Promise<Peer[]> =>
  page.evaluate(() => (window as unknown as Win).__PW__.peers());
const tileAt = (page: Page, tx: number, ty: number): Promise<number> =>
  page.evaluate(([x, y]) => (window as unknown as Win).__PW__.tile(x, y), [tx, ty] as const);
const chatTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    (window as unknown as Win).__PW__.stores.chat.get().messages.map((m) => m.text),
  );

/** Register a fresh account, create a character with a look, and enter the online world. */
async function enterOnline(browser: Browser, name: string, look: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
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
  });
});
