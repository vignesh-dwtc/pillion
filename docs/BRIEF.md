# Build Pillion: a phone-to-phone intercom for motorcycle rider and pillion

## What I'm building and why

A rider and pillion on the same motorcycle can't hear each other through helmets and wind noise. Dedicated helmet intercoms solve this but are expensive. Most people already carry a phone and Bluetooth earbuds, so this app turns those into an intercom: each person keeps their own phone in a pocket, wears their own earbuds under the helmet, and the two phones carry a live, two-way voice link.

The first users are couples on one bike in India, mostly on Android, often on highways with no mobile signal. The core experience therefore has to work fully offline, hands-free, with the screen off, for hours at a time.

The product has three stages. Design for all three, but build only what the current milestone asks for:

1. **Offline pair.** Rider and pillion on one bike, direct phone-to-phone link, no internet.
2. **Online groups.** Several bikes talk to each other over mobile data through a relay server.
3. **Hybrid.** The couple's local link keeps working inside a group ride and survives when the signal drops.

"Pillion" is a working name. Keep the display name and application ID in one place so I can rename it later.

## How we work together

I'm an experienced React Native developer (about five years, including New Architecture TurboModules and native modules). Write production-grade code and don't simplify the architecture for my sake. I review the pull requests and run every hardware test myself on two real Android phones with Bluetooth earbuds.

You're running in a cloud session and I'm not watching live, so:

- **Don't stop to ask me questions.** When something is ambiguous, make the reasonable choice, record it in `docs/DECISIONS.md` with a one-line reason, and list it in your final report.
- **Verify anything in this prompt that names an API, library or version before you rely on it.** I wrote it from research, and libraries move. Check current docs and source (npm metadata, GitHub, developer.android.com). If something here is wrong or outdated, do the right thing and tell me what you changed.
- **Never claim hardware behaviour works.** You can't test it. Say "compiles and unit-tested, untested on device" and give me the exact test to run.

## Your environment and its limits

You have a Linux VM with Node and a JDK. You have no Android device or emulator, no Bluetooth, no Wi-Fi radio and no audio hardware. That shapes the whole project:

- **Push logic into pure TypeScript** where Jest can test it: protocol, state machines, reconnect policy. Keep native code thin.
- **Verify the app yourself in a browser.** The app also builds for web through Expo (React Native Web). Run the web build in the session, drive it with Playwright in headless Chromium, and look at the screenshots of every screen you touched. Fix what you see before you call anything done. The "Web verification target" section below says how. If Playwright can't download a browser because of the network allowlist, use a browser already installed on the VM, and tell me which host was blocked.
- **Check for the Android SDK first** (`ANDROID_HOME`, `sdkmanager`). If it's missing, try to install the command-line tools, a platform and build-tools. Google's SDK and Maven downloads may be blocked by the session's network allowlist. If they are, don't work around it: tell me exactly which hosts were blocked, and rely on CI for Android compilation until I fix the environment.
- **Write `scripts/cloud-setup.sh`**, a script I can paste into the cloud environment's setup-script field so later sessions start with the Android SDK installed. It must finish in under five minutes and exit zero.
- **Set up GitHub Actions** to run typecheck, lint, Jest, the web end-to-end tests and an Android debug build on every push, and to upload the debug APK as an artifact (arm64 only is fine). That APK is what I install on the test phones. If the push is rejected because you aren't allowed to create workflow files, leave the workflow out of the push and give me the file to add by hand.
- **Make my device testing efficient.** Every milestone ships with a checklist in `docs/TESTING.md`, and the app has a diagnostics screen with an export (described below), so I can paste real results into the next session.

## Constraints that are already settled

Don't spend time re-investigating these:

- **Two phones, not one.** A phone exposes a pair of earbuds as a single audio device with a single microphone stream, so one phone can't treat the left and right bud as two people. Each person uses their own phone and their own headset (one bud or both).
- **Voice-call audio mode.** A Bluetooth headset's microphone is only available in the call profile (HFP/SCO, or LE Audio on newer devices). Audio quality in that mode is limited, and that's expected.
- **Stage 1 has no server, no accounts and no internet dependency** of any kind, including at pairing time.
- **Hands-free.** The phone is in a pocket and the rider wears gloves. Background reliability and audio cues matter more than UI polish.
- **Privacy.** No audio is ever recorded or stored. No analytics in stage 1.

## Technical decisions

