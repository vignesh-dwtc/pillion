# CLAUDE.md

Pillion (working name; see `config/identity.json`) is a phone-to-phone intercom for a motorcycle rider and pillion. Each person keeps their own phone in a pocket and wears their own earbuds; the phones carry a live two-way voice link (WebRTC audio, Opus mono) over a direct link: offline, hands-free, screen off, for hours. Android first. Expo SDK 58 / React Native 0.88 (New Architecture, Hermes), TypeScript strict.

Start every session: read this file, then `docs/PLAN.md` (living plan, one status line per milestone), `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`. The original brief is `docs/BRIEF.md` (immutable; it is the authority).

## Commands

```
npm run typecheck | lint | format:check | test     # all must pass before any commit (npm run check runs them)
npm run web:build && npm run e2e                   # web target + Playwright (headless Chromium, phone viewport)
npm run prebuild:android                           # regenerate android/ from app.config.ts + plugins
export ANDROID_HOME=/opt/android-sdk
npm run android:compile                            # Kotlin compile gate (:app:compileDebugKotlin)
npm run android:test                               # Kotlin JVM unit tests
npm run android:assemble                           # debug APK, arm64 only
```

## Architecture rules (lint-enforced where marked *)

- `src/core` is pure TypeScript: no react / react-native / expo imports\*, and it may import only the platform _interface_ files\* (allowlist in `eslint.config.js`). Every change to `src/core` comes with tests.
- `src/platform/<area>`: interface + native `.ts` + web `.web.ts` implementations, one factory `index.ts` / `index.web.ts` per area. Web-only code is never imported from native code\* and must not reach the Android bundle.
- The session state machine (`src/core/session`) drives everything and talks to `LinkTransport` and `MediaEngine` only through interfaces; in-memory fakes live in `src/core/session/testing`.
- Native Kotlin is thin (byte pipe, audio routing, foreground service) and lives in local Expo modules under `modules/`, never hand-edited inside `android/`. Anything that is not a direct platform call is plain Kotlin with JVM tests.
- Product name and Android application ID live only in `config/identity.json`.
- Stage 1: no server, accounts, analytics or internet dependency; no audio is ever recorded or stored. No `server/` before M5.
- Never log or export the pairing secret or the Wi-Fi passphrase.

## Contracts (frozen: change only through the lead)

`src/core/common/types.ts`, `src/core/{pairing,session,diagnostics}/types.ts`, `src/core/protocol/{constants,messages,crypto,secureChannel}.ts`, `src/platform/{link/LinkTransport,media/MediaEngine,audio/AudioRoute,audio/AudioTunables,service/RideService,permissions/PermissionService,storage/stores}.ts`, `specs/*`.

## Hardware cannot be tested in the cloud

No device, Bluetooth, Wi-Fi radio or audio hardware here. Say "compiles and unit-tested, untested on device" and put the exact device test in `docs/TESTING.md`. Web (Playwright) proves UI, flows, session logic, signaling and WebRTC negotiation only.

## Working rules

- One owner per directory (table in `docs/ARCHITECTURE.md`; definitions in `.claude/agents/`). The lead plans, owns contracts, integrates, runs the full suite and has `reviewer` look at the combined result. Only the lead does git operations.
- Small commits with the checks green. After a UI or flow change: web build, screenshots, look at them.
- Verify library and API claims against current docs or source before relying on them; record each decision with a one-line reason in `docs/DECISIONS.md`.
- Reports carry evidence (commands and results), not claims.

## Cloud environment

Android SDK in `/opt/android-sdk` (`scripts/cloud-setup.sh`). Maven Central answers 429 to the shared egress, so cloud sessions mirror it through `~/.gradle/init.d/00-central-mirror.gradle` (written by `cloud-setup.sh`, not part of the repo; CI uses real Central). `@playwright/test` is pinned to the Chromium preinstalled in the cloud image. `scripts/fetch-doc.sh <url>` prints a web page as text.
