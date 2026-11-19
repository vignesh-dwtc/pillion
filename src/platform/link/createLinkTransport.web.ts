/**
 * Web twin of createLinkTransport: WebLinkTransport, a LinkTransport over the DEV WebSocket relay
 * (scripts/dev-relay.mjs). DEV ONLY: it lets two browser contexts on one machine play host and guest.
 *
 *   relay URL  : `?relay=ws://localhost:8787` query parameter, else EXPO_PUBLIC_RELAY_URL, else ws://localhost:8787.
 *                Only localhost / 127.0.0.1 / [::1] are accepted: the web build never talks to anything else.
 *   rooms      : keyed by the non-secret pair id, `?room=<pairId>&role=host|guest`.
 *   open()     : resolves when the relay reports that both peers are present (the host waits for its guest, a guest is
 *                refused when there is no host: LinkError('discovery-failed')).
 *   channel    : opaque binary WebSocket messages; framing, auth and JSON stay in src/core/protocol.
 *
 * Web proves the signaling and reconnect LOGIC only. It says nothing about Wi-Fi, NSD, TCP or Wi-Fi Direct.
 */
import type { Unsubscribe } from '../../core/common/types';
import { devControls } from '../devtools/devControls.web';

import {
  LinkError,
  type LinkChannel,
  type LinkCloseReason,
  type LinkEndpoint,
  type LinkNetworkInterface,
  type LinkOpenOptions,
  type LinkTransport,
} from './LinkTransport';

/** Greppable by scripts/check-android-bundle.mjs: this string must never appear in the Android bundle. */
export const WEB_ONLY_LINK_TRANSPORT = '@@web-only:WebLinkTransport@@';

const DEFAULT_RELAY_URL = 'ws://localhost:8787';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const PAIR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Close codes the relay uses for refusals and for "the other peer left" (see scripts/dev-relay.mjs). */
const RELAY_NO_HOST = 4404;
const RELAY_PEER_LEFT = 4410;

type CloseListener = (reason: LinkCloseReason | string, detail?: string) => void;

function relayUrl(): string {
  if (typeof location !== 'undefined') {
    const fromQuery = new URLSearchParams(location.search).get('relay');
    if (fromQuery) return fromQuery;
  }
  return process.env.EXPO_PUBLIC_RELAY_URL || DEFAULT_RELAY_URL;
}

/** Parses and validates the relay URL; returns null when it is not a localhost WebSocket URL. */
function parseRelayUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    return LOCAL_HOSTNAMES.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function toUint8Array(data: unknown): Uint8Array {
  // Not `instanceof ArrayBuffer`: that fails across realms (Jest's vm context, iframes).
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return new Uint8Array(data as ArrayBuffer);
}

class RelayChannel implements LinkChannel {
  readonly endpoint: LinkEndpoint;
  private readonly dataListeners = new Set<(data: Uint8Array) => void>();
  private readonly closeListeners = new Set<CloseListener>();
  /** Bytes that arrived before the first onData() subscriber; flushed in order to the first subscriber. */
  private backlog: Uint8Array[] | null = [];
  private closedWith: { reason: LinkCloseReason; detail?: string } | null = null;
  private pendingReason: LinkCloseReason | null = null;

  constructor(
    private readonly socket: WebSocket,
    remoteAddress: string,
    private readonly onClosed: () => void,
  ) {
    this.endpoint = { kind: 'web-relay', localAddress: null, remoteAddress, interfaceName: 'dev-relay' };
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return; // relay control frames are only meaningful before pairing
      const bytes = toUint8Array(event.data);
      if (this.backlog !== null) {
        this.backlog.push(bytes);
        return;
      }
      for (const listener of [...this.dataListeners]) listener(bytes);
    });
    socket.addEventListener('close', (event) => {
      this.finish(this.reasonFor(event.code), event.reason || undefined);
    });
  }

  send(data: Uint8Array): Promise<void> {
    if (this.closedWith !== null || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('link closed'));
    }
    this.socket.send(data);
    return Promise.resolve();
  }

  onData(listener: (data: Uint8Array) => void): Unsubscribe {
    this.dataListeners.add(listener);
    if (this.backlog !== null) {
      const pending = this.backlog;
      this.backlog = null;
      for (const bytes of pending) listener(bytes);
    }
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onClose(listener: CloseListener): Unsubscribe {
    if (this.closedWith !== null) {
      const { reason, detail } = this.closedWith;
      queueMicrotask(() => listener(reason, detail));
      return () => undefined;
    }
    this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  close(): Promise<void> {
    this.closeWith('local-close');
    return Promise.resolve();
  }

  /** Dev panel "drop link": the radio vanished. Reported as `network-lost`; the relay tells the other peer. */
  drop(): void {
    this.closeWith('network-lost');
  }

  private closeWith(reason: LinkCloseReason) {
    if (this.closedWith !== null) return;
    this.pendingReason = reason;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, reason);
    }
    // Report right away: waiting for the closing handshake would delay the state machine for nothing.
    this.finish(reason);
  }

  private reasonFor(code: number): LinkCloseReason {
    if (this.pendingReason !== null) return this.pendingReason;
    return code === RELAY_PEER_LEFT ? 'remote-close' : 'io-error';
  }

  private finish(reason: LinkCloseReason, detail?: string) {
    if (this.closedWith !== null) return;
    this.closedWith = { reason, detail };
    this.backlog = null;
    this.onClosed();
    for (const listener of [...this.closeListeners]) listener(reason, detail);
    this.closeListeners.clear();
    this.dataListeners.clear();
  }
}

