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

| Layer                                 | Proves                                                                                                                                                                                   | Does NOT prove                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Jest `src/core` + two-peer simulation | protocol, handshake, pairing, state machine, reconnect/backoff, diagnostics, recovery after a dropped link (in-memory fakes)                                                             | real sockets, real WebRTC, any hardware                                                       |
| Playwright on the web build           | UI and flows, session logic end to end, signaling, real browser WebRTC negotiation and audio bytes in both directions (fake mic)                                                         | Bluetooth routing, Wi-Fi Direct, the foreground service, background behaviour, the RN interop |
| Kotlin compile + JVM tests            | the native code compiles; non-platform logic is correct (TCP hub on real loopback sockets, NSD peer choice, audio-route decisions per API level, cue synthesis, ride-service start gate) | any behaviour that touches Android audio/Wi-Fi/service APIs                                   |
| Device (owner, two phones + earbuds)  | everything else                                                                                                                                                                          |                                                                                               |

### Claims that are unit-tested only

These rest on Jest alone; no e2e test and no device run has checked them against the real app yet.

- **"The diagnostics export never contains the pairing secret or the Wi-Fi passphrase."** Covered by `src/core/diagnostics/redact.test.ts` (key- and value-based redaction, pairing strings, glued secrets, passphrase literals) and `src/core/diagnostics/formatReport.test.ts` (the report builder redacts every field). Since M1 the diagnostics screen exports the live ring log and session state, and the web e2e asserts the pairing secret never appears on screen or in either console (`e2e/pairing.spec.ts`, `e2e/ride.spec.ts`); the native share path (live log + Keystore pairing -> report -> Android share sheet) has not run on a phone. M1 device item 12 closes this; the Wi-Fi passphrase part can only be checked from M2 (Wi-Fi Direct), when the app first holds one.

## 3. Device test checklist

Filled in per milestone (M1 first). Each item says exactly what to do and what to paste back into the next session. Until a milestone's checklist exists here, nothing about it has been tested on hardware.

### M1 - first voice on the same Wi-Fi (compiles and unit-tested, untested on device)

Nothing below has run on a phone. Status per layer: the native link (NSD + TCP), audio route and ride service compile and their plain-Kotlin logic is JVM-tested (TCP on real loopback sockets); the TypeScript wrappers are Jest-tested against fake native modules; the session, signaling and WebRTC negotiation are proven in the browser only. Everything that touches Wi-Fi, Bluetooth, the foreground service or the screen being off is first exercised by the steps below.

**What you need.** Two Android phones (A = host, normally the rider; B = guest), each with its own Bluetooth earbuds already paired in Android's Bluetooth settings. One Wi-Fi network both phones join: a home router, or a hotspot on a **third** phone. A hotspot hosted by A or B is not expected to work yet (risk 1, M2). A laptop with `adb` is optional but makes the failure reports far more useful.

**Install.** Download the `pillion-debug-apk` artifact from the latest green GitHub Actions run of the branch (or build it: `npm run android:assemble` -> `android/app/build/outputs/apk/debug/app-debug.apk`, arm64 only). `adb install -r app-debug.apk` on both phones (or open the file on the phone). The APK carries its JS bundle, so it runs with no laptop and no internet. Debug-signed: never distribute it.

**While testing (optional, with a laptop).** `adb -s <serial> logcat -v time > phoneA.log` per phone. Paste back only lines containing `FATAL`, `AndroidRuntime`, `ReactNativeJS` errors, `ForegroundService`, `NsdManager` or `SecurityException`, never the whole file.

**Paste back, once at the top:** phone models and Android versions (A, B), earbud models, router or hotspot phone model, APK commit (Settings > Version). Then one line per item: `M1.<n> pass|fail - what you saw (times in seconds)`.

