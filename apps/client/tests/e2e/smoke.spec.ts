import { expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  zoom: number;
  hour: number;
  camera: { left: number; top: number };
  chunks: number;
}

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() =>
    (window as unknown as { __PW__: { snapshot: () => Snapshot } }).__PW__.snapshot(),
  );

async function startGame(page: Page): Promise<Snapshot> {
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('start-button').click();
  await page.waitForFunction(
    () =>
      (
        window as unknown as { __PW__?: { snapshot?: () => { mode?: string } } }
      ).__PW__?.snapshot?.()?.mode === 'playing',
  );
  await expect(page.getByTestId('hud')).toBeVisible();
  return snapshot(page);
}

async function chat(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test.describe('PROJECT WORLD — PHASE 1 smoke', () => {
  test('boots to the title screen without runtime errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('canvas')).toHaveCount(1);
    await page.waitForTimeout(1500);
    await test.info().attach('title', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });

  test('spawns the player on solid ground with HUD and pixel-perfect zoom', async ({ page }) => {
    const s = await startGame(page);
    expect(s.grounded).toBe(true);
    expect(s.zoom).toBe(2);
    expect(s.chunks).toBeGreaterThan(0);
    await expect(page.getByTestId('hud-status')).toBeVisible();
    await expect(page.getByTestId('hud-minimap')).toBeVisible();
    await expect(page.getByTestId('hud-chat')).toContainText('PROJECT WORLD');
  });

  test('runs, jumps, lands and the camera follows', async ({ page }) => {
    const s0 = await startGame(page);
    await page.keyboard.down('KeyD');
    await page.waitForFunction((x0) => {
      const s = (window as unknown as { __PW__: { snapshot: () => Snapshot } }).__PW__.snapshot();
      return s.x > x0 + 48;
    }, s0.x);
    await page.keyboard.up('KeyD');
    const s1 = await snapshot(page);
    expect(s1.camera.left).toBeGreaterThan(s0.camera.left);

    await page.waitForFunction(
      () =>
        (window as unknown as { __PW__: { snapshot: () => Snapshot } }).__PW__.snapshot().grounded,
    );
    const ground = (await snapshot(page)).y;
    await page.keyboard.down('Space');
    await page.waitForFunction(
      (gy) =>
        (window as unknown as { __PW__: { snapshot: () => Snapshot } }).__PW__.snapshot().y <
        gy - 40,
      ground,
    );
    await page.keyboard.up('Space');
    await page.waitForFunction((gy) => {
      const s = (window as unknown as { __PW__: { snapshot: () => Snapshot } }).__PW__.snapshot();
      return s.grounded && Math.abs(s.y - gy) < 1;
    }, ground);
    await test.info().attach('moved', { body: await page.screenshot(), contentType: 'image/png' });
  });

  test('chat commands, windows and menu respond to the keyboard', async ({ page }) => {
    await startGame(page);
    await chat(page, '/time 22');
    await expect(page.getByTestId('hud-clock')).toHaveText(/^22:/);
    await page.keyboard.press('KeyC');
    await expect(page.getByTestId('window-character')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('window-character')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-menu')).toHaveCount(0);
    await test.info().attach('night', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
