# Evidence: the WebRTC package (`@livekit/react-native-webrtc` 150.1.1)

Author: `media` engineer, M0, 2026-11-17. Everything here was checked against the installed package
(`node_modules/@livekit/react-native-webrtc`, version 150.1.1) or the real AAR; claims that rest on anything else
are marked **(unverified)** or **(upstream source, not the shipped binary)**. Nothing here ran on a device.

Paths below: `PKG` = `node_modules/@livekit/react-native-webrtc`, `J` = `PKG/android/src/main/java/com/oney/WebRTCModule`.

## 0. Package choice (peer deps, build, hooks)

| Claim                                              | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The package pins the native lib we expected        | `PKG/android/build.gradle:34` `api 'io.github.webrtc-sdk:android-prefixed:150.7871.04'`                                                                                                                                                                                                                                                                         |
| Its own peer dependency proves nothing             | `npm view @livekit/react-native-webrtc@150.1.1 peerDependencies --json` -> `{"react-native": ">=0.60.0"}`                                                                                                                                                                                                                                                       |
| Stage 2 shares this one build                      | `npm view @livekit/react-native@3.1.0 peerDependencies --json` -> `"@livekit/react-native-webrtc": "^150.1.0"`, `"livekit-client": "^2.20.0"`                                                                                                                                                                                                                   |
| It builds on RN 0.88.1                             | DECISIONS E-3 (`:app:compileDebugKotlin` and `:app:assembleDebug` succeeded); not re-run by me (no Gradle in this task)                                                                                                                                                                                                                                         |
| It is legacy-style (interop), not a TurboModule    | `J/WebRTCModulePackage.java` is a plain `ReactPackage`; `J/WebRTCModule.java:159` `getName()` returns `"WebRTCModule"`; no codegen spec in the package                                                                                                                                                                                                          |
| It declares a `mediaProjection` foreground service | `PKG/android/src/main/AndroidManifest.xml` (`MediaProjectionService`, `foregroundServiceType="mediaProjection"`). It is only started for screen capture (`J/MediaProjectionService.java:28`, gated by `WebRTCModuleOptions.enableMediaProjectionService`, default false). It still merges into our manifest: relevant for Play policy forms, not for behaviour. |

## 1. Risk 1: does libwebrtc gather candidates on Wi-Fi Direct (p2p) interfaces?

### 1.1 What was downloaded

```
mkdir -p $SCRATCH/aar && cd $SCRATCH/aar
curl -f -o a.aar https://repo.maven.apache.org/maven2/io/github/webrtc-sdk/android-prefixed/150.7871.04/android-prefixed-150.7871.04.aar   # HTTP 200, no mirror needed
sha1sum a.aar    -> 540165bc930cb922fb31e3cee76a4d6e11400346
curl .../android-prefixed-150.7871.04.aar.sha1 -> 540165bc930cb922fb31e3cee76a4d6e11400346   (matches Maven Central)
unzip -l a.aar   -> classes.jar is 22 bytes (EMPTY); the classes are in libs/shadow-all.jar (545 018 bytes)
unzip a.aar libs/shadow-all.jar jni/arm64-v8a/liblkjingle_peerconnection_so.so; unzip libs/shadow-all.jar   # into a fresh dir
javap -p -c -cp . livekit.org.webrtc.NetworkMonitorAutoDetect ...
strings -a jni/arm64-v8a/liblkjingle_peerconnection_so.so
```

Note for anyone repeating this: `unzip classes.jar` gives "zipfile is empty"; use `libs/shadow-all.jar`.

### 1.2 The switch exists, and it is a Java static setter, not a field trial

`javap -p livekit.org.webrtc.NetworkMonitorAutoDetect` (the shipped bytecode):

```
private static boolean includeWifiDirect;
private livekit.org.webrtc.NetworkMonitorAutoDetect$WifiDirectManagerDelegate wifiDirectManagerDelegate;
public static void setIncludeWifiDirect(boolean);
```

