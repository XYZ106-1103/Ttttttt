import { expect, type Page, test } from '@playwright/test';

interface AudioStats {
  state: string;
  played: number;
  theme: string | null;
  recent: string[];
}
type Win = {
  __PW__: {
    audio(): AudioStats;
    snapshot(): { mode: string };
    stores: { settings: { get(): { musicVolume: number } } };
  };
};

const audio = (page: Page): Promise<AudioStats> =>
  page.evaluate(() => (window as unknown as Win).__PW__.audio());

test.describe('PROJECT WORLD — sound', () => {
  test('music follows the game and actions make sounds', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 60_000 });
    // Audio starts with the first click (browser autoplay rules): the title theme.
    await page.getByTestId('start-button').click();
    await expect.poll(async () => (await audio(page)).state).toBe('running');
    await page.waitForFunction(
      () => (window as unknown as Win).__PW__.snapshot()?.mode === 'playing',
    );
    // The spawn is the village (daytime start): its theme replaces the title music.
    await expect.poll(async () => (await audio(page)).theme).toBe('town');
    const before = (await audio(page)).played;
    await page.keyboard.down('d');
    await page.waitForTimeout(700);
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    await page.keyboard.up('d');
    await expect.poll(async () => (await audio(page)).recent).toContain('jump');
    await page.keyboard.press('i');
    await expect.poll(async () => (await audio(page)).recent).toContain('ui_open');
    expect((await audio(page)).played).toBeGreaterThan(before);
    await page.keyboard.press('Escape');

    // Volume sliders in the settings window.
    await page.keyboard.press('Escape');
    await page.getByText('설정').first().click();
    const slider = page.getByTestId('setting-musicVolume');
    await expect(slider).toBeVisible();
    await slider.fill('20');
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as Win).__PW__.stores.settings.get().musicVolume),
      )
      .toBeCloseTo(0.2);
  });
});
