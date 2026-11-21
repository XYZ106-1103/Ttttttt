import { expect, type Page, test } from '@playwright/test';

interface Hooks {
  snapshot(): { mode: string; x: number; y: number };
  npc(id: string): { x: number; y: number; near: boolean } | null;
  stores: {
    inventory: { get(): { slots: ({ itemId: string; plus?: number } | null)[] } };
    quests: { get(): { active: { id: string }[] } };
  };
}
type Win = { __PW__: Hooks };

async function chat(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.getByTestId('chat-input').fill(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

let spawn = { x: 0, y: 0 };

async function talkToNpc(page: Page, id: string, offsetTiles: number): Promise<void> {
  await chat(page, `/tp ${spawn.x + offsetTiles} ${spawn.y - 6}`);
  await expect
    .poll(() => page.evaluate((n) => (window as unknown as Win).__PW__.npc(n)?.near, id), {
      timeout: 10_000,
    })
    .toBe(true);
  const at = await page.evaluate((n) => (window as unknown as Win).__PW__.npc(n), id);
  if (!at) throw new Error(`no npc ${id}`);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await expect(page.getByTestId('window-dialogue')).toBeVisible();
}

const slotOf = (page: Page, itemId: string) =>
  page.evaluate(
    (id) =>
      (window as unknown as Win).__PW__.stores.inventory
        .get()
        .slots.findIndex((s) => s?.itemId === id),
    itemId,
  );

test.describe('PROJECT WORLD — PHASE 7 progression', () => {
  test('blacksmith enhances gear and the guide hands out quests', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('start-button').click();
    await page.waitForFunction(
      () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
    );
    spawn = await page.evaluate(() => {
      const s = (window as unknown as Win).__PW__.snapshot();
      return { x: Math.floor(s.x / 16), y: Math.floor(s.y / 16) };
    });
    await chat(page, '/gold 5000');
    await chat(page, '/give copper_helmet 1');
    await chat(page, '/give enhance_stone 20');

    // Blacksmith: +0 → +1 always succeeds.
    await talkToNpc(page, 'blacksmith', 6);
    await page.getByTestId('dlg-enhance').click();
    await expect(page.getByTestId('window-enhance')).toBeVisible();
    const helmet = await slotOf(page, 'copper_helmet');
    expect(helmet).toBeGreaterThanOrEqual(0);
    await page.getByTestId(`enhance-slot-${helmet}`).click();
    await page.getByTestId('enhance-go').click();
    await expect(page.getByTestId('enhance-result')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (i) => (window as unknown as Win).__PW__.stores.inventory.get().slots[i]?.plus ?? 0,
          helmet,
        ),
      )
      .toBe(1);
    await page.screenshot({ path: 'test-results/enhance.png' });
    await page.keyboard.press('Escape');

    // Guide: accept the first chapter; it shows in the quest tracker.
    await talkToNpc(page, 'guide', -6);
    await page.getByTestId('dlg-quests').click();
    await expect(page.getByTestId('window-quests')).toBeVisible();
    await page.getByTestId('quests-tab-available').click();
    await page.getByTestId('quest-accept-first_steps').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as Win).__PW__.stores.quests.get().active.map((q) => q.id),
        ),
      )
      .toContain('first_steps');
    await expect(page.getByTestId('quest-tracker')).toBeVisible();
    await page.getByTestId('quests-tab-active').click();
    await page.screenshot({ path: 'test-results/quests.png' });
    expect(errors).toEqual([]);
  });
});