- **Platform.** Android first, `minSdk 29` (Android 10), because the Wi-Fi Direct join-with-credentials API needs it. Target the latest stable SDK. Keep the TypeScript platform-neutral, and do no iOS work until a milestone asks for it.
- **App.** Expo with development builds (not Expo Go), TypeScript in strict mode, New Architecture, Hermes. Run `expo prebuild` for Android and commit the `android/` folder, so the Kotlin modules live in the app. Use the newest stable Expo SDK whose React Native version the chosen WebRTC package supports. Web is a verification target for you, not a product I will ship.
- **Media.** WebRTC, audio only, Opus mono. It gives us a jitter buffer, packet-loss concealment, noise suppression, gain control and encryption without writing any DSP. Evaluate `react-native-webrtc`, `@livekit/react-native-webrtc` and `@stream-io/react-native-webrtc`. Prefer the LiveKit fork if it works, because stage 2 will use LiveKit and two WebRTC builds in one app conflict. Offline mode uses no STUN or TURN: host candidates only.
- **Link.** A `LinkTransport` interface with two implementations:
  - `LanTransport` (M1): both phones are on the same Wi-Fi network. The host advertises over NSD/mDNS and the guest discovers it.
  - `WifiDirectTransport` (M2): the host creates a Wi-Fi Direct group using a network name and passphrase from pairing, and the guest joins with the same credentials. This needs no router and no hotspot, and should avoid the system invitation dialog.
