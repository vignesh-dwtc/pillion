# Testing

## 1. Checks that run everywhere (cloud session and CI)

```
npm run typecheck
npm run lint
npm run format:check
npm test                                  # Jest: src/core + logic-only platform code (Node environment)
npm run web:build && npm run e2e          # web build + Playwright (headless Chromium, phone viewport, fake microphone)
npm run check:bundle                      # exports the Android (Hermes) bundle, fails if any web-only module reached it
npm ci                                    # clean, lockfile-exact install (what CI runs first)
bash scripts/cloud-setup.sh               # cloud sessions: SDK + Gradle mirror (idempotent; CLOUD_SETUP_SKIP_ENV=1 skips shell-profile edits)
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

### Claims that are unit-tested only

These rest on Jest alone; no e2e test and no device run has checked them against the real app yet.

- **"The diagnostics export never contains the pairing secret or the Wi-Fi passphrase."** Covered by `src/core/diagnostics/redact.test.ts` (key- and value-based redaction, pairing strings, glued secrets, passphrase literals) and `src/core/diagnostics/formatReport.test.ts` (the report builder redacts every field). In M0 the diagnostics screen exports sample data, so the real path (live log + stored pairing -> report -> share sheet) has not run. The M1 device check below closes this; the Wi-Fi passphrase part can only be checked from M2 (Wi-Fi Direct), when the app first holds one.

## 3. Device test checklist

Filled in per milestone (M1 first). Each item says exactly what to do and what to paste back into the next session. Until a milestone's checklist exists here, nothing about it has been tested on hardware.

### M1 - first voice on the same Wi-Fi (to be completed with the M1 build)

_Placeholder. The M1 checklist, the APK location and the paste-back template are added when M1 is built._

#### M1 slice 1 - real QR pairing (compiles and unit-tested, web-verified, untested on device)

Two phones, A (host) and B (guest), fresh install on both unless stated. Paste back one line per item: pass/fail plus what you saw.

1. **Scan host -> guest.** A: Settings > name "Robin"; Home > Pair your pillion. Expected: a real QR on the plate with "Robin" under it, no "Sample code" badge. B: Home > Scan partner's plate. Expected: an explanation and "Allow camera" BEFORE any system dialog; tap it, allow. Expected: live camera inside the brass frame; aim at A's plate. Expected within 2 s: a vibration, the dial animates, "Paired with Robin", then Home on its own after about 4 s showing "Paired with Robin · You scanned the code (guest) · Since <today>". A: tap Done; Home shows "Paired with your partner · You showed the code (host)".
2. **Deny, then grant camera.** Fresh B: open Scan, tap Allow camera, choose "Don't allow". Expected: "Camera not allowed" and "Allow camera" again (no settings link yet). Tap it, allow. Expected: live preview without leaving the screen.
3. **Blocked permission.** Fresh B: deny twice (Android turns the second denial into "don't ask again"). Expected: "Camera blocked" and "Open settings". Tap it, enable Camera in the app's permission page, press Back. Expected: the live preview appears without reopening the screen.
4. **Worst-case QR at arm's length.** A: Settings name of 24 wide characters (for example 24 x "W", then try 12 emoji). Show the plate at full brightness; B scans from 20-30 cm, then from arm's length (about 60 cm), indoors and in daylight. Paste back the farthest distance that still pairs and the seconds it took.
5. **Wrong QR.** B: point the scanner at any other QR (a URL, a Wi-Fi code). Expected: one friendly "That is not a pairing plate" message (no flicker, no repeated vibration) and scanning continues; then scan A's plate and it pairs.
6. **Restart keeps the pairing.** Swipe the app away on both phones (or reboot). Reopen. Expected: Home shows the same partner and date immediately; A's pairing screen shows the same QR as before (reused offer) until New code is tapped.
7. **New code.** A: Pair your pillion > New code. Expected: a different QR and "The previous code no longer works". B (after Forget pairing on B) scans the new code and pairs. Note: a phone that scanned the previous code still accepts it (scanning is offline and one-way); that pairing fails only when a ride starts.
8. **Forget pairing.** Settings > Forget pairing: first tap turns into "Tap again to forget", second tap removes it; Home returns to "Not paired yet". Reopen the app: still not paired.

Fixed item for the M1 checklist, **export never leaks the pairing secret** (untested until then):

1. Pair the two phones with developer mode on, so the host's pairing screen also offers "Copy pairing string" (never shown as text). Copy it and paste it into a notes app on the host phone (it never leaves that phone; delete the note at the end).
2. Ride for at least 2 minutes, end the ride, then on BOTH phones open Diagnostics > Share diagnostics and share to the same notes app.
3. In each exported note, search for: the whole pairing string; the part after the first `:`; any 12 consecutive characters of that part (three different positions); the pairing prefix followed by the version and a colon (`pairingPrefix` from `config/identity.json` + `PAIRING_VERSION`, today `pillion1:`). Expected: zero hits for all of them; `[redacted]` may appear.
4. Paste back: "export secret check: host 0 hits / guest 0 hits" (or the count and the field it appeared in, never the matching text itself). Then delete both notes.

### UI redesign (Brass Chronograph) - on the phone, any milestone build

Compiles, web-verified and unit-tested; untested on device. On a Pixel-class Android phone:

1. Cold start: the splash shows the wordmark, then Home renders in Marcellus / Barlow (not Roboto). Airplane mode on: fonts still load (bundled).
2. Settings > Accessibility > Font size largest (about 1.3): Home, Ride, Pair host and Settings have no clipped or overlapping text; the ride plates keep both lines of their sub-label.
3. Settings > Accessibility > Remove animations on: the dial ticks, gauge sweep and screen entrances do not animate; values appear at once.
4. Haptics: Begin ride and Mute give a light tick; holding End ride gives a tick at the start and a stronger one when it completes after about 1 s; releasing early cancels.
5. TalkBack: End ride announces the hold hint; double-tap once says "Activate again to end the ride", a second double-tap ends it.
6. Night check outdoors: status words (Linked / Reconnecting / Muted) readable at arm's length in sunlight.

## 4. Pasting results into the next session

Use the diagnostics screen's "Share diagnostics" action on both phones after each test and paste the text. Add: phone models and Android versions, headset models, Wi-Fi router/hotspot used, what you heard (one-way, echo, dropouts, wind noise), and the time of any failure. The export is designed never to contain the pairing secret or the Wi-Fi passphrase (unit-tested only so far, see "Claims that are unit-tested only" above).
