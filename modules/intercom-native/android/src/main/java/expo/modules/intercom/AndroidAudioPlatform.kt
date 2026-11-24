package expo.modules.intercom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import expo.modules.intercom.logic.AudioDeviceList
import expo.modules.intercom.logic.AudioPlatform
import expo.modules.intercom.logic.DeviceInfo
import expo.modules.intercom.logic.RawAudioDevice

/** [AudioPlatform] over AudioManager: one delegation per method, no decisions (those are in AudioRouteController). */
class AndroidAudioPlatform(private val context: Context, private val am: AudioManager) : AudioPlatform {
  override val sdkInt: Int = Build.VERSION.SDK_INT

  override fun listDevices(): List<DeviceInfo> {
    val outputs = if (sdkInt >= 31) {
      am.availableCommunicationDevices.map(::raw)
    } else {
      am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map(::raw)
    }
    val inputs = am.getDevices(AudioManager.GET_DEVICES_INPUTS).map(::raw)
    return AudioDeviceList.build(outputs, inputs)
  }

  override fun getMode(): Int = am.mode

  override fun setMode(mode: Int) {
    am.mode = mode
  }

  override fun hasBluetoothPermission(): Boolean =
    sdkInt < 31 ||
      context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

  override fun setCommunicationDevice(id: String): Boolean {
    if (sdkInt < 31) return false
    val device = am.availableCommunicationDevices.firstOrNull { it.id.toString() == id } ?: return false
    return try {
      am.setCommunicationDevice(device)
    } catch (_: IllegalArgumentException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  override fun clearCommunicationDevice() {
    if (sdkInt >= 31) am.clearCommunicationDevice()
  }

  // Legacy calls, reached only below API 31 (AudioRouteController.modern is false there).
  @Suppress("DEPRECATION")
  override fun isSpeakerphoneOn(): Boolean = am.isSpeakerphoneOn

  @Suppress("DEPRECATION")
  override fun setSpeakerphoneOn(on: Boolean) {
    am.isSpeakerphoneOn = on
  }

  @Suppress("DEPRECATION")
  override fun isBluetoothScoOn(): Boolean = am.isBluetoothScoOn

  @Suppress("DEPRECATION")
  override fun setBluetoothScoOn(on: Boolean) {
    am.isBluetoothScoOn = on
  }

  @Suppress("DEPRECATION")
  override fun startBluetoothSco() {
    am.startBluetoothSco()
  }

  @Suppress("DEPRECATION")
  override fun stopBluetoothSco() {
    am.stopBluetoothSco()
  }

  private fun raw(d: AudioDeviceInfo) = RawAudioDevice(d.id, d.type, d.productName?.toString().orEmpty(), d.address.orEmpty())
}
