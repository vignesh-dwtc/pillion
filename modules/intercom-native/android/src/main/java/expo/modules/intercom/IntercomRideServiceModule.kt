package expo.modules.intercom

import android.Manifest
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import expo.modules.intercom.logic.BatteryMath
import expo.modules.intercom.logic.RideNotificationModel
import expo.modules.intercom.logic.StartDecision
import expo.modules.intercom.logic.StartGate
import expo.modules.intercom.logic.TimerQueue
import expo.modules.intercom.logic.TimerScheduler
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
 *
 * Ride clock: `scheduleTimer(id, delayMs)` / `cancelTimer(id)` / `onTimer {id}` are one-shot timers on a Handler thread of
 * this module ([TimerQueue]). React Native's JS timers fire from Choreographer frame callbacks, which stop while the host
 * is paused (screen off); these do not. Handler delays count uptime, which does not advance in deep sleep, and the ride
 * service holds a partial wake lock for the whole ride, so during a ride they fire on time.
 *
 * Teardown: when the module is destroyed (React instance teardown, dev reload) a running ride service is stopped, so the
 * wake and Wi-Fi locks are never held without a JS session that can end them.
 */
class IntercomRideServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val waiter = Executors.newSingleThreadExecutor { r -> Thread(r, "intercom-ride-start").apply { isDaemon = true } }

  private var timerThread: HandlerThread? = null
  @Volatile private var timerQueue: TimerQueue? = null

  /** Created on first use; the thread exists only once JS uses the ride clock. */
  @Synchronized private fun timers(): TimerQueue {
    timerQueue?.let { return it }
    val thread = HandlerThread("intercom-ride-timer").apply { start() }
    val handler = Handler(thread.looper)
    val queue = TimerQueue(
      object : TimerScheduler {
        override fun schedule(delayMs: Long, task: Runnable): Any {
          handler.postDelayed(task, delayMs)
          return task
        }

        override fun cancel(token: Any) {
          handler.removeCallbacks(token as Runnable)
        }
      },
      onFire = { id -> sendEvent("onTimer", mapOf("id" to id)) },
    )
    timerThread = thread
    timerQueue = queue
    return queue
  }

  @Synchronized private fun shutdownTimers() {
    timerQueue?.cancelAll()
    timerThread?.quitSafely()
    timerQueue = null
    timerThread = null
  }

  override fun definition() = ModuleDefinition {
    Name("IntercomRideService")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onAction", "onTimer")

    OnStartObserving("onAction") {
      RideBus.actions.setSink { action -> sendEvent("onAction", mapOf("action" to action.wireName)) }
    }

    OnStopObserving("onAction") {
      RideBus.actions.setSink(null)
    }

    OnDestroy {
      RideBus.actions.setSink(null)
      // No JS session can end the ride any more: stop the service so its wake and Wi-Fi locks are released.
      RideBus.requestStop()
      RideBus.actions.clear()
      shutdownTimers()
      waiter.shutdownNow()
    }

    // Sync functions (JS thread): cheap, and their order relative to each other is the call order.
    Function("scheduleTimer") { id: Int, delayMs: Double -> timers().schedule(id, delayMs) }

    Function("cancelTimer") { id: Int -> timerQueue?.cancel(id); Unit }

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
      val live = RideBus.service // never an instance that stop() already asked to go away
      if (live != null) {
        live.update(modelOf(options.notification))
        promise.resolve(null)
        return@AsyncFunction
      }
      val future = CompletableFuture<StartOutcome>()
      val token = RideBus.starts.register { outcome -> future.complete(outcome) }
      val intent = Intent(ctx, RideForegroundService::class.java)
        .setAction(RideForegroundService.ACTION_START)
        .putExtra(RideForegroundService.EXTRA_START_TOKEN, token)
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
        RideBus.starts.forget(token)
        promise.reject(RideForegroundService.ERR_BACKGROUND, "startForegroundService refused: ${e.javaClass.simpleName}", null)
        return@AsyncFunction
      } catch (e: SecurityException) {
        RideBus.starts.forget(token)
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
          RideBus.starts.forget(token)
        }
      }
    }

    AsyncFunction("update") { notification: RideNotificationRecord ->
      RideBus.service?.update(modelOf(notification))
    }

    AsyncFunction("stop") {
      // The instance stops being live at once (a start() right after this starts a fresh one); stopSelf is allowed from
      // any state, and onDestroy releases the locks and removes the notification.
      RideBus.requestStop()
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
