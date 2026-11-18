import { expect, type Page, test } from '@playwright/test';

interface Snapshot {
  mode: string;
  x: number;
  y: number;
  zoom: number;
  camera: { left: number; top: number };
  hp: number;
  mp: number;
  level: number;
  exp: number;
  jobId: string;
  alive: boolean;
  monsters: number;
  monsterSprites: number;
}

interface MonsterInfo {
  id: number;
  def: string;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
}

interface Hooks {
  snapshot(): Snapshot;
  count(itemId: string): number;
  monsters(): MonsterInfo[];
  summon(id: string): boolean;
}

const snap = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.snapshot());
const monsters = (page: Page): Promise<MonsterInfo[]> =>
  page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.monsters());
const summon = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((m) => (window as unknown as { __PW__: Hooks }).__PW__.summon(m), id);

async function play(page: Page): Promise<Snapshot> {
  await page.goto('/');
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('start-button').click();
  await page.waitForFunction(
    () => (window as unknown as { __PW__?: Hooks }).__PW__?.snapshot?.()?.mode === 'playing',
  );
  return snap(page);
}

async function chat(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('chat-input')).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

function screenOf(x: number, y: number, s: Snapshot): { x: number; y: number } {
  return { x: (x - s.camera.left) * s.zoom, y: (y - s.camera.top) * s.zoom };
}

/** Keep the cursor on the nearest monster and attack until `done` or the deadline. */
async function fight(
  page: Page,
  attack: () => Promise<void>,
  done: () => Promise<boolean>,
  ms = 45_000,
): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !(await done())) {
    const s = await snap(page);
    const alive = (await monsters(page)).filter((m) => m.alive);
    const m = alive.sort((a, b) => Math.abs(a.x - s.x) - Math.abs(b.x - s.x))[0];
    if (!m) break;
    const p = screenOf(m.x, m.y - 6, s);
    await page.mouse.move(p.x, p.y);
    if (Math.abs(m.x - s.x) > 28) {
      const key = m.x > s.x ? 'KeyD' : 'KeyA';
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
    await attack();
  }
}

test.describe('PROJECT WORLD — PHASE 3 combat & RPG', () => {
  test('kills a monster with the starter sword for experience, with sprites and HUD', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await play(page);
    await chat(page, '/peace');
    await expect(page.getByTestId('skillbar')).toBeVisible();
    await page.keyboard.press('Digit3'); // training sword
    expect(await summon(page, 'dew_slime')).toBe(true);
    await expect.poll(async () => (await snap(page)).monsterSprites).toBe(1);
    await fight(
      page,
      async () => {
        await page.mouse.down();
        await page.waitForTimeout(120);
        await page.mouse.up();
      },
      async () => (await snap(page)).monsters === 0,
    );
    await expect.poll(async () => (await snap(page)).exp).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('levels up, advances to mage, learns and casts a skill, equips armor', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await play(page);
    await chat(page, '/peace');
    await chat(page, '/level 10');
    await expect(page.getByTestId('levelup-banner')).toBeVisible();
    expect((await snap(page)).level).toBe(10);

    // Job advancement through the character window.
    await page.keyboard.press('KeyC');
    await page.getByTestId('open-job').click();
    await page.getByTestId('job-mage').click();
    await page.getByTestId('job-confirm').click();
    await expect.poll(async () => (await snap(page)).jobId).toBe('mage');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __PW__: Hooks }).__PW__.count('ember_staff')),
      )
      .toBe(1);
    await page.getByTestId('auto-stats').click();
    await expect(page.getByTestId('stat-points')).toHaveText('0');
    await page.keyboard.press('Escape');

    // Learn Arcane Bolt and put it on Q.
    await page.keyboard.press('KeyK');
    await page.getByTestId('learn-mage_arcane_bolt').click();
    await page.getByTestId('assign-mage_arcane_bolt-0').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('window-skills')).toHaveCount(0);

    // Cast it at a slime (the skill swaps to the staff automatically).
    expect(await summon(page, 'dew_slime')).toBe(true);
    await fight(
      page,
      async () => {
        await page.keyboard.press('KeyQ');
        await page.waitForTimeout(250);
      },
      async () => (await snap(page)).monsters === 0,
    );
    expect((await snap(page)).monsters).toBe(0);
    // Only the skill path swaps weapons: the staff is now the held item.
    const held = await page.evaluate(() => {
      const inv = (
        window as unknown as {
          __PW__: {
            stores: {
              inventory: { get(): { slots: ({ itemId: string } | null)[]; selected: number } };
            };
          };
        }
      ).__PW__.stores.inventory.get();
      return inv.slots[inv.selected]?.itemId;
    });
    expect(held).toBe('ember_staff');

    // Armor: give, right-click to equip from the inventory.
    await chat(page, '/give traveler_coat 1');
    await page.keyboard.press('KeyI');
    await expect(page.getByTestId('window-inventory')).toBeVisible();
    const slots = await page.evaluate(
      () =>
        (
          window as unknown as {
            __PW__: { stores: { inventory: { get(): { slots: ({ itemId: string } | null)[] } } } };
          }
        ).__PW__.stores.inventory.get().slots,
    );
    const idx = slots.findIndex((s) => s?.itemId === 'traveler_coat');
    expect(idx).toBeGreaterThanOrEqual(0);
    await page.getByTestId(`inv-slot-${idx}`).click({ button: 'right' });
    await expect(page.getByTestId('equip-body').locator('img')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
