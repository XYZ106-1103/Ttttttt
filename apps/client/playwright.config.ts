import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke tests against the production build.
 * Headless Chromium renders WebGL in software (SwiftShader), so tests poll game state with
 * generous timeouts instead of assuming real-time frame rates.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1920, height: 1080 },
    trace: 'off',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm build && pnpm preview --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // The game server for online play (in-memory storage: every run starts empty). The preview
      // server proxies /api and /ws to it.
      command: 'pnpm --filter @world/server exec tsx src/main.ts',
      url: 'http://127.0.0.1:8787/api/health',
      env: { PORT: '8787', HOST: '127.0.0.1', DATABASE_URL: '' },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
