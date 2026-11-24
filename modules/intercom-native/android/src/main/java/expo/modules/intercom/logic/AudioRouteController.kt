package expo.modules.intercom.logic

/**
 * The AudioManager calls the route needs, behind an interface so [AudioRouteController] runs on the JVM with a fake.
 * The Android implementation (AndroidAudioPlatform) is a one-line delegation per method.
 */
interface AudioPlatform {
  val sdkInt: Int

  /** Output devices usable for communication (API 31+: getAvailableCommunicationDevices) paired with their microphones. */
  fun listDevices(): List<DeviceInfo>

  fun getMode(): Int
  fun setMode(mode: Int)

  /** True when BLUETOOTH_CONNECT is granted (API 31+); always true below 31. */
  fun hasBluetoothPermission(): Boolean

  // API 31+
  fun setCommunicationDevice(id: String): Boolean
  fun clearCommunicationDevice()

  // API 29-30 (deprecated calls, only reached below API 31)
  fun isSpeakerphoneOn(): Boolean
  fun setSpeakerphoneOn(on: Boolean)
  fun isBluetoothScoOn(): Boolean
  fun setBluetoothScoOn(on: Boolean)
  fun startBluetoothSco()
  fun stopBluetoothSco()
}

enum class RouteStatus(val wireName: String) {
  INACTIVE("inactive"),
  ACTIVE("active"),
  NO_HEADSET("no-headset"),
  FAILED("failed"),
}

/** `NativeAudioRouteState` of specs/IntercomAudioRoute.ts. */
data class RouteState(
  val status: RouteStatus,
  val communicationMode: Boolean,
  val devices: List<DeviceInfo>,
  val activeDeviceId: String?,
  val headsetConnected: Boolean,
  val usingFallback: Boolean,
  val error: String?,
  val wouldChoose: String?,
) {
  fun toWire(): Map<String, Any?> = mapOf(
    "status" to status.wireName,
    "communicationMode" to communicationMode,
    "devices" to devices.map { mapOf("id" to it.id, "kind" to it.kind.wireName, "name" to it.name, "hasMic" to it.hasMic) },
    "activeDeviceId" to activeDeviceId,
    "headsetConnected" to headsetConnected,
    "usingFallback" to usingFallback,
    "error" to error,
    "wouldChoose" to wouldChoose,
  )
}

class AudioRouteException(val code: String, message: String) : Exception(message) {
  companion object {
    const val PERMISSION = "ERR_AUDIO_PERMISSION"
    const val ROUTE = "ERR_AUDIO_ROUTE"
  }
}

/**
 * Communication-mode routing with full restore. Pure logic over [AudioPlatform]; all methods are synchronized (calls
 * arrive from the Expo module queue and from the AudioManager callback thread).
 *
 * start: remember mode (and on API 29-30 speakerphone + SCO flags), set MODE_IN_COMMUNICATION, then route by
 * [AudioDevicePolicy]. API 31+: setCommunicationDevice(chosen) (or clearCommunicationDevice when nothing is acceptable).
 * API 29-30: Bluetooth SCO via startBluetoothSco + setBluetoothScoOn(true); wired/USB/earpiece need only speakerphone off;
 * the speaker fallback turns speakerphone on.
 * stop: undo exactly what start changed, in reverse order. Audio focus is never requested (music keeps playing).
 *
 * Bluetooth without BLUETOOTH_CONNECT on API 31+: start rejects with ERR_AUDIO_PERMISSION when the policy would pick a
 * Bluetooth device; while running, Bluetooth devices are skipped instead (a headset reconnecting must not crash the ride).
 */
class AudioRouteController(private val platform: AudioPlatform) {
  private class Saved(val mode: Int, val speakerphone: Boolean, val scoOn: Boolean)

  private var saved: Saved? = null
  private var allowFallback = false
  private var status = RouteStatus.INACTIVE
  private var activeId: String? = null
  private var activeKind: DeviceKind? = null
  private var usingFallback = false
  private var error: String? = null
  private var scoStarted = false
  private var communicationDeviceSet = false
  private var lastDevices: List<DeviceInfo> = emptyList()

  private val modern get() = platform.sdkInt >= API_COMMUNICATION_DEVICE

  @Synchronized fun isActive(): Boolean = saved != null

  @Synchronized fun start(allowFallbackDevice: Boolean): RouteState {
    allowFallback = allowFallbackDevice
    if (saved == null) {
      val devices = platform.listDevices()
      val wanted = AudioDevicePolicy.select(devices, platform.sdkInt, allowFallback)
      if (wanted is DeviceSelection.Chosen && isBluetooth(wanted.device) && !btAllowed()) {
        throw AudioRouteException(AudioRouteException.PERMISSION, "BLUETOOTH_CONNECT is not granted")
      }
      saved = Saved(
        mode = platform.getMode(),
        speakerphone = if (modern) false else platform.isSpeakerphoneOn(),
        scoOn = if (modern) false else platform.isBluetoothScoOn(),
      )
      platform.setMode(MODE_IN_COMMUNICATION)
    }
    route()
    return snapshot()
  }

