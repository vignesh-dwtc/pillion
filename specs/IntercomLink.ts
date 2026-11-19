import { NativeModule, requireOptionalNativeModule } from 'expo';

/**
 * JS surface of the native module `IntercomLink` (modules/intercom-native, Kotlin class IntercomLinkModule).
 * This file is the contract between the Kotlin and the TypeScript wrappers (src/platform/link/LanTransport.ts, M1).
 *
 * `IntercomLink` is a dumb byte pipe: NSD register/discover, TCP listen/connect, bytes in and out, close, interface
 * listing. Framing, authentication and JSON live in src/core/protocol (TypeScript). Native code never knows product
 * names: the service type, the service-name prefix and the pair id are passed in at runtime.
 *
 * BYTE ENCODING. Every byte payload that crosses the bridge (`send` argument, `onData` event) is a STANDARD Base64
 * string (RFC 4648 section 4: alphabet A-Za-z0-9+/ with '=' padding, no line breaks), decodable with `atob`.
 * expo-modules-core 58 can also map Kotlin ByteArray to Uint8Array (its CHANGELOG lists "ByteArray <-> Uint8Array" and a fix
 * for ByteArray in events), but that path has not been exercised on a device here, so Base64 is the contract until a
 * measured need and an on-device test justify switching (the cost is about 33 percent more bytes and one encode/decode
 * per chunk; the control channel carries signalling only, media runs over WebRTC).
 *
 * THREADING. Calls never block the JS thread: every function is async and Kotlin runs it on the Expo module queue (not the
 * main thread). Socket reads run on native reader threads and emit events from there; Expo marshals them to JS. Events of one
 * connection are delivered in order (`onData` chunks in TCP order, `onClose` after the last `onData`). `send` is serialised
 * per connection natively: concurrent `send` calls on one connection are written in call order and never interleave.
 * Chunk boundaries of `onData` are arbitrary.
 *
 * ERRORS. Rejections carry a `code` (CodedException): ERR_NOT_IMPLEMENTED (M0 skeleton), or one of LinkNativeErrorCode.
 * The wrapper maps them to LinkError (src/platform/link/LinkTransport.ts).
 */

export const INTERCOM_LINK_MODULE_NAME = 'IntercomLink';
/** Bumped together with the Kotlin `INTERCOM_API_VERSION` when this file changes incompatibly. */
export const INTERCOM_LINK_API_VERSION = 1;

export type LinkNativeErrorCode =
  | 'ERR_NOT_IMPLEMENTED'
  | 'ERR_LINK_NOT_WIFI' // no Wi-Fi network (LAN)
  | 'ERR_LINK_PERMISSION' // a runtime permission is missing
  | 'ERR_LINK_NSD' // NsdManager failure; message carries the platform error code
  | 'ERR_LINK_CONNECT' // TCP connect failed or timed out
  | 'ERR_LINK_UNKNOWN_CONNECTION' // send/close on an id that is closed or never existed
  | 'ERR_LINK_IO'; // socket write failed

/** Same values as `NetworkInterfaceKind` in LinkTransport.ts. */
export type NativeInterfaceKind =
  'wifi' | 'wifi-direct' | 'hotspot' | 'cellular' | 'ethernet' | 'vpn' | 'loopback' | 'other';

/** Same shape as `LinkNetworkInterface` in LinkTransport.ts. */
export interface NativeNetworkInterface {
  name: string;
  kind: NativeInterfaceKind;
  addresses: string[];
  up: boolean;
  multicast: boolean;
}

export interface LinkModuleInfo {
  apiVersion: number;
  /** Build.VERSION.SDK_INT. */
  sdkInt: number;
}

export interface StartAdvertisingOptions {
  /** NSD service type without trailing dot, e.g. `_pillion._tcp` (config/identity.json `nsdServiceType`). */
  serviceType: string;
  /** Non-secret pair id (base64url). The registered name is `<serviceNamePrefix><pairId>`. */
  pairId: string;
  /** Prefix for the service name; defaults to `pn-` natively. */
  serviceNamePrefix?: string;
  /** TCP port of an active listener (from `listen`). */
  port: number;
}

export interface StartAdvertisingResult {
  /** Name actually registered (NSD may append ` (2)` on a conflict). */
  registeredName: string;
}

export interface StartDiscoveryOptions {
  serviceType: string;
  /** Only report services of this pair id. Native filters; other services on the network are ignored. */
  pairId: string;
  serviceNamePrefix?: string;
}

