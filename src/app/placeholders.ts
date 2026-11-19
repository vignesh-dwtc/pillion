import type { DiagnosticsReportInput, LogEntry } from '../core/diagnostics/types';
import type { SessionSnapshot } from '../core/session/types';
import { DEFAULT_AUDIO_TUNABLES } from '../platform/audio/AudioTunables';
import type { AudioRouteState } from '../platform/audio/AudioRoute';
import type { LinkNetworkInterface } from '../platform/link/LinkTransport';
import type { IceCandidateInfo, MediaStats } from '../platform/media/MediaEngine';
import type { BatteryInfo } from '../platform/service/RideService';

import { APP_VERSION } from './version';

/**
 * STATIC PLACEHOLDER DATA for the M0 screens. Nothing here is live: the composition root (M1) replaces these
 * with the session controller, the stats sampler and the ring log. Typed with the frozen contracts so the
 * swap is a change of source, not of shape. No secrets: the contract types cannot even carry them.
 */

/** Fixed clock so the sample renders identically every time (screenshots, tests). */
export const SAMPLE_NOW = Date.UTC(2026, 10, 17, 9, 30, 0);

export const SAMPLE_SESSION: SessionSnapshot = {
  state: 'connected',
  role: 'guest',
  pairId: 'sample-pair-id',
  muted: false,
  local: { headsetConnected: true, interruption: 'none', batteryPct: 81 },
  peer: {
    name: 'Alex',
    muted: false,
    headsetConnected: true,
    batteryPct: 64,
    charging: false,
    interruption: 'none',
    updatedAt: SAMPLE_NOW - 1_500,
  },
  transport: 'lan',
  generation: 1,
  attempt: 0,
  connectedAt: SAMPLE_NOW - 125_000,
  error: null,
};

export const SAMPLE_INTERFACES: LinkNetworkInterface[] = [
  {
    name: 'wlan0',
    kind: 'wifi',
    addresses: ['192.168.1.23', 'fe80::1c2b:3dff:fe4a:5b6c'],
    up: true,
    multicast: true,
  },
  { name: 'p2p-wlan0-0', kind: 'wifi-direct', addresses: [], up: false, multicast: true },
  { name: 'rmnet_data1', kind: 'cellular', addresses: [], up: false, multicast: false },
  { name: 'lo', kind: 'loopback', addresses: ['127.0.0.1', '::1'], up: true, multicast: false },
];

const LOCAL_CANDIDATES: IceCandidateInfo[] = [
  { id: 'local-1', type: 'host', protocol: 'udp', address: '192.168.1.23', port: 50321, networkType: 'wifi' },
  {
    id: 'local-2',
    type: 'host',
    protocol: 'udp',
    address: 'fe80::1c2b:3dff:fe4a:5b6c',
    port: 53410,
    networkType: 'wifi',
  },
];

const REMOTE_CANDIDATES: IceCandidateInfo[] = [
  {
    id: 'remote-1',
    type: 'host',
    protocol: 'udp',
    address: '192.168.1.41',
    port: 49152,
    networkType: 'wifi',
  },
];

export const SAMPLE_STATS: MediaStats = {
  timestamp: SAMPLE_NOW,
  connectionState: 'connected',
  selectedPair: {
    local: LOCAL_CANDIDATES[0] as IceCandidateInfo,
    remote: REMOTE_CANDIDATES[0] as IceCandidateInfo,
    state: 'succeeded',
    rttMs: 4,
  },
  localCandidates: LOCAL_CANDIDATES,
  remoteCandidates: REMOTE_CANDIDATES,
  rttMs: 4,
  jitterMs: 2.1,
  packetsSent: 6_250,
  packetsReceived: 6_231,
  packetsLost: 19,
  bytesSent: 391_000,
  bytesReceived: 388_000,
  inputLevel: 0.42,
  outputLevel: 0.18,
  codec: 'opus/48000/2',
};

export const SAMPLE_AUDIO: AudioRouteState = {
  status: 'active',
  communicationMode: true,
  devices: [
    { id: 'bt-1', kind: 'bluetooth-sco', name: 'Sample earbuds', hasMic: true },
    { id: 'earpiece', kind: 'earpiece', name: 'Phone earpiece', hasMic: false },
    { id: 'speaker', kind: 'speaker', name: 'Phone speaker', hasMic: false },
  ],
  activeDeviceId: 'bt-1',
  headsetConnected: true,
  usingFallback: false,
  error: null,
};

export const SAMPLE_BATTERY: BatteryInfo = { levelPct: 81, charging: false };

export const SAMPLE_LOG: LogEntry[] = [
  { t: SAMPLE_NOW - 130_000, level: 'info', tag: 'session', message: 'state idle -> starting' },
  {
    t: SAMPLE_NOW - 129_400,
    level: 'info',
    tag: 'audio',
    message: 'route active',
    data: { device: 'bluetooth-sco' },
  },
  {
    t: SAMPLE_NOW - 128_800,
    level: 'info',
    tag: 'link',
    message: 'opening',
    data: { role: 'guest', kind: 'lan' },
  },
  { t: SAMPLE_NOW - 127_100, level: 'info', tag: 'session', message: 'state linking -> signaling' },
  { t: SAMPLE_NOW - 126_300, level: 'info', tag: 'session', message: 'state signaling -> connecting' },
  { t: SAMPLE_NOW - 125_000, level: 'info', tag: 'session', message: 'state connecting -> connected' },
  {
    t: SAMPLE_NOW - 61_000,
    level: 'warn',
    tag: 'media',
    message: 'packet loss above 5 percent',
    data: { lossPct: 6.2 },
  },
  {
    t: SAMPLE_NOW - 40_000,
    level: 'info',
    tag: 'media',
    message: 'loss back to normal',
    data: { lossPct: 0.4 },
  },
];

export const SAMPLE_DIAGNOSTICS: DiagnosticsReportInput = {
  generatedAt: SAMPLE_NOW,
  appVersion: APP_VERSION,
  platform: 'sample',
  osVersion: null,
  deviceModel: null,
  session: SAMPLE_SESSION,
  interfaces: SAMPLE_INTERFACES,
  stats: SAMPLE_STATS,
  sample: {
    t: SAMPLE_NOW,
    rttMs: 4,
    jitterMs: 2.1,
    lossPct: 0.4,
    bitrateOutKbps: 23.8,
    bitrateInKbps: 24.1,
    inputLevel: 0.42,
    outputLevel: 0.18,
  },
  audio: SAMPLE_AUDIO,
  battery: SAMPLE_BATTERY,
  tunables: DEFAULT_AUDIO_TUNABLES,
  log: SAMPLE_LOG,
};