  @Synchronized fun stop() {
    val s = saved ?: return
    if (modern) {
      if (communicationDeviceSet) platform.clearCommunicationDevice()
    } else {
      if (scoStarted) platform.stopBluetoothSco()
      platform.setBluetoothScoOn(s.scoOn)
      platform.setSpeakerphoneOn(s.speakerphone)
    }
    platform.setMode(s.mode)
    saved = null
    communicationDeviceSet = false
    scoStarted = false
    status = RouteStatus.INACTIVE
    activeId = null
    activeKind = null
    usingFallback = false
    error = null
  }

  @Synchronized fun setAllowFallback(allow: Boolean): RouteState {
    allowFallback = allow
    if (saved != null) route()
    return snapshot()
  }

  /** Device added/removed or the communication device changed. Returns the new state (also when inactive). */
  @Synchronized fun devicesChanged(): RouteState {
    if (saved != null) route()
    return snapshot()
  }

  /**
   * API 29-30: AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED. [state]: SCO_AUDIO_STATE_* (-1 error, 0 disconnected,
   * 1 connected, 2 connecting). Returns the new state when it changed, else null.
   */
  @Synchronized fun scoStateChanged(state: Int): RouteState? {
    if (saved == null || !scoStarted || activeKind != DeviceKind.BLUETOOTH_SCO) return null
    return when (state) {
      SCO_STATE_ERROR -> {
        status = RouteStatus.FAILED
        error = "bluetooth-sco-error"
        snapshot()
      }
      SCO_STATE_CONNECTED -> if (status == RouteStatus.FAILED) {
        status = RouteStatus.ACTIVE
        error = null
        snapshot()
      } else {
        null
      }
      else -> null
    }
  }

  @Synchronized fun state(): RouteState = snapshot(platform.listDevices())

  private fun route() {
    val devices = platform.listDevices()
    lastDevices = devices
    val candidates = if (btAllowed()) devices else devices.filterNot(::isBluetooth)
    when (val sel = AudioDevicePolicy.select(candidates, platform.sdkInt, allowFallback, activeId)) {
      is DeviceSelection.NoHeadset -> {
        releaseDevice()
        status = RouteStatus.NO_HEADSET
        activeId = null
        activeKind = null
        usingFallback = false
        error = null
      }
      is DeviceSelection.Chosen -> applyChoice(sel)
    }
  }

  private fun applyChoice(sel: DeviceSelection.Chosen) {
    val device = sel.device
    val ok = if (modern) {
      val accepted = platform.setCommunicationDevice(device.id)
      if (accepted) communicationDeviceSet = true
      accepted
    } else {
      applyLegacy(device.kind)
      true
    }
    if (ok) {
      status = RouteStatus.ACTIVE
      activeId = device.id
      activeKind = device.kind
      usingFallback = sel.isFallback
      error = null
    } else {
      status = RouteStatus.FAILED
      activeId = null
      activeKind = null
      usingFallback = false
      error = "communication device rejected"
    }
  }

  private fun applyLegacy(kind: DeviceKind) {
    when (kind) {
      DeviceKind.BLUETOOTH_SCO -> {
        platform.setSpeakerphoneOn(false)
        if (!scoStarted) {
          platform.startBluetoothSco()
          scoStarted = true
        }
        platform.setBluetoothScoOn(true)
      }
      DeviceKind.SPEAKER -> {
        stopLegacySco()
        platform.setSpeakerphoneOn(true)
      }
      else -> {
        // Wired / USB headsets and the earpiece win by default in communication mode once SCO and speaker are off.
        stopLegacySco()
        platform.setSpeakerphoneOn(false)
      }
    }
  }

  private fun stopLegacySco() {
    if (scoStarted) {
      platform.stopBluetoothSco()
      platform.setBluetoothScoOn(false)
      scoStarted = false
    }
  }

  private fun releaseDevice() {
    if (modern) {
      if (communicationDeviceSet) {
        platform.clearCommunicationDevice()
        communicationDeviceSet = false
      }
    } else {
      stopLegacySco()
      platform.setSpeakerphoneOn(saved?.speakerphone ?: false)
    }
  }

  private fun btAllowed(): Boolean = !modern || platform.hasBluetoothPermission()

  private fun isBluetooth(d: DeviceInfo) = d.kind == DeviceKind.BLUETOOTH_SCO || d.kind == DeviceKind.BLUETOOTH_LE

  private fun snapshot(devices: List<DeviceInfo> = lastDevices): RouteState {
    val sdk = platform.sdkInt
    val would = AudioDevicePolicy.select(devices, sdk, allowFallback = false) as? DeviceSelection.Chosen
    return RouteState(
      status = status,
      communicationMode = saved != null,
      devices = devices,
      activeDeviceId = activeId,
      headsetConnected = AudioDevicePolicy.hasAcceptableHeadset(devices, sdk),
      usingFallback = usingFallback,
      error = error,
      wouldChoose = would?.device?.id,
    )
  }

  companion object {
    const val API_COMMUNICATION_DEVICE = 31
    /** AudioManager.MODE_IN_COMMUNICATION. */
    const val MODE_IN_COMMUNICATION = 3
    /** AudioManager.SCO_AUDIO_STATE_ERROR / _CONNECTED. */
    const val SCO_STATE_ERROR = -1
    const val SCO_STATE_CONNECTED = 1
  }
}