- `setIncludeWifiDirect` is a bare `putstatic includeWifiDirect` (bytecode offset 1).
- The flag is read **once, in the `NetworkMonitorAutoDetect` constructor** (`getstatic includeWifiDirect; ifeq` at offset 100): if true, `new WifiDirectManagerDelegate(observer, context)`; otherwise no delegate. So it must be set before the first `NetworkMonitor.startMonitoring` creates the detector (that happens when the first `PeerConnectionFactory`/`PeerConnection` starts the Android network monitor), i.e. at process start.
- `getActiveNetworkList()` appends `wifiDirectManagerDelegate.getActiveNetworkList()` to the ConnectivityManager list when the delegate exists; `destroy()` calls `release()`.
- There is **no `WebRTC-IncludeWifiDirect` field trial in this build**: `strings -a liblkjingle_peerconnection_so.so | grep -c IncludeWifiDirect` -> `0`, and nothing in the Java classes reads a field trial for it. DECISIONS E-2 says "`fieldTrials` ... (`WebRTC-IncludeWifiDirect` field trial)": **that is wrong for this build** and should be corrected by the lead (the real switch is the static setter; the trial that matters is in 1.4).
- Upstream source for the same code (m150 branch of the `webrtc-sdk/webrtc` fork; **(upstream source, not the shipped binary)**): `sdk/android/api/org/webrtc/NetworkMonitorAutoDetect.java` lines 736-737 (fields), 761-762 (`if (includeWifiDirect) wifiDirectManagerDelegate = new ...`), 798-800 (`setIncludeWifiDirect`). The bytecode above is the authority; the branch only gives readable names.

### 1.3 What the Wi-Fi Direct delegate does (bytecode of `NetworkMonitorAutoDetect$WifiDirectManagerDelegate`)

- Constructor registers itself as a `BroadcastReceiver` for `android.net.wifi.p2p.STATE_CHANGED` and `android.net.wifi.p2p.CONNECTION_STATE_CHANGE` (plain `Context.registerReceiver(receiver, filter)`, no export flag; both are protected system broadcasts).
- If `Build.VERSION.SDK_INT > 28` it also calls `WifiP2pManager.initialize(...)` and `requestGroupInfo(...)` to learn an already-existing group. **This call needs `NEARBY_WIFI_DEVICES` (API 33+) or `ACCESS_FINE_LOCATION` (older); the constructor of `NetworkMonitorAutoDetect` has no try/catch around the delegate construction (exception table of the constructor only covers the mobile-network request and one later block), so a missing permission is a `SecurityException` out of network monitor start (unverified on device).**
- `onWifiP2pGroupChange(group)`: looks up `NetworkInterface.getByName(group.getInterface())` (e.g. `p2p-wlan0-0`), collects its addresses, and publishes **one synthetic `NetworkInformation`** named after that interface with `ConnectionType.CONNECTION_WIFI`, underlying `CONNECTION_NONE`, network handle **0** (`lconst_0`), via `observer.onNetworkConnect`. `onWifiP2pStateChange(1)` (p2p disabled) clears it with `onNetworkDisconnect(0)`.
- Consequence: it only describes the group this phone is currently a member of (owner or client), it hard-codes the type to WIFI, and it knows nothing about hotspot/tethering interfaces.

### 1.4 What the default does (why risk 1 is real)

Three separate pieces, in order:

1. **The default network list is built from ConnectivityManager networks that have INTERNET.** `ConnectivityManagerDelegate.createNetworkRequest()` (bytecode): `NetworkRequest.Builder().addCapability(12 /*NET_CAPABILITY_INTERNET*/)`, `removeCapability(15 /*NOT_VPN*/)` when `requestVPN` (default true), `setIncludeOtherUidNetworks` on API 31+ only when enabled (default false). A Wi-Fi Direct group, a local-only hotspot and a tethering downstream interface are normally either not `Network` objects at all or have no INTERNET capability, so they are **not in the list**. Field-trial keys read by this class (under the trial name `WebRTC-NetworkMonitorAutoDetect`): `getAllNetworksFromCache` (default true), `requestVPN` (true), `includeOtherUidNetworks` (false); none of them relaxes the INTERNET requirement. `checkFieldTrial` looks for `"<key>:true"` / `"<key>:false"` inside the trial string.
2. **Interfaces unknown to that list are marked unavailable.** Native side, **(upstream source, not the shipped binary)**, `sdk/android/src/jni/android_network_monitor.cc` (m150 branch) lines 289-290, 621-634:
   `disable_is_adapter_available_ = field_trials_.IsDisabled("WebRTC-AndroidNetworkMonitor-IsAdapterAvailable")` and in `GetInterfaceInfo(if_name)`: when no network handle matches the interface name it returns `{ .adapter_type = ADAPTER_TYPE_UNKNOWN, .available = (disable_is_adapter_available_ ? true : false) }`. So **by default an interface the Android monitor does not know is `available = false`**.
