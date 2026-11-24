import fs from 'node:fs';
import path from 'node:path';

import { devices, expect, test, type Browser, type Locator, type Page } from '@playwright/test';

/** The pairing QR encodes the pairing secret: it is painted over in every screenshot (never a secret in artifacts). */
function noSecrets(page: Page): { mask: Locator[]; maskColor: string } {
  return { mask: [page.getByTestId('qr-code')], maskColor: '#7f7f7f' };
}

/**
 * Real pairing through the UI, two browser contexts = two phones. Context A (host) turns on developer mode, opens
 * /pair/host, which generates and saves a real pairing offer, and copies the pairing string; context B (guest) pastes
 * it on /pair/guest (the web build has no camera, so the paste field is the only path there). Both Home screens then
 * show the partner, a reload keeps it, and Settings can forget it.
 *
 * The pairing string carries the secret: the test asserts that no part of it is visible on either page or written to
 * either console. Proves: generate/save/reuse, encode -> decode -> validate -> save, the store hydration and the
 * screens. Proves nothing about the camera, the permission prompt or the Android Keystore (device tests).
 */

const SCREEN_DIR = path.join(__dirname, '.artifacts', 'screens-pairing');

interface Phone {
  page: Page;
  console: string[];
  errors: string[];
}

async function openPhone(browser: Browser, baseURL: string | undefined): Promise<Phone> {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    deviceScaleFactor: 2,
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const phone: Phone = { page, console: [], errors: [] };
  page.on('console', (message) => {
    phone.console.push(message.text());
    if (message.type() === 'error') phone.errors.push(message.text());
  });
  page.on('pageerror', (error) => phone.errors.push(error.message));
  return phone;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

/** Entrance animations (stagger, dial link-up) finish within about a second. */
const ANIMATIONS_SETTLED_MS = 1500;

/** Top of the screen, then (when it scrolls) the bottom, as `<name>.png` and `<name>-end.png`. */
async function shot(page: Page, name: string): Promise<void> {
  await settle(page);
  await page.waitForTimeout(ANIMATIONS_SETTLED_MS);
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`), ...noSecrets(page) });
  const scrolled = await page.evaluate(() => {
    let moved = false;
    for (const element of document.querySelectorAll<HTMLElement>('[data-testid^="screen-"] *')) {
      if (
        element.scrollHeight > element.clientHeight + 4 &&
        getComputedStyle(element).overflowY !== 'visible'
      ) {
        element.scrollTop = element.scrollHeight;
        moved = true;
      }
    }
    return moved;
  });
  if (scrolled) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SCREEN_DIR, `${name}-end.png`), ...noSecrets(page) });
  }
}

async function setName(page: Page, name: string): Promise<void> {
  await page.goto('/settings');
  await page.getByTestId('input-device-name').fill(name);
  await page.getByTestId('input-device-name').blur();
}

/** Text a person or a screen reader can see: visible text, accessible names and every form value. */
async function everythingOnScreen(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts = [document.body.innerText];
    for (const element of document.querySelectorAll('[aria-label]')) {
      parts.push(element.getAttribute('aria-label') ?? '');
    }
    for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input, textarea',
    )) {
      if (input.type !== 'password') parts.push(input.value);
    }
    return parts.join('\n');
  });
}

/** Distinctive slices of the encoded payload (everything after `<prefix><version>:`). */
function secretSlices(pairingString: string): string[] {
  const body = pairingString.slice(pairingString.indexOf(':') + 1);
  return [body, body.slice(0, 16), body.slice(30, 46), body.slice(-16)];
}

function expectNoSecret(haystack: string, pairingString: string, where: string): void {
  for (const slice of secretSlices(pairingString)) {
    expect(haystack.includes(slice), `${where} must not contain the pairing secret`).toBe(false);
  }
}

test.beforeAll(() => {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
});

test('host shows a real code, guest pastes it, both Home screens show the partner', async ({
  browser,
  baseURL,
}) => {
  const host = await openPhone(browser, baseURL);
  const guest = await openPhone(browser, baseURL);

  // Host: name, developer mode, then the pairing plate.
  await setName(host.page, 'Robin');
  await host.page.getByTestId('toggle-developer-mode').click();
  await host.page.goto('/pair/host');
  await expect(host.page.getByTestId('qr-code')).toBeVisible();
  await expect(host.page.getByTestId('status-sample-code')).toHaveCount(0);
  await expect(host.page.getByTestId('btn-host-name')).toContainText('Robin');
  await shot(host.page, 'host-plate-dev');

  await host.page.getByTestId('btn-copy-pairing').click();
  await expect(host.page.getByTestId('notice-copy')).toBeVisible();
  const pairingString = await host.page.evaluate(() => navigator.clipboard.readText());
  expect(pairingString).toMatch(/^[a-z]+\d+:[A-Za-z0-9_-]{60,}$/);
  expectNoSecret(await everythingOnScreen(host.page), pairingString, 'host screen');

  // Reopening the host screen reuses the same unused offer.
  await host.page.goto('/pair/host');
  await host.page.getByTestId('btn-copy-pairing').click();
  await expect(host.page.getByTestId('notice-copy')).toBeVisible();
  expect(await host.page.evaluate(() => navigator.clipboard.readText())).toBe(pairingString);

  // Guest (developer mode off): the web build has no camera, so the paste field is shown anyway.
  await setName(guest.page, 'Sam');
  await guest.page.goto('/pair/guest');
  await expect(guest.page.getByTestId('card-paste-pairing')).toBeVisible();
  await shot(guest.page, 'guest-web');

  // A foreign code is rejected with a friendly message and nothing is saved.
  await guest.page.getByTestId('input-pairing-string').fill('https://example.com/not-a-plate');
  await guest.page.getByTestId('btn-pair-paste').click();
  await expect(guest.page.getByTestId('notice-paste')).toContainText('not a pairing plate');
  await shot(guest.page, 'guest-invalid');

  await guest.page.getByTestId('input-pairing-string').fill(pairingString);
  await expectNoSecretOnScreen(guest.page, pairingString);
  await guest.page.getByTestId('btn-pair-paste').click();
  await expect(guest.page.getByTestId('status-paired')).toContainText('Paired with Robin');
  await shot(guest.page, 'guest-paired');
  expectNoSecret(await everythingOnScreen(guest.page), pairingString, 'guest success screen');

  // Back to Home (the button; the screen would also return on its own).
  await guest.page.getByTestId('btn-pair-home').click();
  await expect(guest.page.getByTestId('screen-home')).toBeVisible();
  await expect(guest.page.getByTestId('home-partner-name')).toHaveText('Robin');
  await expect(guest.page.getByTestId('home-partner-detail')).toContainText('guest');
  await shot(guest.page, 'home-guest');

  // Host Home: the pairing is there; the guest's name arrives on the first connection.
  await host.page.goto('/home');
  await expect(host.page.getByTestId('home-partner')).toBeVisible();
  await expect(host.page.getByTestId('home-partner-detail')).toContainText('host');
  await shot(host.page, 'home-host');

  // A restart keeps the pairing (the store is hydrated from the repository).
  await guest.page.reload();
  await expect(guest.page.getByTestId('home-partner-name')).toHaveText('Robin');

  // Scanning the same plate again is harmless.
  await guest.page.goto('/pair/guest');
  await guest.page.getByTestId('input-pairing-string').fill(pairingString);
  await guest.page.getByTestId('btn-pair-paste').click();
  await expect(guest.page.getByTestId('status-paired')).toContainText('already paired');

  // The host cannot pair with its own code.
  await host.page.goto('/pair/guest');
  await host.page.getByTestId('input-pairing-string').fill(pairingString);
  await host.page.getByTestId('btn-pair-paste').click();
  await expect(host.page.getByTestId('notice-paste')).toContainText('own plate');

  // Settings lists the pairing; forgetting needs a confirming second tap.
  await guest.page.goto('/settings');
  const forget = guest.page.locator('[data-testid^="btn-forget-"]');
  await expect(forget).toHaveCount(1);
  await shot(guest.page, 'settings-paired');
  await forget.click();
  await expect(forget).toContainText('Tap again');
  await forget.click();
  await expect(guest.page.getByTestId('card-partners')).toContainText('No partner paired yet');
  await guest.page.goto('/home');
  await expect(guest.page.getByTestId('home-partner')).toHaveCount(0);

  // "New code" on the host replaces the unused offer with a different secret.
  await host.page.goto('/pair/host');
  await host.page.getByTestId('btn-new-code').click();
  await expect(host.page.getByTestId('notice-new-code')).toBeVisible();
  await host.page.getByTestId('btn-copy-pairing').click();
  await expect(host.page.getByTestId('notice-copy')).toBeVisible();
  const fresh = await host.page.evaluate(() => navigator.clipboard.readText());
  expect(fresh).not.toBe(pairingString);
  await shot(host.page, 'host-new-code');

  for (const [name, phone] of [
    ['host', host],
    ['guest', guest],
  ] as const) {
    expectNoSecret(phone.console.join('\n'), pairingString, `${name} console`);
    expectNoSecret(phone.console.join('\n'), fresh, `${name} console`);
    expect(phone.errors, `${name}: console errors / page errors`).toEqual([]);
  }
});

test('host screen without developer mode offers no copy and shows no secret', async ({
  browser,
  baseURL,
}) => {
  const phone = await openPhone(browser, baseURL);
  await phone.page.goto('/pair/host');
  await expect(phone.page.getByTestId('qr-code')).toBeVisible();
  await expect(phone.page.getByTestId('btn-copy-pairing')).toHaveCount(0);
  await shot(phone.page, 'host-plate');
  // Read the saved offer straight from the dev-only web store to know what must not appear.
  const pairingSecret = await phone.page.evaluate(() => {
    const raw = localStorage.getItem('insecure-dev-store.pairing.records.v1') ?? '[]';
    return (JSON.parse(raw) as { secret: string }[])[0]?.secret ?? '';
  });
  expect(pairingSecret.length).toBeGreaterThan(20);
  const visible = await everythingOnScreen(phone.page);
  expect(visible.includes(pairingSecret)).toBe(false);
  expect(phone.console.join('\n').includes(pairingSecret)).toBe(false);
  expect(phone.errors).toEqual([]);
});

async function expectNoSecretOnScreen(page: Page, pairingString: string): Promise<void> {
  // The paste field is masked: the pasted string is not readable on screen.
  await expect(page.getByTestId('input-pairing-string')).toHaveAttribute('type', 'password');
  expectNoSecret(await everythingOnScreen(page), pairingString, 'guest screen after paste');
}
