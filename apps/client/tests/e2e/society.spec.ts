import { expect, type Page, test } from '@playwright/test';

interface Hooks {
  snapshot(): { mode: string; x: number; y: number };
  npc(id: string): { x: number; y: number; near: boolean } | null;
}

const hooks = (page: Page) => page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__);

async function chat(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.getByTestId('chat-input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/** Walk (teleport) to an NPC and right-click them. */
async function talkToNpc(page: Page, id: string, offsetTiles: number): Promise<void> {
  void hooks;
  const tile = await page.evaluate(() => {
    const s = (window as unknown as { __PW__: Hooks }).__PW__.snapshot();
    return { x: Math.floor(s.x / 16), y: Math.floor(s.y / 16) };
  });
  // NPC columns are relative to spawn; the player starts at spawn.
  await chat(page, `/tp ${tile.x + offsetTiles} ${tile.y - 6}`);
  await expect
    .poll(
      () => page.evaluate((n) => (window as unknown as { __PW__: Hooks }).__PW__.npc(n)?.near, id),
      {
        timeout: 10_000,
      },
    )
    .toBe(true);
  const at = await page.evaluate((n) => (window as unknown as { __PW__: Hooks }).__PW__.npc(n), id);
  if (!at) throw new Error(`no npc ${id}`);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByTestId('window-dialogue')).toBeVisible();
}

test.describe('PROJECT WORLD — PHASE 5 living world', () => {
  test('village NPCs: shop, exchange listing, guilds; adventurers talk in chat', async ({
    page,
  }) => {
    // Waiting for adventurers to start chatting can take up to 90 s on its own.
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('start-button').click();
    await page.waitForFunction(
      () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
    );
    await expect(page.getByTestId('hud-gold')).toBeVisible();
    await chat(page, '/gold 300');
    await expect(page.getByTestId('hud-gold')).toContainText('300');

    // Shop: buy a potion from the shopkeeper.
    await talkToNpc(page, 'shopkeeper', -14);
    await page.getByTestId('dlg-shop').click();
    await expect(page.getByTestId('window-shop')).toBeVisible();
    await page.getByTestId('shop-buy-healing_potion').click();
    await expect(page.getByTestId('hud-gold')).not.toContainText('300');
    await page.keyboard.press('Escape');

    // Exchange: list the training sword.
    await talkToNpc(page, 'clerk', 34);
    await page.getByTestId('dlg-exchange').click();
    await expect(page.getByTestId('window-exchange')).toBeVisible();
    await page.getByTestId('ex-tab-sell').click();
    const slot = await page.evaluate(() => {
      const st = (
        window as unknown as {
          __PW__: { stores: { inventory: { get(): { slots: ({ itemId: string } | null)[] } } } };
        }
      ).__PW__.stores.inventory.get();
      return st.slots.findIndex((s) => s?.itemId === 'training_sword');
    });
    expect(slot).toBeGreaterThanOrEqual(0);
    await page.getByTestId(`ex-pick-${slot}`).click();
    await page.getByTestId('ex-price').fill('25');
    await page.getByTestId('ex-list').click();
    await page.getByTestId('ex-tab-mine').click();
    await expect(page.getByTestId('ex-mine-training_sword')).toBeVisible();
    await page.keyboard.press('Escape');

    // Guilds window (G).
    await page.keyboard.press('KeyG');
    await expect(page.getByTestId('window-guild')).toBeVisible();
    await page.keyboard.press('KeyG');

    // Adventurers chat among themselves near the village.
    await chat(page, '/spawn');
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as unknown as {
                  __PW__: { stores: { chat: { get(): { messages: { channel: string }[] } } } };
                }
              ).__PW__.stores.chat
                .get()
                .messages.filter((m) => m.channel === 'nearby').length,
          ),
        { timeout: 90_000 },
      )
      .toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
