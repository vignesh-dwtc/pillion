import { defineConfig, devices } from '@playwright/test';

/**
 * Web verification target: the app built for web (React Native Web) and driven in headless Chromium at a
 * phone-sized viewport. Chromium's fake microphone feeds the WebRTC tests. The pinned @playwright/test version
 * matches the Chromium preinstalled in the cloud image (no browser download needed there).
 * Owned by `web-verify` (the lead provides this skeleton).
 */
const PORT = Number(process.env.WEB_PORT ?? 8099);
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 8787);

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.artifacts/results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Pixel 7'],
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
    permissions: ['microphone'],
  },
  webServer: [
    {
      // Static export of the web build, served with SPA fallback. `web-verify` owns scripts/serve-web.mjs.
      command: 'node scripts/serve-web.mjs',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { WEB_PORT: String(PORT) },
    },
    {
      // Dev-only WebSocket relay so two browser contexts can play host and guest. `web-verify` owns it.
      command: 'node scripts/dev-relay.mjs',
      port: RELAY_PORT,
      reuseExistingServer: !process.env.CI,
      env: { RELAY_PORT: String(RELAY_PORT) },
    },
  ],
});
