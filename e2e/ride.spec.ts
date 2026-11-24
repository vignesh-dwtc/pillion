import fs from 'node:fs';
import path from 'node:path';

import { devices, expect, test, type Browser, type Page } from '@playwright/test';

import { buildPageBundle } from './support/pageBundle';
import type { ProbeSample, StatsProbe } from './support/statsProbe.page';

/**
 * M1 two-peer ride THROUGH THE REAL UI. Two browser contexts are two phones with Chromium's fake microphone. They pair
 * through the paste path (no camera on web), both tap Begin ride, and the real session controller, secure channel,
 * WebLinkTransport (over scripts/dev-relay.mjs, localhost only) and the browser WebRTC media engine bring the ride up.
 *
 * Asserted: Connected on both ride screens; audio bytes rising in BOTH directions, read through the web MediaEngine's
 * own stats mapping of RTCPeerConnection.getStats() (and cross-checked against the raw counters); host candidates only,
 * no ICE servers; Mute on one phone shows "Mic muted" for the partner on the other; "Drop link" in the dev panel gives
 * Reconnecting and then Connected again with no further input and audio flowing again; hold-to-End on one phone ends
 * the ride on both. The pairing secret never appears on screen or in either console.
 *
 * What this proves: UI, flows, session logic, signaling, secure channel and WebRTC negotiation in a browser. It proves
 * NOTHING about Bluetooth routing, the LAN/NSD transport of the phones, Wi-Fi Direct, the foreground service, screen-off
 * or background behaviour, or the notification buttons: those are device tests (docs/TESTING.md).
 */

const SCREEN_DIR = path.join(__dirname, '.artifacts', 'screens-ride');
const PROBE = buildPageBundle(path.join(__dirname, 'support', 'statsProbe.page.ts'));

interface Phone {
  name: string;
  page: Page;
  console: string[];
  errors: string[];
}

async function openPhone(browser: Browser, baseURL: string | undefined, name: string): Promise<Phone> {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    deviceScaleFactor: 2,
    baseURL,
    permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const phone: Phone = { name, page, console: [], errors: [] };
  page.on('console', (message) => {
    phone.console.push(message.text());
    if (message.type() === 'error') phone.errors.push(message.text());
  });
  page.on('pageerror', (error) => phone.errors.push(error.message));
  await page.addInitScript(PROBE);
  return phone;
}

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200); // entrance animations
  await page.screenshot({ path: path.join(SCREEN_DIR, `${name}.png`) });
}

async function sample(page: Page): Promise<ProbeSample> {
  const result = await page.evaluate(() => (window as unknown as { __probe: StatsProbe }).__probe.sample());
  if (result === null) throw new Error('no open RTCPeerConnection');
  return result;
}

async function rideStates(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __probe: StatsProbe }).__probe.rideStates());
}

/** Both directions of BOTH phones grow over a window of time (engine mapping and raw counters agree). */
async function expectAudioBothWays(a: Phone, b: Phone, when: string): Promise<void> {
  const before = [await sample(a.page), await sample(b.page)];
  await expect
    .poll(
      async () => {
        const now = [await sample(a.page), await sample(b.page)];
        return now.every(
          (s, i) =>
            s.engine.bytesSent > before[i]!.engine.bytesSent + 2_000 &&
            s.engine.bytesReceived > before[i]!.engine.bytesReceived + 2_000 &&
            s.raw.bytesSent > before[i]!.raw.bytesSent &&
            s.raw.bytesReceived > before[i]!.raw.bytesReceived,
        );
      },
      { message: 'audio bytes must rise in both directions on both phones', timeout: 15_000 },
    )
    .toBe(true);
  const after = [await sample(a.page), await sample(b.page)];
  const delta = (i: number) =>
    `sent +${after[i]!.engine.bytesSent - before[i]!.engine.bytesSent} B, received +${after[i]!.engine.bytesReceived - before[i]!.engine.bytesReceived} B`;
  console.log(`[ride] ${when}: ${a.name} ${delta(0)}; ${b.name} ${delta(1)} (web MediaEngine stats)`);
}

