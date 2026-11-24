# Plan (living)

Later sessions need only: "read CLAUDE.md and docs/PLAN.md". Legend: `[x]` done and verified as stated, `[~]` in progress, `[ ]` not started. **(hw)** = needs the owner's phones; nothing marked (hw) has been run on a device.

The brief (`docs/BRIEF.md`) defines the milestones; this file tracks status. Update the status line of a milestone whenever its state changes.

## Stage 1: offline pair (Android)

### M0 Foundation - STATUS: done pending review fixes and a green GitHub Actions run (started 2026-11-16)

- [x] Brief saved unchanged as `docs/BRIEF.md`.
- [x] Android SDK installed; the app (Kotlin modules still M0 stubs) compiles and assembles in the cloud session on Expo SDK 58 / RN 0.88.1 with the LiveKit WebRTC fork (DECISIONS E-3). Nothing exercises the WebRTC fork or the interop layer at runtime yet.
- [ ] M1 go-ahead: tick only after the first green `android` job of the GitHub Actions CI run (assemble + Kotlin unit tests on a clean runner).
- [x] WebRTC package and React Native version chosen and recorded with evidence (DECISIONS D-002, D-004, E-1..E-4).
- [x] Scaffold: strict TypeScript, ESLint with architecture rules, Prettier, Jest (Node), Playwright config skeleton, identity in one file.
- [x] Shared contracts committed (see CLAUDE.md "Contracts") and subagent definitions in `.claude/agents/`.
- [x] `core/` implemented with tests: protocol, pairing payload, session state machine, reconnect policy, two-peer simulation (real-protocol two-peer test included). Current counts: `npm test` prints the suite and test totals.
- [x] App shell: navigation, placeholder screens, dark high-contrast theme with large touch targets (8 routes; screenshots in e2e/.artifacts/screens, viewed by ui, web-verify and the ui-web reviewer).
- [x] Web build runs; `npm run web:build && npm run e2e` passes (smoke of every route + two-peer WebRTC with audio bytes both ways, mute, link drop, recovery; Playwright prints the count).
- [x] CI workflow `.github/workflows/ci.yml` written (checks, web-e2e, android); YAML-parsed and reviewed by hand, NOT yet run on GitHub (actionlint could not be run here). `scripts/cloud-setup.sh` tested against a fresh temp SDK: clean install 24 s, idempotent re-run <1 s, exit 0 (DECISIONS D-029..D-032).
- [x] Full `assembleDebug` (arm64) verified in the session: BUILD SUCCESSFUL in 2m 13s, 112 MB debug APK (DECISIONS E-3).

### M1 First voice on the same Wi-Fi - STATUS: in progress, code complete, integrated and CI green, pending screenshots viewed, reviewer pass and the owner's device test; nothing run on a device (started 2026-11-17, branch `claude/m1-lan-voice`)

- [x] QR pairing (host shows, guest scans) + dev-only paste string. Web e2e (`e2e/pairing.spec.ts`) and unit tests; untested on device (`docs/TESTING.md` M1 slice 1). Open minors in `docs/HANDOFF.md` section 3.
- [~] `LanTransport` (NSD + TCP, `modules/intercom-native` + `src/platform/link`), `AudioRoute` (communication mode, `setCommunicationDevice` on 31+, legacy SCO on 29-30) and minimal `RideService` (foreground service microphone|connectedDevice, wake + Wi-Fi locks, Mute/End actions): written; android:compile, 99 Kotlin JVM tests and the TS wrapper tests pass, arm64 debug APK assembles (android-native report). `WebRtcMediaEngine` and signaling wiring: integrated and committed, full suite passes and CI is green; reviewer pass pending. Compiles and unit-tested, untested on device.
- [~] Home and ride screens live (start, mute, hold-to-end, status) with cues for connected / reconnecting / disconnected through the native `AudioRoute`; composition root wires `createSessionController` (`src/app/ride.ts`). Integrated and committed, CI green; pending screenshots viewed and reviewer pass.
- [~] Diagnostics screen live + Share, loopback self-test card and audio tunables on the Developer tools screen. Integrated and committed, CI green; pending screenshots viewed and reviewer pass.
- [ ] Verified here: two-peer browser test through the real UI (`e2e/ride.spec.ts`) passes (done: CI web-e2e job green); pair, home, ride and diagnostics screenshots viewed (open). (Lead, after integration.)
- [ ] (hw) Owner: `docs/TESTING.md` M1 items 1-14: two phones on one Wi-Fi router or a third phone's hotspot, Bluetooth earbuds each, 10-minute two-way conversation with screens off, plus permissions, headset off/on, Wi-Fi range drop and return, mute, notification actions, export without secrets, loopback, battery. A hotspot hosted by one of the two phones is NOT expected to work yet (risk 1).

### M2 No router needed - STATUS: not started

`WifiDirectTransport` from the pairing credentials (risk 1), automatic transport choice, reconnect for the whole ride, correct permission flow from Android 10 to current. (hw) walk apart until the link drops, walk back: reconnects within 5 s.

### M3 Ride-grade reliability - STATUS: not started

Screen off / app switching / Doze / 60-minute ride, interruptions (phone call, headset), onboarding with each permission explained, safety notice, battery-optimisation guidance per manufacturer, audio cue for every state change. (hw) real 60-minute ride on two phone brands.

### M4 Road audio quality - STATUS: not started

Tune NS/AGC/Opus for wind and engine noise via the runtime tunables, voice-activated transmit, music/navigation coexistence (ducking), standby mode investigation. (hw) rides at city and highway speeds.

## Stage 2: online groups

### M5 Rooms over the internet - STATUS: not started

Room service + LiveKit (Docker), RoomService client + second MediaEngine mode; two browser contexts join one room. No `server/` before this milestone.

### M6 Couple inside a group - STATUS: not started

Both phones join the room, keep the local link, unsubscribe from the partner's room audio, "private" toggle.

## Stage 3: hybrid bridge

### M7 Pillion joins through the rider's phone - STATUS: not started

Design document first: compare (a) pillion on the rider's hotspot, (b) both phones join independently, (c) native PCM audio bridge; recommend one before building.

## Later

iOS (same TypeScript core; offline link over a shared hotspot first); release work (Play Store foreground-service declarations, privacy policy, crash reporting).

## Session log

- 2026-11-16: pre-flight (SDK, hosts, versions), scaffold, contracts, docs, subagent definitions. Push access to the repo was refused at session start (Claude GitHub App not installed on the repo); work is committed locally on `claude/m0-foundation`.
- 2026-11-17 to 2026-11-24: M1 on `claude/m1-lan-voice`: real QR pairing; native LAN link, audio route and ride service (Kotlin + TS wrappers, JVM and Jest tests); live ride, diagnostics, loopback and tunables screens; M1 device checklist in `docs/TESTING.md`.