3. **Unavailable adapters are ignored for candidate gathering.** `rtc_base/network.cc` (m150 branch) lines 636-651 (`BasicNetworkManager::GetInterfaceInfo` asks the monitor) and 744-750: `if (!if_info.available) { network->set_ignored(true); }`. Ignored networks produce no host candidates.

Binary cross-check that the trial names exist in the shipped native library (`strings -a ...so`, line numbers in the strings output): `WebRTC-NetworkMonitorAutoDetect` (5143), `WebRTC-BindUsingInterfaceName` (5771), `WebRTC-AndroidNetworkMonitor-IsAdapterAvailable` (10015). The library is `android-prefixed:150.7871.04`; the C++ line numbers above come from the `m150_release` branch tip of the fork, which I could not prove is byte-identical to the build behind 150.7871.04 **(unverified)**; the Java bytecode I did read from the real AAR.

`IsDisabled(key)` = `absl::StartsWith(Lookup(key), "Disabled")` (`api/field_trials_view.h` m150 lines 43-45), so the trial string is `WebRTC-AndroidNetworkMonitor-IsAdapterAvailable/Disabled/` (field-trial strings are `Key/Value/` pairs, each terminated by `/`).

**Conclusion for risk 1:** with stock settings, on Android the `p2p-wlan0-*` (Wi-Fi Direct) interface is most probably NOT used for host candidates. There are two independent, compile-checked switches (1.2 and the trial in 1.4). Whether the interface really is dropped, and whether each switch fixes it, needs a device (see 4).

## 2. Hooks and timing (question b)

`J/WebRTCModuleOptions.java:12-22`: singleton with public fields `videoEncoderFactory`, `videoDecoderFactory`, `audioDeviceModule` (`livekit.org.webrtc.audio.AudioDeviceModule`), `audioProcessingFactoryFactory`, `injectableLogger`, `loggingSeverity`, **`fieldTrials` (String)**, `enableMediaProjectionService`, `defaultTrackVolume`. `getInstance()` at lines 26-32 is lazy and static.

`J/WebRTCModule.java`, **constructor** (line 81 onward) does everything eagerly, in this order:

| Lines   | Step                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 87-94   | reads `WebRTCModuleOptions.getInstance()` (`audioDeviceModule`, factories, logger, `fieldTrials`)                                                                       |
| 96-100  | `PeerConnectionFactory.initialize(InitializationOptions.builder(ctx).setFieldTrials(fieldTrials)...)` (bytecode: `initialize` -> `nativeInitializeFieldTrials(String)`) |
| 119-121 | `if (adm == null) adm = JavaAudioDeviceModule.builder(reactContext).createAudioDeviceModule()` (default ADM: all builder defaults)                                      |
| 135-144 | `PeerConnectionFactory.builder().setAudioDeviceModule(adm)...createPeerConnectionFactory()` -> `mFactory`                                                               |

Therefore: **options must be set before `new WebRTCModule(...)` runs; it is created by `WebRTCModulePackage.createNativeModules` (`J/WebRTCModulePackage.java`) when React Native builds its module list.** Our JS cannot be earlier than that (the JS lib does `NativeModules.WebRTCModule` at import time: `PKG/src/getUserMedia.ts:11`). Whether the interop layer creates the module at React-instance start or at first access is **(unverified)**; it does not matter if we set the options in `Application.onCreate` (before any `ReactHost`), which is the only placement that is correct under both. `NetworkMonitorAutoDetect.setIncludeWifiDirect(true)` must also run before the first peer connection, so the same place works. Our own Kotlin can therefore set all of this, from a static initializer in the app, with no change to the package: for example an Expo config plugin that patches `MainApplication.onCreate`, or an `ApplicationLifecycleListener`. (Owner: `android-native` / the lead; this note only states the constraint.)