async function beginRide(phone: Phone): Promise<void> {
  await phone.page.getByTestId('btn-start').click();
  // The permission primer shows when something still has to be asked; on web the fakes allow it.
  const primer = phone.page.getByTestId('permission-primer');
  const ride = phone.page.getByTestId('screen-ride');
  await expect(primer.or(ride)).toBeVisible();
  if (await primer.isVisible()) await phone.page.getByTestId('btn-primer-allow').click();
  await expect(ride).toBeVisible();
}

/** Slices of the pairing string payload that must never be visible or logged. */
function secretSlices(pairingString: string): string[] {
  const body = pairingString.slice(pairingString.indexOf(':') + 1);
  return [body.slice(0, 16), body.slice(30, 46), body.slice(-16)];
}

test.beforeAll(() => {
  fs.mkdirSync(SCREEN_DIR, { recursive: true });
});

test('two phones pair, ride, mute, survive a dropped link and end together', async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const host = await openPhone(browser, baseURL, 'host');
  const guest = await openPhone(browser, baseURL, 'guest');

  // --- Pair through the paste path ----------------------------------------------------------------------------
  for (const [phone, name] of [
    [host, 'Robin'],
    [guest, 'Sam'],
  ] as const) {
    await phone.page.goto('/settings');
    await phone.page.getByTestId('input-device-name').fill(name);
    await phone.page.getByTestId('input-device-name').blur();
  }
  await host.page.getByTestId('toggle-developer-mode').click();
  await host.page.goto('/pair/host');
  await host.page.getByTestId('btn-copy-pairing').click();
  await expect(host.page.getByTestId('notice-copy')).toBeVisible();
  const pairingString = await host.page.evaluate(() => navigator.clipboard.readText());
  expect(pairingString.length).toBeGreaterThan(60);

  await guest.page.goto('/pair/guest');
  await guest.page.getByTestId('input-pairing-string').fill(pairingString);
  await guest.page.getByTestId('btn-pair-paste').click();
  await expect(guest.page.getByTestId('status-paired')).toContainText('Robin');

  // From here on navigation stays inside the app: a full reload would end the running ride.
  await host.page.goto('/home');
  await guest.page.goto('/home');

  // --- Both tap Begin ride ------------------------------------------------------------------------------------
  await beginRide(host);
  await expect(host.page.getByTestId('ride-state')).not.toHaveText('Connected');
  await shot(host.page, 'ride-host-waiting');
  await beginRide(guest);

  for (const phone of [host, guest]) {
    await expect(phone.page.getByTestId('ride-state'), `${phone.name} connects`).toHaveText('Connected', {
      timeout: 30_000,
    });
  }
  await expect(host.page.getByTestId('ride-partner-name')).toContainText('Sam');
  await expect(guest.page.getByTestId('ride-partner-name')).toContainText('Robin');

  // --- Audio both ways, host candidates only, no ICE servers --------------------------------------------------
  await expectAudioBothWays(host, guest, 'after connect');
  for (const phone of [host, guest]) {
    const s = await sample(phone.page);
    expect(s.engine.connectionState).toBe('connected');
    expect(s.engine.codec ?? '').toMatch(/^opus\//);
    expect(s.engine.iceServers, 'no ICE servers').toBe(0);
    expect(s.engine.selectedPair ?? '', 'host candidates on both ends').toMatch(/^host\/udp -> host\/udp$/);
  }
  await shot(host.page, 'ride-host-connected');
  await shot(guest.page, 'ride-guest-connected');

  // --- Mute on the host: the guest sees it, the host stops sending audio -----------------------------------------
  await host.page.getByTestId('btn-mute').click();
  await expect(host.page.getByTestId('btn-mute')).toHaveAttribute('aria-checked', 'true');
  await expect(guest.page.getByTestId('status-partner')).toContainText('Mic muted');
  await shot(guest.page, 'ride-guest-partner-muted');
  await shot(host.page, 'ride-host-muted');
  await host.page.getByTestId('btn-mute').click();
  await expect(guest.page.getByTestId('status-partner')).toContainText('Mic live');

  // --- Drop the link from the dev panel: Reconnecting, then Connected again on its own ---------------------------
  const before = (await rideStates(host.page)).length;
  await host.page.getByTestId('devpanel-toggle').click();
  await host.page.getByTestId('devpanel-drop-link').click();
  await host.page.getByTestId('devpanel-close').click();
  for (const phone of [host, guest]) {
    await expect
      .poll(async () => (await rideStates(phone.page)).slice(phone === host ? before : 0).join(' > '), {
        message: `${phone.name}: Reconnecting, then Connected`,
        timeout: 30_000,
      })
      .toMatch(/Reconnecting( > [^>]+)* > Connected$/);
    await expect(phone.page.getByTestId('ride-state')).toHaveText('Connected');
    console.log(`[ride] ${phone.name} states: ${(await rideStates(phone.page)).join(' > ')}`);
  }
  await shot(host.page, 'ride-host-recovered');
  await expectAudioBothWays(host, guest, 'after dropped link');

  // --- Hold the link down (dev panel "Block link", then "Drop link"): the ride stays in Reconnecting and retries,
  //     the ride clock keeps running; unblocking brings it back without touching the ride screen. ------------------
  await host.page.getByTestId('devpanel-toggle').click();
  await host.page.getByTestId('devpanel-block-link').click();
  await host.page.getByTestId('devpanel-drop-link').click();
  await host.page.getByTestId('devpanel-close').click();
  for (const phone of [host, guest]) {
    await expect(phone.page.getByTestId('ride-state')).toHaveText('Reconnecting');
  }
  await expect(host.page.getByTestId('status-link')).toContainText(/Retrying/);
  await shot(host.page, 'ride-host-reconnecting');
  await host.page.getByTestId('devpanel-toggle').click();
  await host.page.getByTestId('devpanel-block-link').click();
  await host.page.getByTestId('devpanel-close').click();
  for (const phone of [host, guest]) {
    await expect(phone.page.getByTestId('ride-state')).toHaveText('Connected', { timeout: 30_000 });
  }
  await expectAudioBothWays(host, guest, 'after held link');

  // --- Hold-to-End on the guest ends the ride on both phones ------------------------------------------------------
  const end = guest.page.getByTestId('btn-end');
  const box = await end.boundingBox();
  if (box === null) throw new Error('End button not on screen');
  await guest.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await guest.page.mouse.down();
  await guest.page.waitForTimeout(1_600); // the hold is one second
  await guest.page.mouse.up();

  for (const phone of [host, guest]) {
    await expect(phone.page.getByTestId('btn-end'), `${phone.name}: ride over`).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect
      .poll(
        () =>
          phone.page.evaluate(() =>
            (window as unknown as { __probe: StatsProbe }).__probe.sample().then((s) => s?.open ?? 0),
          ),
        { message: `${phone.name}: peer connection closed` },
      )
      .toBe(0);
  }
  await expect(host.page.getByTestId('ride-state')).toHaveText('Ride ended');
  await expect(host.page.getByTestId('ride-notice')).toContainText(/partner/i);
  await shot(host.page, 'ride-host-partner-ended');
  await shot(guest.page, 'ride-guest-ended');

  // --- Hygiene ---------------------------------------------------------------------------------------------------
  for (const phone of [host, guest]) {
    const seen = `${await phone.page.evaluate(() => document.body.innerText)}\n${phone.console.join('\n')}`;
    for (const slice of secretSlices(pairingString)) {
      expect(seen.includes(slice), `${phone.name}: pairing secret on screen or in console`).toBe(false);
    }
    expect(phone.errors, `${phone.name}: console errors / page errors`).toEqual([]);
  }
});