1. **Permissions on first ride.** Fresh install on A. Pair (slice 1 item 1 below), then Home > Begin ride. Expected: the in-app explanation of Microphone, Notifications and Bluetooth headset BEFORE any system dialog; then Android asks for each. Deny Microphone. Expected: the ride does not start and Home says the microphone is still needed. Begin ride again and allow everything. Expected: the ride starts. Repeat on B. Paste back: the order of the system dialogs and any wording that confused you.
2. **Pairing.** Run slice 1 items 1 and 6 below (scan host -> guest, restart keeps the pairing) if not done on this build.
3. **First link on shared Wi-Fi.** Both phones on the same Wi-Fi, earbuds in and connected, screens on. A: Begin ride; within 10 s B: Begin ride. Expected on both: within about 10 s a short "connected" cue in the earbuds, the ride dial shows Linked with the partner's name, a ride notification "Connected to <name>" with Mute and End buttons, and you can hear each other. Then on both: Settings > Diagnostics. Expected: Transport = LAN (shared Wi-Fi), Selected local and Selected remote are `192.168.x.x` / `10.x.x.x` host candidates, Codec contains `opus`, Audio route: Communication mode yes, Active device = your earbuds. Paste back: seconds from B's tap to the cue, and the Round-trip time and Packet loss values.
4. **Start order.** End the ride (hold End ride 1 s). B: Begin ride first, wait 20 s, then A: Begin ride. Expected: they still link within about 10 s of A's tap, with no tap on B. Paste back: seconds to the cue.
5. **10-minute two-way conversation, screens off (the M1 acceptance test).** Start a ride as in item 3. Both press the power button (screen off) and put the phone in a pocket. Talk in turns for 10 minutes by the clock, moving between rooms but staying in Wi-Fi coverage: normal voice, then quietly, then while walking. Write down the minute of every dropout, echo or robotic sound. At 10:00 unlock both phones. Expected: the ride is still Linked, the ride time is about 10 minutes, you heard each other throughout, no echo of your own voice in your earbuds. Then on both phones Diagnostics > Share diagnostics (paste the text, see section 4). Paste back: dropouts (count, minute, length), echo yes/no and on which phone, perceived delay (none / noticeable / annoying), audio quality 1-5 for each direction.
6. **Battery drain over the 10 minutes.** Before item 5 note both phones' battery % (status bar or Settings > Battery; with adb: `adb shell dumpsys battery | grep level`), phones unplugged, at least 50 %. After item 5 note them again, and the Partner battery value from Diagnostics. Paste back: start %, end %, minutes, whether either phone got noticeably warm, and the app's line in Settings > Battery > Battery usage if shown.
7. **Mute.** During a ride A taps Mute on the ride screen. Expected: A's mic indicator shows Muted, B can no longer hear A, B's ride screen shows A's mic as muted within about 2 s; A still hears B. A taps again to unmute. Expected: B hears A again. (No mute cue yet: cues for every state change are M3.) Paste back: seconds until B's screen showed the change.
8. **Notification actions with the screen locked.** During a ride, lock A, then wake it to the lock screen and pull down the ride notification. Tap Mute. Expected: B stops hearing A and the button becomes Unmute; tap Unmute, B hears A again. Now tap End. Expected: the ride ends on both phones, B hears a "disconnected" cue, the notification disappears on both and the Android microphone indicator (green dot) goes away. Paste back: anything that did not happen, and whether the buttons needed the phone unlocked.
9. **Headset off and on again.** During a ride, put A's earbuds back in their case (or switch them off). Expected: the ride does NOT end and A's audio does NOT jump to the loudspeaker; A's ride screen shows No headset; B's Diagnostics shows Partner headset = no, Partner interruption = headset-disconnected. Take the earbuds out again (they reconnect in Android). Expected within about 5 s: A shows Headset connected, both hear each other again, the ride never left Linked. Repeat on B. Paste back: seconds from earbuds reconnected to hearing the partner again; whether any sound came out of a phone speaker.
10. **Link drop by leaving Wi-Fi range, then walking back.** During a ride B walks away (outside, down the street) until the voice stops. Expected: within about 10 s both hear one "reconnecting" cue and the ride screens show Reconnecting; the ride does not end. Wait 30 s out of range, then walk back. Expected: once B's phone has rejoined the Wi-Fi (Wi-Fi icon back), the link returns by itself with a "connected" cue on both and no taps. Paste back: time voice stopped -> cue, time Wi-Fi icon back -> voice back, and Diagnostics Generation / Failed attempts afterwards. (Reconnect within 5 s of coming back is the M2 target; M1 records what happens.)
11. **End ride.** Hold End ride for 1 s on A. Expected: A shows Ride ended (You ended the ride), B shows Ride ended and hears a "disconnected" cue, both notifications go away, Home again offers Begin ride, and the earbuds can play music normally again (audio mode restored). Paste back: anything still active afterwards (notification, mic indicator, call-style audio).
12. **Diagnostics export never leaks the pairing secret.** Run the four steps under "Export never leaks the pairing secret" below, after a ride of at least 2 minutes. Paste back only the hit counts.
13. **Loopback self-test.** On A, no ride running, earbuds in: Settings > tap the version label 7 times (Developer mode is on) > Developer tools > Run loopback self-test. Speak during the 10 s. Expected: you hear your own voice in the earbuds with a short delay, then "Passed: audio went round the loop." with a detail line. Start a ride and try again: expected "A ride is running: end it first". Paste back: the result and the detail line.
14. **Audio tunables (optional, developer mode).** During a ride on A: Developer tools > Audio tunables, switch noise suppression off, then on again, while B listens next to a running fan or tap. Expected: the change applies without ending the ride; B hears a difference. Paste back: what B heard.

#### What to paste back for M1

The per-item lines above, then for each phone the full "Share diagnostics" text taken right after item 5 and after item 10 (the export is designed never to contain the secret; item 12 checks that). Never paste the pairing string, the clipboard content or a screenshot of the host's QR.

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

#### Export never leaks the pairing secret (M1 item 12; untested until then)

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
