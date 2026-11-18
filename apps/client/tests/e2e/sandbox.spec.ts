import { expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
  x: number;
  y: number;
  zoom: number;
  camera: { left: number; top: number };
}

interface Hooks {
  snapshot(): Snapshot;
  tile(tx: number, ty: number): number;
  count(itemId: string): number;
  flush(): Promise<void>;
}

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.snapshot());
const tileAt = (page: Page, tx: number, ty: number): Promise<number> =>
  page.evaluate(
    ([x, y]) => (window as unknown as { __PW__: Hooks }).__PW__.tile(x as number, y as number),
    [tx, ty],
  );

async function play(page: Page): Promise<Snapshot> {
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('start-button').click();
  await page.waitForFunction(
    () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
  );
  return snap(page);
}

function screenOf(tx: number, ty: number, s: Snapshot): { x: number; y: number } {
  return { x: (tx * 16 + 8 - s.camera.left) * s.zoom, y: (ty * 16 + 8 - s.camera.top) * s.zoom };
}

async function chat(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test.describe('PROJECT WORLD — PHASE 2 sandbox', () => {
  test('mines a block, collects the drop, places it, and world changes survive a reload', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const s0 = await play(page);
    const tx = Math.floor(s0.x / 16) + 2;
    const ty = Math.round(s0.y / 16);
    expect(await tileAt(page, tx, ty)).not.toBe(0);

    await page.keyboard.press('Digit1'); // worn pickaxe
    let p = screenOf(tx, ty, await snap(page));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(
      ([x, y]) =>
        (window as unknown as { __PW__: Hooks }).__PW__.tile(x as number, y as number) === 0,
      [tx, ty],
    );
    await page.mouse.up();
    await page.waitForFunction(
      () => (window as unknown as { __PW__: Hooks }).__PW__.count('dirt') >= 1,
    );
    await expect(page.getByTestId('pickup-feed')).toContainText('+1');

    // Place it back from the hotbar slot it landed in (slot 4), then mine a second block.
    await page.keyboard.press('Digit4');
    p = screenOf(tx, ty, await snap(page));
    await page.mouse.click(p.x, p.y);
    await page.waitForFunction(
      ([x, y]) =>
        (window as unknown as { __PW__: Hooks }).__PW__.tile(x as number, y as number) !== 0,
      [tx, ty],
    );

    await page.keyboard.press('Digit1');
    const tx2 = tx + 1;
    p = screenOf(tx2, ty, await snap(page));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForFunction(
      ([x, y]) =>
        (window as unknown as { __PW__: Hooks }).__PW__.tile(x as number, y as number) === 0,
      [tx2, ty],
    );
    await page.mouse.up();
    await page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.flush());

    await page.reload();
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('start-button')).toContainText('이어하기');
    await page.getByTestId('start-button').click();
    await page.waitForFunction(
      () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
    );
    expect(await tileAt(page, tx2, ty)).toBe(0);
    expect(await tileAt(page, tx, ty)).not.toBe(0);
    expect(errors).toEqual([]);
  });

  test('chops a tree for wood and crafts planks in the inventory window', async ({ page }) => {
    const s0 = await play(page);
    const sx = Math.floor(s0.x / 16);
    const gy = Math.round(s0.y / 16);
    await chat(page, `/tp ${sx - 12} ${gy}`);
    await page.keyboard.press('Digit2'); // worn axe
    const s = await snap(page);
    let wood = 0;
    for (let dx = -5; dx <= 5 && wood === 0; dx++) {
      const p = screenOf(Math.floor(s.x / 16) + dx, gy - 3, s);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page
        .waitForFunction(
          () => (window as unknown as { __PW__: Hooks }).__PW__.count('wood') > 0,
          null,
          { timeout: 5000 },
        )
        .catch(() => undefined);
      await page.mouse.up();
      wood = await page.evaluate(() =>
        (window as unknown as { __PW__: Hooks }).__PW__.count('wood'),
      );
    }
    expect(wood).toBeGreaterThan(0);

    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('window-inventory')).toBeVisible();
    await page.getByTestId('craft-wood_planks').click();
    await page.waitForFunction(
      () => (window as unknown as { __PW__: Hooks }).__PW__.count('wood_planks') >= 2,
    );
    await test
      .info()
      .attach('inventory', { body: await page.screenshot(), contentType: 'image/png' });
  });
});
