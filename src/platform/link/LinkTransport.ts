import type { Unsubscribe } from '../../core/common/types';
import type { ByteChannel } from '../../core/protocol/secureChannel';

/**
 * LinkTransport: how the two phones get a reliable, ordered byte pipe to each other.
 * CONTRACT: owned by the lead. No react-native imports in this file (src/core imports it type-only).
 *
 * Implementations (one owner each, see docs/ARCHITECTURE.md):
 *   LanTransport        (M1)  native: NSD/mDNS + TCP over a shared Wi-Fi network   -> android-native
 *   WifiDirectTransport (M2)  native: Wi-Fi Direct group from pairing credentials  -> android-native
 *   WebLinkTransport    (web) dev-only WebSocket relay so two browser contexts can play host and guest -> web-verify
 *   InMemoryLinkTransport     test fake that can drop and restore the link          -> core-session
 *
 * open() is called once per connection attempt. The session layer owns retry/backoff; a transport never
 * retries on its own.
 */

export type LinkKind = 'lan' | 'wifi-direct' | 'web-relay' | 'memory';
export type LinkRole = 'host' | 'guest';

export type NetworkInterfaceKind =
  'wifi' | 'wifi-direct' | 'hotspot' | 'cellular' | 'ethernet' | 'vpn' | 'loopback' | 'other';

/** Snapshot of one local network interface, for the diagnostics screen (risk 1: ICE must see the link interface). */
export interface LinkNetworkInterface {
  name: string;
  kind: NetworkInterfaceKind;
  addresses: string[];
  up: boolean;
  multicast: boolean;
}

export interface LinkEndpoint {
  kind: LinkKind;
  localAddress: string | null;
  remoteAddress: string | null;
  interfaceName: string | null;
}

export type LinkCloseReason =
  'local-close' | 'remote-close' | 'io-error' | 'timeout' | 'network-lost' | 'aborted';

/** An established link. Chunk boundaries are arbitrary (TCP): framing happens in core/protocol. */
export interface LinkChannel extends ByteChannel {
  readonly endpoint: LinkEndpoint;
  /** `reason` is a LinkCloseReason (ByteChannel types it as string to keep core/protocol platform-free). */
  onClose(listener: (reason: LinkCloseReason | string, detail?: string) => void): Unsubscribe;
}

export interface LinkOpenOptions {
  role: LinkRole;
  /** Non-secret pair id. Hosts advertise under it; guests look for it. */
  pairId: string;
  /** Pairing-time Wi-Fi Direct credentials. Only WifiDirectTransport reads this. NEVER log. */
  wifiDirect?: { networkName: string; passphrase: string };
  /** Deadline for this attempt. open() rejects with LinkError('timeout') when it passes. */
  timeoutMs: number;
  /** Aborts an in-flight open(); rejects with LinkError('aborted'). */
  signal?: AbortSignal;
}

export type LinkErrorCode =
  | 'unavailable' // transport cannot work right now (e.g. LAN: not on Wi-Fi)
  | 'permission' // a runtime permission is missing
  | 'timeout'
  | 'aborted'
  | 'discovery-failed'
  | 'connect-failed'
  | 'unsupported';

export class LinkError extends Error {
  readonly code: LinkErrorCode;
  constructor(code: LinkErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'LinkError';
    this.code = code;
  }
}

export interface LinkTransport {
  readonly kind: LinkKind;
  /** Cheap check: could open() plausibly succeed now? (LAN: connected to a Wi-Fi network.) */
  isAvailable(): Promise<boolean>;
  /**
   * Host: listen + advertise, resolve when a peer connects (one peer at a time; further connections are closed).
   * Guest: discover the host for `pairId`, connect, resolve. Rejects with LinkError.
   */
  open(options: LinkOpenOptions): Promise<LinkChannel>;
  /** Local interfaces right now, for diagnostics. */
  listInterfaces(): Promise<LinkNetworkInterface[]>;
  /** Releases advertisers, listeners and locks. The transport is unusable afterwards. */
  dispose(): Promise<void>;
}