class WebLinkTransport implements LinkTransport {
  readonly kind = 'web-relay' as const;
  private disposed = false;
  private channel: RelayChannel | null = null;
  private readonly attempts = new Set<() => void>();
  private readonly unsubscribeDrop: Unsubscribe;

  constructor() {
    this.unsubscribeDrop = devControls.onDropLink(() => this.channel?.drop());
  }

  async isAvailable(): Promise<boolean> {
    return !this.disposed && typeof WebSocket !== 'undefined' && parseRelayUrl(relayUrl()) !== null;
  }

  open(options: LinkOpenOptions): Promise<LinkChannel> {
    if (this.disposed) return Promise.reject(new LinkError('unavailable', 'WebLinkTransport is disposed'));
    if (options.signal?.aborted) return Promise.reject(new LinkError('aborted'));
    if (typeof WebSocket === 'undefined') return Promise.reject(new LinkError('unsupported', 'no WebSocket'));
    if (devControls.getState().linkBlocked) {
      return Promise.reject(new LinkError('unavailable', 'link blocked by the dev panel'));
    }
    const relay = parseRelayUrl(relayUrl());
    if (relay === null) {
      return Promise.reject(
        new LinkError('unavailable', 'the dev relay URL must be a localhost WebSocket URL'),
      );
    }
    if (!PAIR_ID.test(options.pairId)) {
      return Promise.reject(new LinkError('connect-failed', 'malformed pair id'));
    }

    relay.pathname = '/';
    relay.search = '';
    relay.searchParams.set('room', options.pairId);
    relay.searchParams.set('role', options.role);
    const remoteAddress = relay.host;

    return new Promise<LinkChannel>((resolve, reject) => {
      const socket = new WebSocket(relay.toString());
      socket.binaryType = 'arraybuffer';
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let opened = false;

      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        this.attempts.delete(abandon);
      };
      const fail = (error: LinkError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
          socket.close(1000);
        reject(error);
      };
      const onAbort = () => fail(new LinkError('aborted'));
      const abandon = () => fail(new LinkError('aborted', 'transport disposed'));

      this.attempts.add(abandon);
      options.signal?.addEventListener('abort', onAbort);
      timer = setTimeout(() => fail(new LinkError('timeout')), options.timeoutMs);

      const unreachable = () =>
        fail(new LinkError('unavailable', 'dev relay not reachable (is scripts/dev-relay.mjs running?)'));
      socket.addEventListener('open', () => {
        opened = true;
      });
      // A refused connection fires `error` (then `close` in browsers; Node's WebSocket fires only `error`).
      socket.addEventListener('error', () => {
        if (!opened) unreachable();
      });
      socket.addEventListener('message', (event) => {
        if (settled || typeof event.data !== 'string') return;
        let control: unknown;
        try {
          control = JSON.parse(event.data);
        } catch {
          return;
        }
        if ((control as { type?: unknown }).type !== 'paired') return;
        settled = true;
        cleanup();
        const channel = new RelayChannel(socket, remoteAddress, () => {
          if (this.channel === channel) this.channel = null;
          devControls.reportLinkUp(this.channel !== null);
        });
        this.channel = channel;
        devControls.reportLinkUp(true);
        resolve(channel);
      });
      socket.addEventListener('close', (event) => {
        if (settled) return;
        if (!opened) unreachable();
        else if (event.code === RELAY_NO_HOST)
          fail(new LinkError('discovery-failed', 'no host for this pairing yet'));
        else fail(new LinkError('connect-failed', `relay refused the connection (${event.code})`));
      });
    });
  }

  async listInterfaces(): Promise<LinkNetworkInterface[]> {
    return [
      { name: 'dev-relay', kind: 'loopback', addresses: ['127.0.0.1'], up: !this.disposed, multicast: false },
    ];
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDrop();
    for (const abandon of [...this.attempts]) abandon();
    await this.channel?.close();
  }
}

export function createLinkTransport(): LinkTransport {
  return new WebLinkTransport();
}
