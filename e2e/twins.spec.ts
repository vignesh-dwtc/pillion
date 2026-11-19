import path from 'node:path';

import { devices, expect, test, type Browser, type Page } from '@playwright/test';

import { buildPageBundle } from './support/pageBundle';
import type { PeerDriver, PeerSnapshot } from './support/peerDriver.page';

/**
 * The web twins in REAL Chromium, before and independently of the app UI: `createLinkTransport()` (WebLinkTransport
 * over scripts/dev-relay.mjs) and `createMediaEngine()` (the browser's own WebRTC) driven by a throwaway signaling
 * peer (e2e/support/peerDriver.page.ts, bundled from the real source files). Two browser contexts play host and guest
 * with Chromium's fake microphone.
 *
 * Proves: link pairing and close reasons through the relay, real offer/answer/ICE with host candidates only and no ICE
 * servers, Opus audio bytes in BOTH directions (asserted from RTCPeerConnection.getStats(), independently of the
 * twin's own stats mapping), mute, a dropped link and renegotiation. It proves nothing about Bluetooth routing,
 * Wi-Fi Direct, the foreground service or background behaviour, and it does not exercise the secure channel or the
 * session state machine (the full two-peer test does that once the session exists).
 */

const BUNDLE = buildPageBundle(path.join(__dirname, 'support', 'peerDriver.page.ts'));

/** Keeps every RTCPeerConnection the page creates, so tests can read raw getStats() without touching app code. */
const TRACK_PEER_CONNECTIONS = `(() => {
  const Original = window.RTCPeerConnection;
  window.__pcs = [];
  window.RTCPeerConnection = class extends Original {
    constructor(...args) { super(...args); window.__pcs.push(this); }
  };
})();`;

/** Metro inlines process.env.EXPO_PUBLIC_*; a bare page needs a shim for the twin's relay URL lookup. */
const PROCESS_SHIM = 'window.process = { env: {} };';

interface Peer {
  name: string;
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
}

async function openPeer(browser: Browser, baseURL: string, name: string): Promise<Peer> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL, permissions: ['microphone'] });
  const page = await context.newPage();
  const peer: Peer = { name, page, pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (error) => peer.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') peer.consoleErrors.push(message.text());
  });
  await page.addInitScript(PROCESS_SHIM);
  await page.addInitScript(TRACK_PEER_CONNECTIONS);
  // A blank document served by scripts/serve-web.mjs: a local, secure origin (getUserMedia, localhost WebSocket) without
  // the app UI. A document made up with route.fulfill() is not treated as local and its WebSocket would be blocked.
  await page.goto('/__blank');
  await page.addScriptTag({ content: BUNDLE });
  await page.waitForFunction(() => '__peer' in window);
  return peer;
}

/** Calls a method of the in-page PeerDriver. */
async function drive<K extends keyof PeerDriver>(
  peer: Peer,
  method: K,
  ...args: Parameters<PeerDriver[K]>
): Promise<Awaited<ReturnType<PeerDriver[K]>>> {
  return peer.page.evaluate(
    ([name, parameters]) =>
      (window as unknown as { __peer: Record<string, (...a: unknown[]) => unknown> }).__peer[name as string]!(
        ...(parameters as unknown[]),
      ),
    [method, args] as const,
  ) as Promise<Awaited<ReturnType<PeerDriver[K]>>>;
}

const snapshot = (peer: Peer): Promise<PeerSnapshot> => drive(peer, 'snapshot');