Hardware AEC/NS: the JS `AudioDeviceModule` class is iOS/macOS only and throws on Android (`PKG/src/AudioDeviceModule.ts:242-247` `if (Platform.OS === 'android') throw`). On Android the only control is injecting `WebRTCModuleOptions.audioDeviceModule` built with `JavaAudioDeviceModule.builder(...)`; the shipped builder has `setUseHardwareAcousticEchoCanceler(boolean)`, `setUseHardwareNoiseSuppressor(boolean)`, `setUseLowLatency(boolean)`, `setAudioSource(int)`, `setAudioAttributes(...)`, `setUseStereoInput/Output(boolean)` (`javap 'livekit.org.webrtc.audio.JavaAudioDeviceModule$Builder'`). Not exposed to our TypeScript tunables yet; that would be a (frozen-contract) tunable addition, see the change requests in the report.

## 3. The JS API surface that exists on Android (question c)

- **Constructor options** (`PKG/src/RTCPeerConnection.ts:56-63`): `bundlePolicy`, `enableSctpSnap`, `iceCandidatePoolSize`, `iceServers`, `iceTransportPolicy` (`'all' | 'relay'`), `rtcpMuxPolicy`. Native parse: `J/WebRTCModule.java:220-300` (`parseRTCConfiguration`): fixed `UNIFIED_PLAN`, `enableImplicitRollback = true`, GCM crypto suites on. `iceServers: []` (offline mode) is valid. There is **no** option for `candidateNetworkPolicy`, `disableIPv6OnWifi`, `tcpCandidatePolicy` etc. (the Java `RTCConfiguration` has them, `javap`, but the bridge does not forward them).
- **createOffer** options (`PKG/src/RTCUtil.ts:22-27`): only `iceRestart`, `offerToReceiveAudio`, `offerToReceiveVideo`, `voiceActivityDetection`. `restartIce()` exists (`RTCPeerConnection.ts:646`). `setLocalDescription` accepts our munged SDP (it is passed through to native, `RTCPeerConnection.ts:265`).
- **getUserMedia audio constraints**: `J/GetUserMediaImpl.java:88-115` (`createAudioTrack`). Every key present in the audio constraints is added as a _mandatory_ constraint (`WebRTCModule.java:514-526` `constraintsForOptions`), and exactly four are also mapped to optional legacy constraints, each defaulting to `"true"`: `autoGainControl` -> `googAutoGainControl`, `noiseSuppression` -> `googNoiseSuppression`, `echoCancellation` -> `googEchoCancellation`, `highpassFilter` -> `googHighpassFilter` (`highpassFilter` is a LiveKit-fork extension, not a W3C constraint; the TypeScript type `PKG/src/Constraints.ts` does not list any of them, so the wrapper must cast). `channelCount`, `sampleRate`, `latency`, `deviceId` are not read on Android audio. `src/platform/audio/tunables.ts` emits exactly these four for `native`.
- **Live constraint changes are impossible for audio**: `MediaStreamTrack.applyConstraints` returns early for non-video (`PKG/src/MediaStreamTrack.ts:208-213` "Only implemented for video tracks") and the native side only handles camera tracks (`J/GetUserMediaImpl.java:265-283`, "Camera track not found!"). So changing NS/AGC/AEC/HPF means acquiring a new track and `sender.replaceTrack` (the engine should use `captureConstraintsDiffer()` from `tunables.ts` to decide). Mute = `track.enabled = false` (`MediaStreamTrack.ts:101-106` -> `mediaStreamTrackSetEnabled`).
- **RTCRtpSender**: `getParameters()` is synchronous and returns a cached copy (`PKG/src/RTCRtpSender.ts:45-47`); `setParameters` round-trips through native (`:49-55`, `J/WebRTCModule.java:646-668`). Applied fields per encoding (`J/SerializeUtils.java:231-256`): `active`, `rid`, `maxBitrate`, `minBitrate`, `maxFramerate`, `scaleResolutionDownBy` (plus `degradationPreference`). **Gotchas:** the number of encodings in the update must equal the sender's current number (else `updateRtpParameters` returns null), the update overwrites every listed field from the object you pass (so pass back the object from `getParameters()` with only `maxBitrate` changed), and `getParameters()` may have no encodings before negotiation (unverified), so the engine should apply `maxBitrate` after `setLocalDescription`.
- **getStats**: `pc.getStats()` returns `new Map(JSON.parse(data))` (`RTCPeerConnection.ts:586-601`), entries serialised by `J/StringUtils.java:23-52`: `[id, {timestamp (ms), type, id, ...members}]` with libwebrtc's own member names (seconds for jitter/RTT, 64-bit counters as JSON numbers). The shared mapper `src/platform/media/stats.ts` accepts exactly this Map shape and Chromium's array shape; tests use real Chromium reports plus a hand-written Android-shaped one (**the Android shape is derived from `StringUtils.java` and the W3C names, not captured from a device**).

