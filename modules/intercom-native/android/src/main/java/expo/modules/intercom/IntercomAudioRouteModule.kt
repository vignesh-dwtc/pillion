package expo.modules.intercom

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import expo.modules.intercom.logic.AudioDeviceList
import expo.modules.intercom.logic.AudioDevicePolicy
import expo.modules.intercom.logic.DeviceInfo
import expo.modules.intercom.logic.DeviceSelection
import expo.modules.intercom.logic.RawAudioDevice
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS name `IntercomAudioRoute` (see specs/IntercomAudioRoute.ts). M0 skeleton: getState() lists devices and applies
 * the selection policy read-only (audio mode and routing are NOT touched); start/stop/cues are M1.
 */
class IntercomAudioRouteModule : Module() {
  private val audioManager: AudioManager
    get() = (appContext.reactContext ?: throw Exceptions.ReactContextLost())
      .getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun definition() = ModuleDefinition {
    Name("IntercomAudioRoute")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onChange")

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("getState") { snapshot() }

    AsyncFunction("start") { _: Map<String, Any?> -> notYet("start") }
    AsyncFunction("stop") { notYet("stop") }
    AsyncFunction("setAllowFallback") { _: Boolean -> notYet("setAllowFallback") }
    AsyncFunction("playCue") { _: String -> notYet("playCue") }
  }

  private fun snapshot(): Map<String, Any?> {
    val am = audioManager
    val outputs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map(::raw)
    val inputs = am.getDevices(AudioManager.GET_DEVICES_INPUTS).map(::raw)
    val devices = AudioDeviceList.build(outputs, inputs)
    val sdk = Build.VERSION.SDK_INT
    val headset = AudioDevicePolicy.hasAcceptableHeadset(devices, sdk)
    return mapOf(
      "status" to "inactive",
      "communicationMode" to false,
      "devices" to devices.map(::wire),
      "activeDeviceId" to null,
      "headsetConnected" to headset,
      "usingFallback" to false,
      "error" to null,
      // What start() would choose right now, without allowing the fallback; informational.
      "wouldChoose" to (AudioDevicePolicy.select(devices, sdk, allowFallback = false) as? DeviceSelection.Chosen)?.device?.id,
    )
  }

  private fun raw(d: AudioDeviceInfo) = RawAudioDevice(d.id, d.type, d.productName?.toString().orEmpty(), d.address.orEmpty())

  private fun wire(d: DeviceInfo) = mapOf("id" to d.id, "kind" to d.kind.wireName, "name" to d.name, "hasMic" to d.hasMic)
}
