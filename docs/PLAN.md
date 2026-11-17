# Plan (living)

Later sessions need only: "read CLAUDE.md and docs/PLAN.md". Legend: `[x]` done and verified as stated, `[~]` in progress, `[ ]` not started. **(hw)** = needs the owner's phones; nothing marked (hw) has been run on a device.

The brief (`docs/BRIEF.md`) defines the milestones; this file tracks status. Update the status line of a milestone whenever its state changes.

## Stage 1: offline pair (Android)

### M0 Foundation - STATUS: done pending review fixes and a green GitHub Actions run (started 2026-11-16)

- [x] Brief saved unchanged as `docs/BRIEF.md`.
- [x] Android SDK installed; Kotlin compile gate passes on Expo SDK 58 / RN 0.88.1 with the LiveKit WebRTC fork (DECISIONS E-3). M1 is allowed to proceed.
- [x] WebRTC package and React Native version chosen and recorded with evidence (DECISIONS D-002, D-004, E-1..E-4).
- [x] Scaffold: strict TypeScript, ESLint with architecture rules, Prettier, Jest (Node), Playwright config skeleton, identity in one file.
- [x] Shared contracts committed (see CLAUDE.md "Contracts") and subagent definitions in `.claude/agents/`.
- [x] `core/` implemented with tests: protocol, pairing payload, session state machine, reconnect policy, two-peer simulation (56 Jest suites, 1068 tests; real-protocol two-peer test included).
- [x] App shell: navigation, placeholder screens, dark high-contrast theme with large touch targets (8 routes; screenshots in e2e/.artifacts/screens, viewed by ui, web-verify and the ui-web reviewer).
- [x] Web build runs; `npm run e2e` passes 13/13 (smoke of every route + two-peer WebRTC with audio bytes both ways, mute, link drop, recovery).
- [x] CI workflow `.github/workflows/ci.yml` written (checks, web-e2e, android); YAML-parsed and reviewed by hand, NOT yet run on GitHub (actionlint could not be run here). `scripts/cloud-setup.sh` tested against a fresh temp SDK: clean install 24 s, idempotent re-run <1 s, exit 0 (DECISIONS D-029..D-032).
- [x] Full `assembleDebug` (arm64) verified in the session: BUILD SUCCESSFUL in 2m 13s, 112 MB debug APK (DECISIONS E-3).

### M1 First voice on the same Wi-Fi - STATUS: not started

- [ ] QR pairing (host shows, guest scans) + dev-only paste string.
- [ ] `LanTransport`, signaling, `WebRtcMediaEngine`, `AudioRoute`, minimal `RideService`.
- [ ] Home and ride screens (start, mute, end, status); audio cues for connected/disconnected.
- [ ] Diagnostics screen, export, loopback self-test, runtime audio tunables screen.
- [ ] Verified here: two-peer browser test passes; pair, home, ride, diagnostics screens viewed in screenshots.
- [ ] (hw) Owner: two phones on one Wi-Fi router or a third phone's hotspot, Bluetooth earbuds each, 10-minute two-way conversation with screens off. A hotspot hosted by one of the two phones is NOT expected to work yet (risk 1). See `docs/TESTING.md`.

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
