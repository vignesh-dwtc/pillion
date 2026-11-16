# Testing

## 1. Checks that run everywhere (cloud session and CI)

```
npm run typecheck
npm run lint
npm run format:check
npm test                                  # Jest: src/core + logic-only platform code (Node environment)
npm run web:build && npm run e2e          # web build + Playwright (headless Chromium, phone viewport, fake microphone)
export ANDROID_HOME=/opt/android-sdk
npm run android:compile                   # Kotlin compile gate
npm run android:test                      # Kotlin JVM unit tests
npm run android:assemble                  # debug APK (arm64)
```

## 2. What each layer proves

| Layer                                 | Proves                                                                                                                           | Does NOT prove                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Jest `src/core` + two-peer simulation | protocol, handshake, pairing, state machine, reconnect/backoff, diagnostics, recovery after a dropped link (in-memory fakes)     | real sockets, real WebRTC, any hardware                                                       |
| Playwright on the web build           | UI and flows, session logic end to end, signaling, real browser WebRTC negotiation and audio bytes in both directions (fake mic) | Bluetooth routing, Wi-Fi Direct, the foreground service, background behaviour, the RN interop |
| Kotlin compile + JVM tests            | the native code compiles; non-platform logic is correct                                                                          | any behaviour that touches Android audio/Wi-Fi/service APIs                                   |
| Device (owner, two phones + earbuds)  | everything else                                                                                                                  |                                                                                               |

## 3. Device test checklist

Filled in per milestone (M1 first). Each item says exactly what to do and what to paste back into the next session. Until a milestone's checklist exists here, nothing about it has been tested on hardware.

### M1 - first voice on the same Wi-Fi (to be completed with the M1 build)

_Placeholder. The M1 checklist, the APK location and the paste-back template are added when M1 is built._

## 4. Pasting results into the next session

Use the diagnostics screen's "Share diagnostics" action on both phones after each test and paste the text. Add: phone models and Android versions, headset models, Wi-Fi router/hotspot used, what you heard (one-way, echo, dropouts, wind noise), and the time of any failure. The export never contains the pairing secret or the Wi-Fi passphrase.