export interface ListenOptions {
  /** 0 = ephemeral port. */
  port: number;
}

export interface ListenResult {
  listenerId: string;
  port: number;
  /** Address chosen by the advertise-address policy (null when there is no usable local address yet). */
  localAddress: string | null;
  interfaceName: string | null;
}

export interface ConnectOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

/** Describes one established TCP connection (outgoing from `connect`, incoming in `onAccept`). */
export interface NativeConnection {
  connectionId: string;
  localAddress: string | null;
  remoteAddress: string | null;
  interfaceName: string | null;
}

/** `onData`: bytes received. `data` is Base64 (see BYTE ENCODING). */
export interface LinkDataEvent {
  connectionId: string;
  data: string;
}

/** `LinkCloseReason` values of LinkTransport.ts. `detail` is a short message without secrets. */
export type NativeCloseReason =
  'local-close' | 'remote-close' | 'io-error' | 'timeout' | 'network-lost' | 'aborted';

export interface LinkCloseEvent {
  connectionId: string;
  reason: NativeCloseReason;
  detail?: string;
}

/** `onAccept`: a peer connected to a listener. Natively only one connection per listener is kept open: extra ones are closed. */
export interface LinkAcceptEvent extends NativeConnection {
  listenerId: string;
}

/** `onPeer`: discovery result. A service is reported once it has been RESOLVED to a host and port. */
export interface LinkPeerEvent {
  kind: 'found' | 'lost';
  serviceName: string;
  host: string | null;
  port: number | null;
}

/** `onNetworkChange`: the Wi-Fi network was lost or became available while the module held locks. */
export interface LinkNetworkChangeEvent {
  wifiConnected: boolean;
}

export type IntercomLinkEvents = {
  onData(event: LinkDataEvent): void;
  onClose(event: LinkCloseEvent): void;
  onAccept(event: LinkAcceptEvent): void;
  onPeer(event: LinkPeerEvent): void;
  onNetworkChange(event: LinkNetworkChangeEvent): void;
};

/**
 * Functions. Implemented in M0: `getInfo`, `isWifiConnected`, `listInterfaces`. The rest rejects with ERR_NOT_IMPLEMENTED until M1.
 */
export declare class IntercomLinkNativeModule extends NativeModule<IntercomLinkEvents> {
  readonly API_VERSION: number;

  getInfo(): Promise<LinkModuleInfo>;
  /** True when any connected network has the Wi-Fi transport, default or not (a Wi-Fi Direct group counts after M2). */
  isWifiConnected(): Promise<boolean>;
  listInterfaces(): Promise<NativeNetworkInterface[]>;

  /** Takes the multicast lock and a Wi-Fi lock (low latency) so NSD works and the radio stays awake. Idempotent. */
  acquireLocks(): Promise<void>;
  /** Releases what `acquireLocks` took. Idempotent. */
  releaseLocks(): Promise<void>;

  /** NsdManager.registerService for the active listener. At most one registration at a time. */
  startAdvertising(options: StartAdvertisingOptions): Promise<StartAdvertisingResult>;
  stopAdvertising(): Promise<void>;

  /** Starts discovery (and resolution) for the pair id; results arrive as `onPeer`. At most one discovery at a time. */
  startDiscovery(options: StartDiscoveryOptions): Promise<void>;
  stopDiscovery(): Promise<void>;

  /** Opens a ServerSocket. Incoming connections arrive as `onAccept`. */
  listen(options: ListenOptions): Promise<ListenResult>;
  stopListening(listenerId: string): Promise<void>;

  connect(options: ConnectOptions): Promise<NativeConnection>;
  /** `dataBase64`: Base64 bytes. Resolves when the bytes are handed to the socket (written and flushed). */
  send(connectionId: string, dataBase64: string): Promise<void>;
  /** Closes the connection; `onClose` with reason `local-close` follows. Closing an unknown id resolves. */
  close(connectionId: string): Promise<void>;

  /** Stops advertising, discovery, listeners and connections, releases locks. The module can be used again afterwards. */
  dispose(): Promise<void>;
}

/** The native module, or null when it is not linked (web, Jest, a build without the local module). */
export function getIntercomLinkModule(): IntercomLinkNativeModule | null {
  return requireOptionalNativeModule<IntercomLinkNativeModule>(INTERCOM_LINK_MODULE_NAME);
}
