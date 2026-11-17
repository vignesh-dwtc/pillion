package expo.modules.intercom

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import expo.modules.intercom.logic.BatteryMath
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS name `IntercomRideService` (see specs/IntercomRideService.ts). M0 skeleton: isRunning() and getBattery() are real;
 * the foreground service, notification and locks are M1 (the service declaration and its permissions are added to this
 * module's manifest together with the service class).
 */
class IntercomRideServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IntercomRideService")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onAction")

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("isRunning") { false }

    AsyncFunction("getBattery") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      battery(context)
    }

    AsyncFunction("start") { _: Map<String, Any?> -> notYet("start") }
    AsyncFunction("update") { _: Map<String, Any?> -> notYet("update") }
    AsyncFunction("stop") { notYet("stop") }
  }

  private fun battery(context: Context): Map<String, Any?>? {
    // Sticky broadcast: registerReceiver(null, filter) just returns the last value, nothing stays registered.
    val intent: Intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return null
    val pct = BatteryMath.percent(
      intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1),
      intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1),
    ) ?: return null
    val charging = BatteryMath.isCharging(intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1))
    return mapOf("levelPct" to pct, "charging" to charging)
  }
}
