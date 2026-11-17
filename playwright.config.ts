import { defineConfig, devices } from '@playwright/test';

/**
 * Web verification target: the app built for web (React Native Web) and driven in headless Chromium at a
 * phone-sized viewport (Pixel 7 profile). Chromium's fake microphone feeds the WebRTC tests. The pinned
 * @playwright/test version matches the Chromium preinstalled in the cloud image (no browser download needed there).
 * Owned by `web-verify`.
 *
 * What this proves: UI, flows, session logic, signaling and WebRTC negotiation in a browser. It proves NOTHING about
 * Bluetooth routing, Wi-Fi Direct, the foreground service or background behaviour: those need the phones.
 *
 * Environment (all optional):
 *   WEB_PORT=8099         static server port             RELAY_PORT=8787   dev relay port
 *   WEB_DIST=dist         export directory to serve (relative to the repo root unless absolute)
 *   E2E_SKIP_BUILD=1      do not build (fast reruns)     E2E_REBUILD=1     always build
 *   By default the web export is built only when WEB_DIST is missing or older than the sources
 *   (e2e/support/ensure-web-build.mjs); `npm run web:build && npm run e2e` therefore builds once.
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
      // 1. Explicit, skippable build (stale or missing export only); 2. static server with SPA fallback.
      command:
        process.env.E2E_SKIP_BUILD === '1'
          ? 'node scripts/serve-web.mjs'
          : 'node e2e/support/ensure-web-build.mjs && node scripts/serve-web.mjs',
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...(process.env as Record<string, string>), WEB_PORT: String(PORT) },
    },
    {
      // Dev-only WebSocket relay so two browser contexts can play host and guest. `web-verify` owns it.
      command: 'node scripts/dev-relay.mjs',
      port: RELAY_PORT,
      reuseExistingServer: !process.env.CI,
      env: { ...(process.env as Record<string, string>), RELAY_PORT: String(RELAY_PORT) },
    },
  ],
});
