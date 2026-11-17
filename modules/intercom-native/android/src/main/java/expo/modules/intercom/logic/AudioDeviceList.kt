package expo.modules.intercom.logic

/** Raw platform device (an AudioDeviceInfo reduced to what the policy needs). */
data class RawAudioDevice(val id: Int, val type: Int, val name: String, val address: String)

/**
 * Maps AudioDeviceInfo type codes to [DeviceKind] and pairs output devices with their input twin.
 * The constants are the documented values of AudioDeviceInfo.TYPE_* (checked against android.jar of API 36); they are
 * repeated here so this class stays free of Android types and runs on the JVM.
 */
object AudioDeviceList {
  const val TYPE_BUILTIN_EARPIECE = 1
  const val TYPE_BUILTIN_SPEAKER = 2
  const val TYPE_WIRED_HEADSET = 3
  const val TYPE_WIRED_HEADPHONES = 4
  const val TYPE_BLUETOOTH_SCO = 7
  const val TYPE_USB_HEADSET = 22
  const val TYPE_BLE_HEADSET = 26

  fun kindOf(type: Int): DeviceKind = when (type) {
    TYPE_BLUETOOTH_SCO -> DeviceKind.BLUETOOTH_SCO
    TYPE_BLE_HEADSET -> DeviceKind.BLUETOOTH_LE
    TYPE_WIRED_HEADSET, TYPE_WIRED_HEADPHONES -> DeviceKind.WIRED_HEADSET
    TYPE_USB_HEADSET -> DeviceKind.USB_HEADSET
    TYPE_BUILTIN_EARPIECE -> DeviceKind.EARPIECE
    TYPE_BUILTIN_SPEAKER -> DeviceKind.SPEAKER
    else -> DeviceKind.OTHER
  }

  /**
   * Output devices become [DeviceInfo]s. [DeviceInfo.hasMic] is true when an input device of the same type (and the same
   * address when both have one) exists: a wired headset (type 3) has an input twin, plain headphones (type 4) do not,
   * Bluetooth SCO appears on both sides. Built-in earpiece/speaker use the built-in microphone, so they count as having one.
   */
  fun build(outputs: List<RawAudioDevice>, inputs: List<RawAudioDevice>): List<DeviceInfo> =
    outputs.map { out ->
      val kind = kindOf(out.type)
      val builtIn = kind == DeviceKind.EARPIECE || kind == DeviceKind.SPEAKER
      val twin = inputs.any { it.type == out.type && (it.address.isEmpty() || out.address.isEmpty() || it.address == out.address) }
      DeviceInfo(id = out.id.toString(), kind = kind, name = out.name, hasMic = builtIn || twin)
    }
}
