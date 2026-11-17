# AGENTS.md

Instructions for any coding agent (Codex, Claude Code, others) working in this repository.

## Read first, in this order

1. `docs/HANDOFF.md`: where the work stands right now, what is in flight, what to do next. **Start here.**
2. `CLAUDE.md`: project summary, commands, architecture rules, frozen contracts. Its rules apply to every agent, not only Claude.
3. `docs/PLAN.md` (milestone status), `docs/ARCHITECTURE.md` (layers, ownership, state machine, protocol), `docs/DECISIONS.md` (every decision with its reason; deviations from the brief are marked).
4. `docs/BRIEF.md`: the original product brief. It is the authority and is never edited.

## Non-negotiable rules (summary of CLAUDE.md)

- `src/core` is pure TypeScript: no react / react-native / expo imports. It may import only the platform interface files listed in `eslint.config.js`. Every change to `src/core` comes with tests.
- Frozen contracts (listed in CLAUDE.md) change only deliberately, with the reason recorded in `docs/DECISIONS.md`.
- `src/platform/<area>`: interface file, `create<X>.ts` (native) + `create<X>.web.ts` (web twin), shared `index.ts`. Web-only code must never be imported by native code.
- Native Kotlin lives in the local Expo module `modules/intercom-native`, never hand-edited inside `android/` (regenerate it with `npm run prebuild:android`).
- Product name and Android application id live only in `config/identity.json`.
- Never log, export, commit or screenshot the pairing secret or the Wi-Fi passphrase.
- Hardware cannot be verified by an agent: say "compiles and unit-tested, untested on device" and write the exact device test in `docs/TESTING.md`.
- Before every commit: `npm run typecheck && npm run lint && npm run format:check && npm test` must pass. After UI changes also run `npm run web:build && npm run e2e` and look at the screenshots in `e2e/.artifacts/`.

## Git and GitHub

- Work branch: `claude/m0-foundation` (PR #2 into `main`). `main` is protected: PR only, the three CI jobs must pass (strict), all review conversations resolved, no force push.
- Commit in small steps with clear messages. Do not rewrite pushed history.

## Local machine notes (outside the cloud sandbox)

- Node 22, JDK 21, Android SDK with platform 37, build-tools 37.0.0, NDK 27.1.12297006 (Gradle/AGP can auto-install these). Set `ANDROID_HOME` to your SDK.
- The cloud-only Maven mirror (`~/.gradle/init.d/00-central-mirror.gradle`) is not needed locally.
- `@playwright/test` is pinned to 1.63.0; run `npx playwright install chromium` once locally.
