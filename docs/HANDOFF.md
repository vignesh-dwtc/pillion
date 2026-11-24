# Handoff: current state and next steps

Last updated: 2026-11-24. Update this file whenever you stop work, so the next agent (Codex, Claude Code or a human) can continue without the chat history.

## 1. Where things stand

| Item                      | State                                                                                                                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Milestone M0 (foundation) | Merged into `main` through PR #2.                                                                                                                                                                                       |
| Milestone M1 (LAN voice)  | Code complete, integrated and committed on `claude/m1-lan-voice` (PR #3); CI green on all three jobs. Open: screenshots viewed, reviewer pass, owner device test. Nothing run on a phone. Status lines: `docs/PLAN.md`. |
| Branch                    | `claude/m1-lan-voice`: real QR pairing, native link/audio/service, media engine, live screens and the e2e ride test are all committed (PR #3).                                                                          |
| `main` protection         | PR required (0 approvals), 3 CI checks required and strict, conversation resolution required, no force push/deletion, admins may bypass.                                                                                |
| Tests                     | `npm test` (Jest), `npm run e2e` (Playwright, web), `npm run check:bundle`, Android assembleDebug + Kotlin JVM tests (CI job); each prints its own counts.                                                              |
| Device testing            | None for M1. The owner's checklist is `docs/TESTING.md` section 3, "M1" items 1-14 plus slice 1.                                                                                                                        |

## 2. In flight when this file was written (may be unfinished)

1. **M1 integration (done: committed, full suite passes, CI green on the checks, web-e2e and android jobs).** android-native delivered the real `IntercomLink` (NSD + TCP), `IntercomAudioRoute` and `IntercomRideService` Kotlin with JVM tests (99 pass), the TS wrappers (`LanTransport`, `NativeRideService`) with Jest tests, and an arm64 APK that assembles (114,969,298 bytes). In parallel: media (`createMediaEngine`, loopback), ui (`src/app/ride.ts` runtime, ride permissions, live ride / diagnostics / debug screens) and web-verify (`e2e/ride.spec.ts`). Still open for the lead: view the screenshots of pair / home / ride / diagnostics (`docs/screenshots/`), reviewer pass on the combined result, then hand the APK and `docs/TESTING.md` M1 to the owner.
2. **Docs updated for M1** (foundation, 2026-11-24): device checklist, PLAN status lines, decisions D-053..D-064 and E-5, ownership of `src/platform/crypto`.

## 3. Owner-reported issue to fix first in M1 (DONE on branch claude/m1-lan-voice: real QR pairing, see docs/TESTING.md M1 slice 1 checklist; open minors: wrong-QR re-handled every 3 s, unscanned host offer shows on Home, stepper still says 'III CHIME', no unmount guard in handle()/newCode(); fixed: the duplicate D-046 is now D-053, `src/platform/crypto` is in the ownership table (D-054))

On a real phone the pairing does not work: the host shows a **sample** QR, the guest screen has **no camera preview and never asks for camera permission**. This is because M0 shipped placeholders. Pairing logic exists and is tested (`src/core/pairing`: `generatePairing`, `encodePairingString`, `decodePairingString`, `recordFromPayload`; storage: `src/platform/storage/SecurePairingRepository.ts`) but is not wired to the UI.

M1 slice 1, real pairing:

- Host (`src/features/pair`, route `/pair/host`): `generatePairing(createCryptoProvider(expo-crypto randomBytes), deviceName)`, save the host `PairingRecord`, render the real string as a QR (uqr + react-native-svg; ECC M; it fits QR version 12).
- Guest (route `/pair/guest`): request camera permission with an explanation (`expo-camera` `useCameraPermissions`; add the `expo-camera` config plugin with a permission string in `app.config.ts`, then `npm run prebuild:android`), live `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`, decode, validate, save the guest record, show "Paired with <host name>". Denied permission: explain and link to settings. Developer mode keeps the paste-string path.
- Home shows the paired partner.
- Device checklist into `docs/TESTING.md`: scan host -> guest, deny then grant camera, worst-case QR at arm's length, app restart keeps the pairing.

## 4. Rest of M1 (see docs/BRIEF.md "M1" and docs/PLAN.md)

Integrated and committed, CI green (full suite passes), not yet reviewed: LAN transport (NSD + TCP) in `modules/intercom-native` with `src/platform/link/LanTransport.ts`, `WebRtcMediaEngine` over `@livekit/react-native-webrtc`, `AudioRoute` (communication mode, Bluetooth headset first), minimal foreground `RideService`, composition root wiring `createSessionController` (`src/app/ride.ts`), live home / ride screens with cues, diagnostics + share, loopback self-test, audio tunables, two-peer browser test through the real UI (`e2e/ride.spec.ts`). Remaining: screenshots viewed and the reviewer pass, then the owner runs `docs/TESTING.md` M1 on two phones (10 minutes, screens off, shared Wi-Fi). Stop after M1 (brief: the owner tests between milestones).

## 5. Open review findings (from PR #2 review)

Fixed in round 1 (see the commit messages): bundle guard wired into npm + CI, manifest least privilege and no backup / deep-link filter (D-045), channel backlog fails closed, CI licence / cache key / prebuild drift check, `isWifiConnected` over all networks and `SocketException` handling (D-046), stale counts and the M1 gate wording in `docs/PLAN.md`, unit-test-only claims in `docs/TESTING.md`, dev-relay header.

Still open:

- Docs: record "debug-signed only, never distribute" for the committed debug keystore.
- Backlog (minor): bind the protocol version into the handshake proofs; reset backoff only after a stable connection; extend `src/platform/parity.check.ts` to all twins; dev-panel touch targets.

## 6. Environment notes

- The cloud sandbox needs `ANDROID_HOME=/opt/android-sdk` and a Maven Central mirror (`~/.gradle/init.d/00-central-mirror.gradle`, created by `scripts/cloud-setup.sh`). Locally you need neither the mirror nor that path.
- Known toolchain fixes already applied: `babel-preset-expo` is a direct devDependency; `tsconfig.json` sets `types: ["jest","node"]` (TS 6); Jest timeout 30 s (slow CI runner).
- ESLint stays on 9.x (eslint-plugin-react crashes on 10).

## 7. How to continue in a fresh agent

1. `git pull`, `npm ci`, then run the full check list in AGENTS.md.
2. Read sections 2 and 3 above and pick up the first unfinished item.
3. Update `docs/PLAN.md`, `docs/DECISIONS.md` (one line + reason per decision) and this file before you stop.
