import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke test: every screen opens by deep link at the Pixel 7 profile, renders its root test id, logs no console
 * errors or page errors, does not overflow horizontally, and leaves a screenshot in e2e/.artifacts/screens/.
 *
 * Web proves the UI renders and routes. It proves nothing about Bluetooth, Wi-Fi Direct, the foreground service or
 * background behaviour.
 */

/** The agreed routes (src/app/routes.ts) and the testID of each screen root (React Native Web: data-testid). */
const SCREENS = [
  { route: '/onboarding', testId: 'screen-onboarding' },
  { route: '/home', testId: 'screen-home' },
  { route: '/pair/host', testId: 'screen-pair-host' },
  { route: '/pair/guest', testId: 'screen-pair-guest' },
  { route: '/ride', testId: 'screen-ride' },
  { route: '/settings', testId: 'screen-settings' },
  { route: '/diagnostics', testId: 'screen-diagnostics' },
  { route: '/debug', testId: 'screen-debug' },
] as const;

const SCREENSHOT_DIR = path.join(__dirname, '.artifacts', 'screens');

const screenshotName = (route: string) => route.replace(/^\//, '').replace(/\//g, '-');

/** Collects console errors and uncaught page errors for the lifetime of a page. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const where = message.location().url;
      errors.push(`console.error: ${message.text()}${where ? ` (${where})` : ''}`);
    }
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Horizontal overflow of the page and of the screen root, in CSS px (<= 0 means none). */
async function horizontalOverflow(page: Page, testId: string) {
  return page.evaluate((id) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return {
      viewportWidth: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: document.body.scrollWidth - window.innerWidth,
      rootOverflow: root ? root.scrollWidth - root.clientWidth : 0,
    };
  }, testId);
}

/** Text leaves and controls of the screen that the collapsed dev tab would cover (it must sit in the screen margin). */
async function contentCoveredByDevTab(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const tab = document.querySelector('[data-testid="devpanel-toggle"]')?.getBoundingClientRect();
    if (!tab) return [];
    const covered: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('[data-testid^="screen-"] *')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const overlaps =
        box.left < tab.right && box.right > tab.left && box.top < tab.bottom && box.bottom > tab.top;
      if (!overlaps) continue;
      const text = (element.textContent ?? '').trim();
      const isTextLeaf = element.children.length === 0 && text !== '';
      const isControl = element.matches(
        'button, a, input, textarea, select, [role="button"], [role="link"], [tabindex]',
      );
      if (isTextLeaf || isControl) covered.push(`${element.tagName.toLowerCase()} "${text.slice(0, 30)}"`);
    }
    return covered;
  });
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test.describe('smoke: every screen opens by deep link', () => {
  for (const { route, testId } of SCREENS) {
    test(`${route} renders ${testId}`, async ({ page }) => {
      const errors = trackErrors(page);

      await page.goto(route);
      await expect(page.getByTestId(testId)).toBeVisible();
      // Fonts and icons settle before the screenshot; the network is quiet once the bundle has loaded.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');

      const overflow = await horizontalOverflow(page, testId);
      expect(
        overflow.documentOverflow,
        `page is wider than the ${overflow.viewportWidth}px viewport`,
      ).toBeLessThanOrEqual(0);
      expect(overflow.bodyOverflow, 'body is wider than the viewport').toBeLessThanOrEqual(0);
      expect(overflow.rootOverflow, `${testId} content is wider than the screen root`).toBeLessThanOrEqual(0);

      expect(await contentCoveredByDevTab(page), 'the collapsed dev tab must not cover app content').toEqual(
        [],
      );

      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${screenshotName(route)}.png`) });

      expect(errors, 'console errors / page errors').toEqual([]);
    });
  }

  test('the error tracker really sees console errors and page errors (not a vacuous pass)', async ({
    page,
  }) => {
    const errors = trackErrors(page);
    await page.goto('/home');
    await expect(page.getByTestId('screen-home')).toBeVisible();
    await page.evaluate(() => {
      console.error('probe: console error');
      setTimeout(() => {
        throw new Error('probe: page error');
      }, 0);
    });
    await expect.poll(() => errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.join('\n')).toContain('probe: console error');
    expect(errors.join('\n')).toContain('probe: page error');
  });
});

test.describe('smoke: web-only dev panel', () => {
  test('is collapsed by default and opens with its controls (headset, call, link drop)', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/home');
    await expect(page.getByTestId('screen-home')).toBeVisible();

    await expect(page.getByTestId('devpanel')).toHaveCount(0);
    await page.getByTestId('devpanel-toggle').click();
    const panel = page.getByTestId('devpanel');
    await expect(panel).toBeVisible();
    for (const id of ['devpanel-headset', 'devpanel-call', 'devpanel-drop-link', 'devpanel-block-link']) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }

    // The controls change the pretend world and the panel shows it.
    await expect(page.getByTestId('devpanel-headset-state')).toHaveText('connected');
    await page.getByTestId('devpanel-headset').click();
    await expect(page.getByTestId('devpanel-headset-state')).toHaveText('disconnected');
    await page.getByTestId('devpanel-call').click();
    await expect(page.getByTestId('devpanel-call-state')).toHaveText('active');
    await page.getByTestId('devpanel-block-link').click();
    await expect(page.getByTestId('devpanel-link-state')).toHaveText('blocked');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'devpanel-open.png') });

    // It can be moved to the top so it does not hide the controls at the bottom of a screen.
    const bottomEdge = async () => (await page.getByTestId('devpanel').boundingBox())!.y;
    const yAtBottom = await bottomEdge();
    await page.getByTestId('devpanel-move').click();
    expect(await bottomEdge()).toBeLessThan(yAtBottom);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'devpanel-open-top.png') });

    await page.getByTestId('devpanel-close').click();
    await expect(page.getByTestId('devpanel')).toHaveCount(0);
    expect(errors, 'console errors / page errors').toEqual([]);
  });

  test('exposes the typed controls to tests as window.__devControls', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByTestId('screen-home')).toBeVisible();
    const state = await page.evaluate(() => {
      const controls = (
        window as unknown as {
          __devControls: { setHeadsetConnected(c: boolean): void; getState(): { headsetConnected: boolean } };
        }
      ).__devControls;
      controls.setHeadsetConnected(false);
      return controls.getState().headsetConnected;
    });
    expect(state).toBe(false);
  });
});
