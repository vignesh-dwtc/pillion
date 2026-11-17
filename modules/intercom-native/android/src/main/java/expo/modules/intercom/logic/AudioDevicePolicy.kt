package expo.modules.intercom.logic

enum class DeviceKind(val wireName: String) {
  BLUETOOTH_SCO("bluetooth-sco"),
  BLUETOOTH_LE("bluetooth-le"),
  WIRED_HEADSET("wired-headset"),
  USB_HEADSET("usb-headset"),
  EARPIECE("earpiece"),
  SPEAKER("speaker"),
  OTHER("other"),
}

/** One audio endpoint usable (or not) for a two-way call. [hasMic]: has a microphone in communication mode. */
data class DeviceInfo(val id: String, val kind: DeviceKind, val name: String, val hasMic: Boolean)

sealed class DeviceSelection {
  /** [isFallback] is true when an earpiece/speaker was chosen only because the developer override allows it. */
  data class Chosen(val device: DeviceInfo, val isFallback: Boolean) : DeviceSelection()

  /** No acceptable device: the route is in the error state (unless a fallback is allowed and exists). */
  data object NoHeadset : DeviceSelection()
}

/**
 * Which device a ride should talk through. Pure logic, no Android types.
 *
 * Order: Bluetooth (LE Audio, then SCO), then wired / USB headsets, then (only when [allowFallback]) earpiece, then
 * speaker. A headset is acceptable only with a microphone: the rider must be heard. Bluetooth LE Audio devices are
 * considered only on API 31+ (AudioDeviceInfo.TYPE_BLE_HEADSET exists since 31 and the legacy SCO calls of API 29-30 cannot
 * select them). [currentId] keeps the current device when it is still in the best tier, so a second headset appearing
 * does not make the audio jump.
 */
object AudioDevicePolicy {
  const val API_BLE_AUDIO = 31

  fun select(
    devices: List<DeviceInfo>,
    apiLevel: Int,
    allowFallback: Boolean,
    currentId: String? = null,
  ): DeviceSelection {
    val headsets = devices.filter { isAcceptableHeadset(it, apiLevel) }
    pickBest(headsets, currentId, ::headsetTier)?.let { return DeviceSelection.Chosen(it, isFallback = false) }
    if (allowFallback) {
      val fallbacks = devices.filter { it.kind == DeviceKind.EARPIECE || it.kind == DeviceKind.SPEAKER }
      pickBest(fallbacks, currentId, ::fallbackTier)?.let { return DeviceSelection.Chosen(it, isFallback = true) }
    }
    return DeviceSelection.NoHeadset
  }

  /** True when at least one headset the policy would accept is present (drives `headsetConnected`). */
  fun hasAcceptableHeadset(devices: List<DeviceInfo>, apiLevel: Int): Boolean =
    devices.any { isAcceptableHeadset(it, apiLevel) }

  fun isAcceptableHeadset(device: DeviceInfo, apiLevel: Int): Boolean {
    if (!device.hasMic) return false
    return when (device.kind) {
      DeviceKind.BLUETOOTH_LE -> apiLevel >= API_BLE_AUDIO
      DeviceKind.BLUETOOTH_SCO, DeviceKind.WIRED_HEADSET, DeviceKind.USB_HEADSET -> true
      else -> false
    }
  }

  private fun headsetTier(d: DeviceInfo): Int = when (d.kind) {
    DeviceKind.BLUETOOTH_LE -> 0
    DeviceKind.BLUETOOTH_SCO -> 1
    DeviceKind.WIRED_HEADSET -> 2
    DeviceKind.USB_HEADSET -> 3
    else -> Int.MAX_VALUE
  }

  /** Earpiece before speaker: two phones on a bench feed back less through the earpiece. */
  private fun fallbackTier(d: DeviceInfo): Int = if (d.kind == DeviceKind.EARPIECE) 0 else 1

  private fun pickBest(candidates: List<DeviceInfo>, currentId: String?, tier: (DeviceInfo) -> Int): DeviceInfo? {
    if (candidates.isEmpty()) return null
    val best = candidates.minOf(tier)
    val inBestTier = candidates.filter { tier(it) == best }
    return inBestTier.firstOrNull { it.id == currentId } ?: inBestTier.first()
  }
}
