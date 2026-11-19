/**
 * Test doubles for the session layer. Everything here is deterministic (injected clock, seeded randomness) and
 * free of platform imports, so it can also back web stand-ins and Playwright-adjacent unit tests.
 */
export { ManualClock } from './ManualClock';
export { FakeNetwork } from './FakeNetwork';
export {
  InMemoryChannel,
  InMemoryLinkHub,
  InMemoryLinkTransport,
  createInMemoryLinkPair,
  type ChunkingMode,
  type InMemoryLinkOptions,
  type InMemoryLinkPair,
} from './InMemoryLinkTransport';
export {
  FakeMediaEngine,
  FakeMediaFabric,
  FakeMediaSession,
  createFakeMediaPair,
  type FakeMediaOptions,
  type FakeMediaPair,
} from './FakeMediaEngine';
export { FakeAudioRoute } from './FakeAudioRoute';
export { FakeRideService } from './FakeRideService';
export { FakePermissionService } from './FakePermissionService';
export {
  createFakeEstablish,
  establishFakeSecureChannel,
  type FakeEstablishOptions,
} from './FakeSecureChannel';
export { MemoryLogger, type MemoryLogEntry } from './MemoryLogger';
export { TEST_PASSPHRASE, makeTestPairing } from './pairingFixtures';
export { createSeededCrypto, createSeededRandomBytes, createSeededUnit } from './seededRandom';
export {
  createTwoPeerHarness,
  type PeerRig,
  type TwoPeerHarness,
  type TwoPeerOptions,
} from './createTwoPeerHarness';
export { tapEstablish, wireTypes, type TapOptions, type WireRecord } from './TapSecureChannel';