- **Signaling.** A small TCP channel over the same link: length-prefixed JSON with a protocol version. Both sides prove knowledge of the pairing secret before anything else is accepted, and every later message is authenticated. It carries SDP, ICE candidates, heartbeats and peer state (muted, battery, headset connected).
- **Roles.** The phone that displays the pairing QR is the host (normally the rider's). The phone that scans it is the guest. The host owns the link and the signaling server.
- **Pairing.** One-time and offline. The QR holds a pair ID, a 32-byte secret, the host's display name, the Wi-Fi Direct credentials and the protocol version. Store it in Keystore-backed storage. One partner for now, but don't design the data model so it can only ever hold one.
- **Native code.** App-local Kotlin TurboModules with codegen specs (or local Expo modules if they fit better), kept thin:
  - `Link`: NSD, TCP sockets, Wi-Fi Direct.
  - `AudioRoute`: communication audio mode and headset selection.
  - `RideService`: foreground service, wake and Wi-Fi locks, notification actions.

  Prefer first-party Kotlin to wrapper libraries that are stale or don't support the New Architecture.
- **App libraries.** My defaults are Zustand, React Navigation and MMKV. Swap any of them if you have a reason.
- **Not building.** Google Nearby Connections (it doesn't expose an IP link, so WebRTC can't run over it), audio over BLE, and Wi-Fi Aware (patchy device support). Note them in `docs/DECISIONS.md` as options to revisit if Wi-Fi Direct proves unreliable.

### Audio rules

- On session start, switch to communication mode and route to the best available device: Bluetooth headset first (LE Audio or SCO), then wired headset. Use `setCommunicationDevice` on API 31 and above, and the legacy SCO calls on 29 and 30. Follow device changes while the session runs, and restore everything on stop.
- No headset connected is an error state in the UI, with a developer override that allows the earpiece or speaker for bench testing.
- This is an always-on intercom, so it must not pause the rider's music or navigation for the whole ride. Don't hold exclusive audio focus. Smarter behaviour (ducking while the partner speaks) comes in M4.
- Every audio tunable lives in one config object that a hidden debug screen can change at runtime: noise suppression, gain control, echo cancellation, Opus bitrate, FEC, DTX. I need to tune these on the road without rebuilding.

### Diagnostics

- A diagnostics screen showing session state, transport in use, local network interfaces, gathered and selected ICE candidates, round-trip time, jitter, packet loss, bitrate, input and output audio levels, current audio route and battery.
- A ring-buffer log of state transitions and errors, kept across app restarts.
- A "share diagnostics" action that exports all of it as text through the system share sheet. Never include the pairing secret or Wi-Fi passphrase in logs or exports.
- A loopback self-test that plays my own microphone back through the headset over a local WebRTC connection, so I can check audio routing with one phone.

### Web verification target

The web build exists so you can check your own work. Every interface in `src/platform` gets a web implementation in a `.web.ts` file:

- `MediaEngine`: the browser's own WebRTC, so offer, answer, ICE and real audio packets are exercised for real.
- `LinkTransport`: a `WebLinkTransport` that talks through a small local WebSocket relay script (dev only), so two browser contexts can play host and guest.
- `AudioRoute` and `RideService`: fakes that report plausible state. A dev panel, on web only, can trigger "headset disconnected", "link dropped" and "phone call started", so you can see how the UI and state machine react.
- Pairing: the "paste pairing string" path, since there is no camera.

Playwright tests live in `e2e/` and run at a phone-sized viewport:

- A smoke test that opens every screen and saves a screenshot.
- A two-peer test that launches two browser contexts with Chromium's fake microphone, pairs them, starts a ride, and asserts through WebRTC stats that audio bytes flow in both directions. It then mutes, drops the link, waits for recovery and ends the ride.

Extend these tests in every milestone for whatever part of the work can run on web.

Be clear about the limits. Web proves the UI, the flows, the session logic, signaling and WebRTC negotiation. It proves nothing about Bluetooth routing, Wi-Fi Direct, the foreground service or background behaviour, and those still need my phones. Web-only fakes must never end up in the Android bundle.

## Known risks

Treat these as leads to verify, not as facts:

1. **WebRTC may not see the link's network interface.** On Android, libwebrtc's network monitor reportedly ignores hotspot (tethering) interfaces, and only includes Wi-Fi Direct interfaces when asked to (`NetworkMonitorAutoDetect.setIncludeWifiDirect`, or an `IncludeWifiDirect` field trial in older builds). If ICE gathers no host candidate on the link interface, the call never connects. Likely fixes: a custom `NetworkChangeDetectorFactory`, the field trial, or disabling the network monitor. This matters most in M2. The diagnostics screen has to list every local interface and every gathered candidate so I can confirm it on a device.
2. **WebRTC packages and the New Architecture.** The React Native WebRTC packages have historically relied on the interop layer. Confirm that the one you pick builds on the React Native version you pick, and let that drive the React Native version.
3. **Bluetooth and 2.4 GHz Wi-Fi share a band**, and both phones are also running a Bluetooth call link. Ask for a 5 GHz Wi-Fi Direct group and fall back if the device refuses.
4. **Background killing.** Xiaomi, Oppo, Vivo, Realme and Samsung builds kill background apps aggressively, and those are the most common phones among my users. The foreground service has to be correct, and M3 adds per-manufacturer guidance.
5. **Foreground service rules.** A microphone foreground service can't be started from the background, so a ride always begins with a tap in the app. Declare the correct service types and permissions for current Android versions.
6. **Wind noise is the biggest quality risk** and can only be tuned in the field. Hence the runtime tunables.

## Code structure

```
src/
  core/          Pure TypeScript. No react-native imports. Fully unit-tested.
    protocol/      Message schemas, framing, auth handshake
    pairing/       Pairing payload: encode, decode, validate
    session/       Session state machine, reconnect and backoff policy
    diagnostics/   Stats sampling, ring-buffer log
  platform/      Interfaces plus implementations: native (.ts) and web (.web.ts)
    link/          LinkTransport, LanTransport, WifiDirectTransport
    media/         MediaEngine, WebRtcMediaEngine
    audio/         AudioRoute
    service/       RideService
  features/      Screens: onboarding, pair, home, ride, settings, diagnostics
  app/           Navigation, theme, store
specs/           TurboModule codegen specs
e2e/             Playwright tests against the web build
server/          Room service (from M5 only)
android/         Kotlin implementations
docs/            BRIEF.md, PLAN.md, ARCHITECTURE.md, DECISIONS.md, TESTING.md
scripts/         cloud-setup.sh, dev WebSocket relay for web
CLAUDE.md
```

The session state machine in `core/session` drives everything. Its states are `idle`, `starting`, `linking`, `signaling`, `connecting`, `connected`, `reconnecting` and `ended`, with `connected` and `reconnecting` alternating for as long as the ride is active. It talks to `LinkTransport` and `MediaEngine` only through interfaces.

Write in-memory fakes of both interfaces, and use them for a two-peer simulation test that runs a host and a guest against each other, drops the link mid-call, and asserts that both sides recover. This harness is the main way you can prove correctness without hardware, so invest in it.

## Plan

Stage 1 is finished when two people can pair once, tap Start on each phone, and talk through an hour-long ride with both phones in pockets and no mobile signal.

### Stage 1: offline pair (Android)

**M0. Foundation**

- Expo app scaffolded with strict TypeScript, ESLint, Prettier and Jest, building for Android and web.
- This prompt saved unchanged as `docs/BRIEF.md`. `docs/PLAN.md` is the living version of the plan, with a status line per milestone, so later sessions need only "read CLAUDE.md and docs/PLAN.md".
- `CLAUDE.md` under about 80 lines: what the project is, the commands, the architecture rules, the fact that hardware can't be tested in the cloud, and pointers to the docs.
- `core/` implemented with tests: protocol, pairing payload, session state machine, reconnect policy, two-peer simulation.
- App shell: navigation, placeholder screens, and a theme that is dark, high-contrast and uses large touch targets.
- The web build runs in the session, and the Playwright smoke test passes. You have looked at the screenshots.
- CI workflow and `scripts/cloud-setup.sh`.
- The WebRTC package and React Native version chosen and recorded, with the evidence.

**M1. First voice on the same Wi-Fi**

- QR pairing: the host shows it, the guest scans it. Include a dev-only "paste pairing string" path.
- `LanTransport`, signaling, `WebRtcMediaEngine`, `AudioRoute` and a minimal `RideService`.
- Home and ride screens: start, mute, end, connection status. Short audio cues for connected and disconnected.
- Diagnostics screen, export and loopback self-test.
- You verify: the two-peer browser test passes, and the pair, home, ride and diagnostics screens look right in screenshots.
- I verify: two phones joined to one Wi-Fi router or a third phone's hotspot, each with Bluetooth earbuds, hold a two-way conversation for 10 minutes with the screens off. Don't expect a hotspot hosted by one of the two phones to work yet (risk 1).

**M2. No router needed**

- `WifiDirectTransport` using the credentials from pairing. Deal with risk 1.
- Automatic transport choice: use the shared network if both phones are on one, otherwise Wi-Fi Direct.
- Reconnect: when the link drops, both sides retry with backoff for as long as the ride is active, and recover without anyone touching a phone.
- A permission flow for Wi-Fi Direct that is correct from Android 10 to the current version.
- I verify: no router, no hotspot, no mobile data. Start a ride, walk apart until the link drops, walk back, and it reconnects within 5 seconds of being in range.

**M3. Ride-grade reliability**

- Survives screen off, app switching, Doze and a 60-minute ride.
- Interruptions: a phone call pauses the intercom and tells the partner, then the intercom resumes. Headset disconnects and reconnects are handled.
- Onboarding with each permission explained, a one-time safety notice, and battery-optimisation guidance per manufacturer.
- An audio cue for every state change, since nobody is looking at the screen.
- I verify: a real 60-minute ride on at least two phone brands.

**M4. Road audio quality**

- Tune noise suppression, gain and Opus settings for wind and engine noise, using the runtime tunables.
- Voice-activated transmit, so idle microphones don't send wind noise.
- Music and navigation coexistence: duck other audio while the partner speaks. Investigate a standby mode that releases the call link during long silences so music returns to full quality, with a way to wake it.
- I verify: rides at city and highway speeds.

### Stage 2: online groups

**M5. Rooms over the internet.** Build the backend described in "Backend" below, then the app side: create a room, share a code or QR, and others join over mobile data. Reconnects across network changes. You verify: LiveKit in dev mode and the room service running in Docker in the session, with two browser contexts joining one room through the web build and audio flowing both ways.

**M6. Couple inside a group.** Both phones join the room while keeping their local link. Each phone unsubscribes from its partner's room audio, so the couple hear each other only over the low-latency local path. Add a "private" toggle that stops the couple's audio going to the group.

#### Backend

Stage 1 has no backend at all. Don't create `server/` or any server dependency before M5. From M5 the backend has two parts:

- **Media relay.** LiveKit, an open-source WebRTC relay server. Use a hosted LiveKit project to start, in a region close to India, and keep self-hosting possible by depending only on the open-source server's features. Audio only. The relay forwards audio and never records it.
- **Room service.** A small TypeScript HTTP service in `server/`, shipped as one Docker container that can run on any container host. It is the only place the LiveKit API secret lives. Endpoints:
  - Create a room: returns a short room code.
  - Join a room by code: takes a device ID and display name, and returns the LiveKit URL and a short-lived access token scoped to that room.
  - Health check.

Rules for the room service:

- No accounts, no passwords, no personal data beyond a display name. Identity is an anonymous device ID generated by the app.
- Keep it stateless if you can: let LiveKit be the source of truth for which rooms exist, and add a store such as Redis only if something really needs it.
- Rooms expire when empty, and after a maximum lifetime.
- Rate-limit creation and join attempts, and make room codes long enough that guessing one is impractical.
- Configuration through environment variables only. No secrets in the repo or in the app.
- Tests: unit tests for token and code logic, plus an integration test against LiveKit in dev mode in Docker.
- A `docker-compose.yml` that starts LiveKit in dev mode and the room service together, for local work and for CI.

The app reaches the backend only through a `RoomService` client and a second `MediaEngine` mode, so stage 1 code doesn't change.

### Stage 3: hybrid bridge

**M7. The pillion joins through the rider's phone**, so the pillion needs no mobile data. Start with a design document, because WebRTC doesn't forward a received audio track into another connection for free. Compare three approaches: (a) the pillion's phone reaches the internet through the rider's hotspot, which needs no audio bridging; (b) both phones join independently, as in M6; (c) a true audio bridge with PCM mixing in native code. Recommend one before building anything.

### Later

- **iOS.** Same TypeScript core. Offline link over a shared hotspot first.
- **Release.** Play Store foreground-service declarations, privacy policy, crash reporting.

## Split the work across subagents

Don't do this as one long single-agent run. You are the lead: you plan, define the contracts, delegate, integrate and review. Split every milestone's work across at least six subagents, each with its own context, and run them in parallel wherever their work doesn't overlap.

Create these as project subagents in `.claude/agents/` (check the current file format in the Claude Code docs) so that later sessions reuse them:

| Subagent | Owns | Job |
|---|---|---|
| `foundation` | Project config, CI, `scripts/`, `docs/` | Expo scaffold, tooling, GitHub Actions, `cloud-setup.sh`, keeping the docs current |
| `core-protocol` | `src/core/protocol`, `src/core/pairing` | Message schemas, framing, auth handshake, pairing payload, with tests |
| `core-session` | `src/core/session`, `src/core/diagnostics` | State machine, reconnect policy, in-memory fakes, two-peer simulation |
| `android-native` | `android/`, `specs/` | Kotlin modules: `Link`, `AudioRoute`, `RideService`, with JVM tests |
| `media` | `src/platform/media`, `src/platform/audio` | WebRTC media engine, audio rules, runtime tunables |
| `ui` | `src/features`, `src/app` | Screens, navigation, theme, store |
| `web-verify` | `.web.ts` implementations, `e2e/` | Web stand-ins, dev panel, Playwright tests, screenshots |
| `backend` | `server/`, `docker-compose.yml` | Room service, LiveKit dev setup, backend tests (from M5 only) |
| `reviewer` | Nothing (read-only) | Reviews each subagent's result against this brief before you integrate it |

Rules for delegating:

- **Contracts first.** Before you fan out, you write the shared TypeScript interfaces (`LinkTransport`, `MediaEngine`, `AudioRoute`, `RideService`, the protocol message types) and the project scaffold yourself, and commit them. Subagents build against those contracts and don't change them. If one needs a contract change, it reports back and you make it.
- **One owner per directory.** A subagent edits only the paths it owns in the table. That is what makes parallel work safe.
- **Brief each subagent properly.** It starts with no memory of this prompt. Give it the goal, the relevant parts of this brief, the contracts, its owned paths, and what "done" means, including the checks it must run.
- **Subagents report evidence, not claims.** Each one returns what it changed, which checks it ran and their results, and what it could not verify.
- **You integrate.** After the subagents finish, run the full check suite yourself, have `reviewer` look at the combined result, and fix what the seams reveal.
- If a milestone has less work than the full team needs, still use at least six, and say in your report which ones you used and for what.

## What to do in this session

The repository is empty apart from a README.

1. Read this whole prompt, then write `CLAUDE.md`, the docs, the scaffold, the shared contracts and the subagent definitions yourself, before any feature code.
2. Complete M0 by delegating to the subagents as described above.
3. Continue into M1 only if you can compile the Android code in this session (SDK installed and the Kotlin compile task passing). Native code you can't compile isn't worth writing yet. If you can't, stop after M0 and tell me what to change in the environment.
4. Stop at the end of M1 at the latest. I test on devices between milestones.

Working rules:

- Keep `src/core` free of `react-native` imports, and add tests with every change to it.
- After any UI or flow change, run the web build, take screenshots and check them yourself. Don't hand me a screen you haven't looked at.
- Add JVM unit tests for any Kotlin logic that isn't a direct platform call.
- Check that a library is maintained and works with the New Architecture before adding it. Fewer dependencies is better.
- Commit in small steps with clear messages. Before you finish, typecheck, lint, Jest, the web end-to-end tests and the Android compile (if available) must all pass. Then push the branch and open a pull request.

## Your final report

Keep it short and lead with what I need to do next:

1. What's done, by milestone, and which subagent did each part.
2. What you verified and how (include the key web screenshots in the pull request), and what is untested on hardware.
3. The device test checklist for me, or a pointer to it in `docs/TESTING.md`.
4. Decisions you made on my behalf, and anything in this prompt you found to be wrong.
5. Environment changes I should make (blocked hosts, setup script).
6. Open questions that would change the next milestone.