## 4. Ranked recommendation for risk 1 in M2

1. **Field trial `WebRTC-AndroidNetworkMonitor-IsAdapterAvailable/Disabled/`**, set through `WebRTCModuleOptions.getInstance().fieldTrials` in `Application.onCreate`. Why first: one string, no permission, covers p2p and any hotspot/tethering interface (not only p2p), and acts exactly at the step that drops the interface (1.4 step 2). Side effect: every unknown interface is treated as available with adapter type UNKNOWN. Acceptable for an offline link; ICE connectivity checks still decide what works. Needs device confirmation that the string reaches the native `field_trials_` used by `AndroidNetworkMonitor` (the Java path `PeerConnectionFactory.initialize` -> `nativeInitializeFieldTrials` exists, whether m150's environment reads the global string is unverified).
2. **`NetworkMonitorAutoDetect.setIncludeWifiDirect(true)`** in the same `Application.onCreate`, **only together with the permission guard** (`NEARBY_WIFI_DEVICES` on API 33+, location below) because the delegate's constructor can throw `SecurityException` uncaught (1.3). Covers only the p2p group this phone is in. Use as a second layer or fallback if (1) alone does not produce a p2p candidate.
3. **Not an option:** making the group a ConnectivityManager network with INTERNET (not under our control); a custom `NetworkChangeDetectorFactory` via `NetworkMonitor.setNetworkChangeDetectorFactory` (public API exists, heavy, only if 1 and 2 fail).
4. **Diagnostics regardless** (already in `MediaStats`): log all `localCandidates` and compare with the interface list that `android-native` already enumerates; the check "a host candidate exists whose address is in the p2p group's subnet" is the pass/fail signal.

Needs device confirmation (exact tests are in the engineer report):

- Baseline without any option: is there a local host candidate on `p2p-wlan0-*`? As group owner and as client (confirms the risk is real and which role is affected).
- With switch 1: does the candidate appear and is it the selected pair?
- With switch 2 (and with its permission missing): does it add the candidate, does it crash?
- Hotspot/tethering variant of the same.
- Whether `WebRTCModule` is constructed before or after our `Application.onCreate` code (log order).

## 5. Tunables / SDP / stats: what was verified in a real browser

(Chromium 153 headless, fake microphone, two `RTCPeerConnection`s with `iceServers: []` in one page; fixtures in `src/platform/media/__fixtures__/`, regenerate with the same recipe.)

- Chromium's own offer has `a=fmtp:111 minptime=10;useinbandfec=1` and `a=rtpmap:111 opus/48000/2`, no `ptime` (`offer.chromium.sdp`).
- Round trip with `applyOpusTunables` (opusDtx on, 32 kbit/s, ptime 40) applied to both offer and answer: `setLocalDescription`/`setRemoteDescription` accepted, connection reached `connected`, `getStats()` codec `sdpFmtpLine` = `maxaveragebitrate=32000;minptime=40;sprop-stereo=0;stereo=0;usedtx=1;useinbandfec=1`, outbound `targetBitrate` = 32000, descriptions contain `a=ptime:40`. This proves browser acceptance of the munged SDP only. **Whether libwebrtc-on-Android honours the same parameters is the same C++ code but untested on device.**
- `cbr` is deliberately not written (see the header of `src/platform/media/sdp.ts`).
