package expo.modules.intercom

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import expo.modules.intercom.logic.BatteryMath
import expo.modules.intercom.logic.RideNotificationModel
import expo.modules.intercom.logic.StartDecision
import expo.modules.intercom.logic.StartGate
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

class RideNotificationRecord : Record {
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val muted: Boolean = false
  @Field val connected: Boolean = false
}

class RideActionLabels : Record {
  @Field val mute: String = ""
  @Field val unmute: String = ""
  @Field val end: String = ""
}

class RideStartOptions : Record {
  @Field val channelId: String = ""
  @Field val channelName: String = ""
  @Field val notification: RideNotificationRecord = RideNotificationRecord()
  @Field val actionLabels: RideActionLabels? = null
}

/**
 * JS name `IntercomRideService` (see specs/IntercomRideService.ts). Starts/stops [RideForegroundService], forwards
 * notification actions as `onAction` (buffer of one while JS is not listening, see ActionBuffer), reads the battery.
 *
 * start() refuses before touching the service when RECORD_AUDIO is missing (ERR_RIDE_PERMISSION) or the app has no
 * visible activity (ERR_RIDE_BACKGROUND_START; StartGate), then waits up to [START_TIMEOUT_MS] for the service to report
 * the startForeground outcome. Notification permission (API 33+) is not required: the ride runs without it, the
 * notification is just hidden (PermissionService asks for it).
 */
class IntercomRideServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val waiter = Executors.newSingleThreadExecutor { r -> Thread(r, "intercom-ride-start").apply { isDaemon = true } }

  override fun definition() = ModuleDefinition {
    Name("IntercomRideService")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onAction")

    OnStartObserving("onAction") {
      RideBus.actions.setSink { action -> sendEvent("onAction", mapOf("action" to action.wireName)) }
    }

    OnStopObserving("onAction") {
      RideBus.actions.setSink(null)
    }

    OnDestroy {
      RideBus.actions.setSink(null)
      waiter.shutdownNow()
    }

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("isRunning") { RideBus.running }

    AsyncFunction("getBattery") { battery(context) }

    AsyncFunction("start") { options: RideStartOptions, promise: Promise ->
      val ctx = context
      val micGranted = ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
      when (StartGate.decide(RideBus.running, importance(), micGranted)) {
        StartDecision.PERMISSION -> {
          promise.reject(RideForegroundService.ERR_PERMISSION, "RECORD_AUDIO is not granted", null)
          return@AsyncFunction
        }
        StartDecision.BACKGROUND -> {
          promise.reject(RideForegroundService.ERR_BACKGROUND, "start must come from a tap while the app is visible", null)
          return@AsyncFunction
        }
        StartDecision.OK -> Unit
      }
      val running = RideBus.service
      if (running != null && running.isForeground) {
        running.update(modelOf(options.notification))
        promise.resolve(null)
        return@AsyncFunction
      }
      val future = CompletableFuture<StartOutcome>()
      RideBus.pendingStart = future
      val intent = Intent(ctx, RideForegroundService::class.java)
        .setAction(RideForegroundService.ACTION_START)
        .putExtra(RideForegroundService.EXTRA_CHANNEL_ID, options.channelId)
        .putExtra(RideForegroundService.EXTRA_CHANNEL_NAME, options.channelName)
        .putExtra(RideForegroundService.EXTRA_TITLE, options.notification.title)
        .putExtra(RideForegroundService.EXTRA_TEXT, options.notification.text)
        .putExtra(RideForegroundService.EXTRA_MUTED, options.notification.muted)
        .putExtra(RideForegroundService.EXTRA_CONNECTED, options.notification.connected)
      options.actionLabels?.let {
        intent.putExtra(RideForegroundService.EXTRA_LABEL_MUTE, it.mute)
          .putExtra(RideForegroundService.EXTRA_LABEL_UNMUTE, it.unmute)
          .putExtra(RideForegroundService.EXTRA_LABEL_END, it.end)
      }
      try {
        ctx.startForegroundService(intent)
      } catch (e: IllegalStateException) {
        // ForegroundServiceStartNotAllowedException (API 31+) or the pre-31 background-start IllegalStateException.
        RideBus.pendingStart = null
        promise.reject(RideForegroundService.ERR_BACKGROUND, "startForegroundService refused: ${e.javaClass.simpleName}", null)
        return@AsyncFunction
      } catch (e: SecurityException) {
        RideBus.pendingStart = null
        promise.reject(RideForegroundService.ERR_PERMISSION, "startForegroundService refused: ${e.javaClass.simpleName}", null)
        return@AsyncFunction
      }
      waiter.execute {
        try {
          val outcome = future.get(START_TIMEOUT_MS, TimeUnit.MILLISECONDS)
          if (outcome == null) promise.resolve(null) else promise.reject(outcome.first, outcome.second, null)
        } catch (_: TimeoutException) {
          promise.reject(RideForegroundService.ERR_START, "the service did not report within $START_TIMEOUT_MS ms", null)
        } catch (e: Exception) {
          promise.reject(RideForegroundService.ERR_START, "start failed: ${e.javaClass.simpleName}", null)
        } finally {
          if (RideBus.pendingStart === future) RideBus.pendingStart = null
        }
      }
    }

    AsyncFunction("update") { notification: RideNotificationRecord ->
      RideBus.service?.update(modelOf(notification))
    }

    AsyncFunction("stop") {
      // stopService is allowed from any state; onDestroy releases the locks and removes the notification.
      if (RideBus.service != null) context.stopService(Intent(context, RideForegroundService::class.java))
      RideBus.actions.clear()
    }
  }

  private fun modelOf(n: RideNotificationRecord) = RideNotificationModel(
    title = RideNotificationModel.sanitize(n.title),
    text = RideNotificationModel.sanitize(n.text),
    muted = n.muted,
    connected = n.connected,
  )

  private fun importance(): Int {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance
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

  companion object {
    const val START_TIMEOUT_MS = 5_000L
  }
}