const uniquePairId = () => `twin${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function connect(host: Peer, guest: Peer, pairId: string): Promise<void> {
  // Host first (it registers with the relay and waits); the guest retries until it finds the host.
  await Promise.all([drive(host, 'openLink', 'host', pairId), drive(guest, 'openLink', 'guest', pairId)]);
  await drive(host, 'offer');
  await Promise.all([drive(host, 'waitForConnected'), drive(guest, 'waitForConnected')]);
}

/** Both directions: bytes sent by each side rise, and bytes received by each side rise (raw RTCPeerConnection stats). */
async function expectAudioBytesBothWays(host: Peer, guest: Peer, label: string): Promise<void> {
  const base = { host: await snapshot(host), guest: await snapshot(guest) };
  const grew = async (peer: Peer, field: 'bytesSent' | 'bytesReceived', from: PeerSnapshot) =>
    (await snapshot(peer)).raw[field] - from.raw[field];

  await expect
    .poll(() => grew(host, 'bytesSent', base.host), {
      message: `${label}: host sends audio`,
      timeout: 15_000,
    })
    .toBeGreaterThan(1_000);
  await expect
    .poll(() => grew(guest, 'bytesReceived', base.guest), {
      message: `${label}: guest receives audio`,
      timeout: 15_000,
    })
    .toBeGreaterThan(1_000);
  await expect
    .poll(() => grew(guest, 'bytesSent', base.guest), {
      message: `${label}: guest sends audio`,
      timeout: 15_000,
    })
    .toBeGreaterThan(1_000);
  await expect
    .poll(() => grew(host, 'bytesReceived', base.host), {
      message: `${label}: host receives audio`,
      timeout: 15_000,
    })
    .toBeGreaterThan(1_000);

  const [hostNow, guestNow] = [await snapshot(host), await snapshot(guest)];
  // What one side sent is what the other received (the counters are independent: outbound-rtp vs inbound-rtp).
  const closeEnough = (sent: number, received: number) =>
    Math.abs(sent - received) <= 0.25 * Math.max(sent, received) + 300;
  expect(
    closeEnough(
      hostNow.raw.bytesSent - base.host.raw.bytesSent,
      guestNow.raw.bytesReceived - base.guest.raw.bytesReceived,
    ),
    `${label}: what the host sent is what the guest received`,
  ).toBe(true);
  expect(
    closeEnough(
      guestNow.raw.bytesSent - base.guest.raw.bytesSent,
      hostNow.raw.bytesReceived - base.host.raw.bytesReceived,
    ),
    `${label}: what the guest sent is what the host received`,
  ).toBe(true);
  console.log(
    `[twins] ${label}: host sent +${hostNow.raw.bytesSent - base.host.raw.bytesSent} B and received +${
      hostNow.raw.bytesReceived - base.host.raw.bytesReceived
    } B, guest sent +${guestNow.raw.bytesSent - base.guest.raw.bytesSent} B and received +${
      guestNow.raw.bytesReceived - base.guest.raw.bytesReceived
    } B (Opus payload, RTCPeerConnection.getStats)`,
  );
}

/** `muter` mutes its microphone; `listener` must then measure no audio energy, and hear audio again after unmute. */
async function expectMuteSilencesPartner(muter: Peer, listener: Peer): Promise<void> {
  await drive(muter, 'setMuted', true);
  await sleep(1_500); // let sound already in flight and in the jitter buffer drain
  const from = await snapshot(listener);
  await sleep(3_000);
  const to = await snapshot(listener);
  expect(to.state).toBe('connected');
  expect(
    to.raw.bytesReceived,
    `${muter.name} muted: silence is still sent, the connection stays up`,
  ).toBeGreaterThan(from.raw.bytesReceived);
  const mutedEnergy = to.raw.totalAudioEnergy - from.raw.totalAudioEnergy;
  expect(
    mutedEnergy,
    `no audio energy reaches the ${listener.name} while the ${muter.name} is muted`,
  ).toBeLessThan(1e-6);

  await drive(muter, 'setMuted', false);
  const unmutedFrom = to.raw.totalAudioEnergy;
  await expect
    .poll(async () => (await snapshot(listener)).raw.totalAudioEnergy - unmutedFrom, {
      message: `the ${listener.name} hears the ${muter.name} again after unmute`,
      timeout: 15_000,
    })
    .toBeGreaterThan(1e-4);
  const unmutedEnergy = (await snapshot(listener)).raw.totalAudioEnergy - unmutedFrom;
  console.log(
    `[twins] mute (${muter.name}): audio energy measured by the ${listener.name} while muted +${mutedEnergy.toExponential(2)}, after unmute +${unmutedEnergy.toExponential(2)}`,
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test.describe('web twins in real Chromium (fake microphone, dev relay)', () => {
  test('host and guest: negotiate, audio flows both ways, mute, link drop, renegotiate, end', async ({
    browser,
    baseURL,
  }) => {
    const pairId = uniquePairId();
    const host = await openPeer(browser, baseURL!, 'host');
    const guest = await openPeer(browser, baseURL!, 'guest');
    try {
      // 1. Link through the relay, then a real offer/answer with trickled ICE (host candidates, no ICE servers).
      await connect(host, guest, pairId);
      const first = { host: await snapshot(host), guest: await snapshot(guest) };
      for (const side of [first.host, first.guest]) {
        expect(side.state).toBe('connected');
        expect(side.engine.iceServersConfigured).toBe(0);
        expect(side.engine.localCandidateTypes).toEqual(['host']);
        expect(side.engine.remoteCandidateTypes).toEqual(['host']);
        expect(side.engine.selectedPairTypes).toBe('host/udp -> host/udp');
        // The tunables reached the SDP: Opus mono, in-band FEC, no DTX, 24 kbit/s average, 20 ms packets.
        expect(side.localOpusFmtp).toContain('useinbandfec=1');
        expect(side.localOpusFmtp).toContain('usedtx=0');
        expect(side.localOpusFmtp).toContain('maxaveragebitrate=24000');
        expect(side.localOpusFmtp).toContain('stereo=0');
        expect(side.localPtime).toBe('a=ptime:20');
      }

      // 2. Opus audio in BOTH directions, from RTCPeerConnection.getStats(); the twin's own mapping agrees.
      await expectAudioBytesBothWays(host, guest, 'after connect');
      const flowing = { host: await snapshot(host), guest: await snapshot(guest) };
      expect(flowing.host.engine.codec).toMatch(/^opus\/48000/);
      for (const side of [flowing.host, flowing.guest]) {
        expect(side.engine.bytesSent).toBeGreaterThan(0);
        expect(side.engine.bytesReceived).toBeGreaterThan(0);
        expect(side.engine.packetsSent).toBeGreaterThan(0);
        expect(side.engine.packetsReceived).toBeGreaterThan(0);
        // The partner's audio is attached to an <audio> element and playing.
        expect(side.remoteAudio).toMatchObject({ elements: 1, liveTracks: 1 });
      }
      await expect
        .poll(async () => (await snapshot(guest)).remoteAudio.playing, {
          message: 'remote audio element plays',
        })
        .toBe(true);

      // 3. Mute, each way: the connection stays up and packets keep flowing (silence), but the partner hears no energy;
      //    after unmute the partner hears audio again. Energy is what the receiver measured, so this is real audio.
      await expectMuteSilencesPartner(host, guest);
      await expectMuteSilencesPartner(guest, host);

      // 4. Drop the link from the host's dev controls: both ends see the link end, with the right reasons.
      const hostClosed = drive(host, 'waitForLinkClose');
      const guestClosed = drive(guest, 'waitForLinkClose');
      await host.page.evaluate(() =>
        (window as unknown as { __devControls: { dropLink(): void } }).__devControls.dropLink(),
      );
      expect(await hostClosed).toBe('network-lost');
      expect(await guestClosed).toBe('remote-close');
      expect(await drive(host, 'linkUp')).toBe(false);

      // 5. Recover the way the session layer will: discard the media session, re-open the link (host first), renegotiate.
      await Promise.all([drive(host, 'closeSession'), drive(guest, 'closeSession')]);
      await connect(host, guest, pairId);
      await expectAudioBytesBothWays(host, guest, 'after recovery');
      const recovered = { host: await snapshot(host), guest: await snapshot(guest) };
      for (const side of [recovered.host, recovered.guest]) {
        expect(side.state).toBe('connected');
        expect(side.raw.peerConnections).toBe(2); // a fresh RTCPeerConnection per negotiation attempt
        expect(side.raw.closedPeerConnections).toBe(1);
        expect(side.remoteAudio.elements).toBe(1); // the old audio element was removed with its session
      }

      // 6. End: everything is released.
      await Promise.all([drive(host, 'shutdown'), drive(guest, 'shutdown')]);
      for (const peer of [host, guest]) {
        const left = await peer.page.evaluate(() => ({
          audioElements: document.querySelectorAll('audio[data-testid="remote-audio"]').length,
          openConnections: (window as unknown as { __pcs: RTCPeerConnection[] }).__pcs.filter(
            (pc) => pc.connectionState !== 'closed',
          ).length,
        }));
        expect(left).toEqual({ audioElements: 0, openConnections: 0 });
      }

      for (const peer of [host, guest]) {
        expect(peer.pageErrors, `${peer.name} page errors`).toEqual([]);
        expect(peer.consoleErrors, `${peer.name} console errors`).toEqual([]);
      }
    } finally {
      await host.page.context().close();
      await guest.page.context().close();
    }
  });

  test('relay refusals reach the browser as LinkError codes: no host, second guest, blocked link', async ({
    browser,
    baseURL,
  }) => {
    const pairId = uniquePairId();
    const host = await openPeer(browser, baseURL!, 'host');
    const guest = await openPeer(browser, baseURL!, 'guest');
    const intruder = await openPeer(browser, baseURL!, 'intruder');
    try {
      // A guest that arrives before any host is refused: discovery-failed (the session retries with backoff).
      expect(await drive(guest, 'openOnce', 'guest', pairId, 3_000)).toBe('discovery-failed');

      // Host first, then the guest: both open() calls resolve once the relay reports the pair.
      const hostOpen = drive(host, 'openOnce', 'host', pairId, 10_000);
      await sleep(300);
      const guestOpen = drive(guest, 'openOnce', 'guest', pairId, 10_000);
      expect(await Promise.all([hostOpen, guestOpen])).toEqual(['opened', 'opened']);

      // A third phone with the same pair id is refused while the pair is up.
      expect(await drive(intruder, 'openOnce', 'guest', pairId, 3_000)).toBe('connect-failed');

      // The dev panel's "block link" keeps open() failing with `unavailable` until it is lifted.
      await intruder.page.evaluate(() =>
        (
          window as unknown as { __devControls: { setLinkBlocked(b: boolean): void } }
        ).__devControls.setLinkBlocked(true),
      );
      expect(await drive(intruder, 'openOnce', 'host', uniquePairId(), 3_000)).toBe('unavailable');
      await intruder.page.evaluate(() =>
        (
          window as unknown as { __devControls: { setLinkBlocked(b: boolean): void } }
        ).__devControls.setLinkBlocked(false),
      );
      expect(await drive(intruder, 'openOnce', 'host', uniquePairId(), 400)).toBe('timeout');

      for (const peer of [host, guest, intruder]) {
        expect(peer.pageErrors, `${peer.name} page errors`).toEqual([]);
      }
    } finally {
      for (const peer of [host, guest, intruder]) await peer.page.context().close();
    }
  });
});
