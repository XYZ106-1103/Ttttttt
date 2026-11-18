import { expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
  zoom: number;
  camera: { left: number; top: number };
  adventurersActive: number;
  adventurerSprites: number;
}

interface AdventurerInfo {
  key: string;
  x: number;
  y: number;
}

interface Hooks {
  snapshot(): Snapshot;
  adventurers(): AdventurerInfo[];
}

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.snapshot());

test.describe('PROJECT WORLD — PHASE 4 AI adventurers', () => {
  test('adventurers live around the village and can be inspected', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('start-button').click();
    await page.waitForFunction(
      () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
    );
    // Adventurers near the player are simulated in full and drawn (textures come from a worker).
    await expect
      .poll(async () => (await snap(page)).adventurersActive, { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => (await snap(page)).adventurerSprites, { timeout: 60_000 })
      .toBeGreaterThan(0);

    // Right-click inspection (positions move between frames under software rendering: retry).
    for (let i = 0; i < 8; i++) {
      const s = await snap(page);
      const list = await page.evaluate(() =>
        (window as unknown as { __PW__: Hooks }).__PW__.adventurers(),
      );
      const a = list.find(
        (x) => x.x > s.camera.left + 30 && x.x < s.camera.left + 1920 / s.zoom - 30,
      );
      if (!a) break;
      await page.mouse.click((a.x - s.camera.left) * s.zoom, (a.y - 20 - s.camera.top) * s.zoom, {
        button: 'right',
      });
      if ((await page.getByTestId('window-adventurer').count()) > 0) break;
    }
    await page.keyboard.press('Escape');

    // Roster: everyone in the world, then open one card.
    await page.keyboard.press('KeyO');
    await expect(page.getByTestId('window-roster')).toBeVisible();
    await expect(page.locator('[data-testid^="roster-adv-"]')).toHaveCount(30);
    await page.locator('[data-testid^="roster-adv-"]').first().click();
    await expect(page.getByTestId('window-adventurer')).toBeVisible();
    await expect(page.getByTestId('window-adventurer').locator('.pw-trait')).toHaveCount(8);
    expect(errors).toEqual([]);
  });
});
