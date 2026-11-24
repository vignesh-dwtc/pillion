package expo.modules.intercom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import expo.modules.intercom.logic.ActionBuffer
import expo.modules.intercom.logic.LiveSlot
import expo.modules.intercom.logic.RideAction
import expo.modules.intercom.logic.RideNotificationModel
import expo.modules.intercom.logic.ServiceTypes
import expo.modules.intercom.logic.StartRegistry
import expo.modules.intercom.logic.WifiLockPlan

/** Outcome of a start request: null on success, else (error code, message). */
typealias StartOutcome = Pair<String, String>?

/**
 * Process-wide link between the Expo module and the service (the service is created by the system, not by us).
 * [slot] knows which instance is live (foreground and not asked to stop); [starts] pairs each start() with the instance
 * that handled its ACTION_START intent (token extra), so a destroyed old instance never completes a newer start.
 */
object RideBus {
  val slot = LiveSlot<RideForegroundService>()
  val starts = StartRegistry<StartOutcome>()
  val actions = ActionBuffer()

  /** The live instance, or null (none, not yet in the foreground, or stopping). */
  val service: RideForegroundService? get() = slot.live()

  val running: Boolean get() = slot.live() != null

  /** Asks the current instance (live or not) to stop; it is no longer live from this call on. Any thread. */
  fun requestStop() {
    slot.markStopping()?.stopSelf()
  }
}

/**
 * The ride's foreground service: types microphone|connectedDevice (manifest) and ServiceTypes.mask(sdk) at
 * startForeground; ongoing low-importance notification with Mute/Unmute and End actions (PendingIntents back to this
 * service, delivered to JS through [RideBus.actions]); a partial wake lock and the Wi-Fi locks of [WifiLockPlan] for the
 * whole ride. START_NOT_STICKY: a ride never restarts by itself from the background (it could not get the microphone on
 * Android 14+ anyway); a new ride always begins with a tap in the app.
 */
class RideForegroundService : Service() {
  @Volatile var isForeground = false
    private set

  private var model: RideNotificationModel? = null
  private var channelId: String? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLocks: List<WifiManager.WifiLock> = emptyList()
  /** Start tokens this instance received (main thread only); onDestroy fails the ones still open. */
  private val startTokens = mutableListOf<Long>()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    RideBus.slot.created(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    when {
      action == ACTION_START -> handleStart(intent, intent.getLongExtra(EXTRA_START_TOKEN, NO_TOKEN))
      action?.startsWith(ACTION_PREFIX) == true -> {
        val rideAction = RideAction.fromIntentSuffix(action.removePrefix(ACTION_PREFIX))
        if (rideAction != null && isForeground) RideBus.actions.dispatch(rideAction)
        if (!isForeground) stopSelf()
      }
      else -> if (!isForeground) stopSelf() // restarted without a ride: nothing to do
    }
    return START_NOT_STICKY
  }

  private fun handleStart(intent: Intent, token: Long) {
    if (token != NO_TOKEN) startTokens.add(token)
    if (RideBus.slot.isStopping(this)) {
      // stop() reached this instance first: it is going away, so it must not take the foreground (start() retries
      // with a fresh instance only if the caller asks again).
      complete(token, ERR_START to "service is stopping")
      return
    }
    val channel = intent.getStringExtra(EXTRA_CHANNEL_ID).orEmpty().ifEmpty { "ride" }
    val channelName = intent.getStringExtra(EXTRA_CHANNEL_NAME).orEmpty().ifEmpty { channel }
    val m = modelFrom(intent)
    channelId = channel
    model = m
    try {
      ensureChannel(channel, channelName)
      val notification = build(m)
      startForeground(NOTIFICATION_ID, notification, ServiceTypes.mask(Build.VERSION.SDK_INT))
    } catch (e: SecurityException) {
      // Android 14+: RECORD_AUDIO missing, or the app is in the background (while-in-use permission).
      complete(token, ERR_PERMISSION to "startForeground refused: ${e.javaClass.simpleName}")
      stopSelf()
      return
    } catch (e: IllegalStateException) {
      // ForegroundServiceStartNotAllowedException (API 31+) extends IllegalStateException; matched by name so API 29-30
      // never resolve the class.
      val background = e.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException"
      complete(token, (if (background) ERR_BACKGROUND else ERR_START) to "startForeground failed: ${e.javaClass.simpleName}")
      stopSelf()
      return
    }
    if (!isForeground) {
      isForeground = true
      acquireLocks()
    }
    RideBus.slot.foreground(this)
    complete(token, null)
  }

  private fun complete(token: Long, outcome: StartOutcome) {
    if (token != NO_TOKEN) RideBus.starts.complete(token, outcome)
  }

  /** Called by the module (any thread) while running. */
  fun update(next: RideNotificationModel) {
    val current = model ?: return
    val merged = next.copy(muteLabel = current.muteLabel, unmuteLabel = current.unmuteLabel, endLabel = current.endLabel)
    model = merged
    if (!isForeground) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(NOTIFICATION_ID, build(merged))
  }

  override fun onDestroy() {
    releaseLocks()
    if (isForeground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      isForeground = false
    }
    RideBus.slot.destroyed(this)
    // Only this instance's own starts: a newer start() waiting for a fresh instance is not touched.
    startTokens.forEach { RideBus.starts.complete(it, ERR_START to "service destroyed before it started") }
    startTokens.clear()
    super.onDestroy()
  }

  private fun acquireLocks() {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "intercom:ride").apply {
      setReferenceCounted(false)
      acquire() // released in onDestroy; a ride has no natural upper bound
    }
    val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    wifiLocks = WifiLockPlan.modes(Build.VERSION.SDK_INT).map { mode ->
      @Suppress("DEPRECATION") // WIFI_MODE_FULL_HIGH_PERF only below API 34 (see WifiLockPlan).
      wifi.createWifiLock(mode, "intercom:ride-$mode").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
  }

  private fun releaseLocks() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    wifiLocks.forEach { if (it.isHeld) it.release() }
    wifiLocks = emptyList()
  }

  private fun ensureChannel(id: String, name: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // IMPORTANCE_LOW: visible in the shade and status bar, no sound, no heads-up.
    val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_LOW).apply {
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    nm.createNotificationChannel(channel)
  }

  private fun build(m: RideNotificationModel): Notification {
    val icon = Icon.createWithResource(this, R.drawable.intercom_ride_notification)
    val builder = Notification.Builder(this, channelId ?: "ride")
      .setSmallIcon(icon)
      .setContentTitle(m.title)
      .setContentText(m.text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(Notification.Action.Builder(icon, m.toggleLabel, actionIntent(RideAction.TOGGLE_MUTE)).build())
      .addAction(Notification.Action.Builder(icon, m.endLabel, actionIntent(RideAction.END)).build())
    launchIntent()?.let(builder::setContentIntent)
    if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    return builder.build()
  }

  private fun actionIntent(action: RideAction): PendingIntent {
    val intent = Intent(this, RideForegroundService::class.java).setAction(ACTION_PREFIX + action.intentSuffix)
    return PendingIntent.getService(
      this,
      action.ordinal + 1,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun launchIntent(): PendingIntent? {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  companion object {
    const val NOTIFICATION_ID = 4711
    /** Namespaced by the class (product-neutral); intents are explicit and the service is not exported. */
    const val ACTION_PREFIX = "expo.modules.intercom.ride."
    const val ACTION_START = ACTION_PREFIX + "START"
    const val EXTRA_START_TOKEN = "startToken"
    const val NO_TOKEN = -1L
    const val EXTRA_CHANNEL_ID = "channelId"
    const val EXTRA_CHANNEL_NAME = "channelName"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_MUTED = "muted"
    const val EXTRA_CONNECTED = "connected"
    const val EXTRA_LABEL_MUTE = "labelMute"
    const val EXTRA_LABEL_UNMUTE = "labelUnmute"
    const val EXTRA_LABEL_END = "labelEnd"

    const val ERR_PERMISSION = "ERR_RIDE_PERMISSION"
    const val ERR_BACKGROUND = "ERR_RIDE_BACKGROUND_START"
    const val ERR_START = "ERR_RIDE_START"

    fun modelFrom(intent: Intent) = RideNotificationModel(
      title = RideNotificationModel.sanitize(intent.getStringExtra(EXTRA_TITLE)),
      text = RideNotificationModel.sanitize(intent.getStringExtra(EXTRA_TEXT)),
      muted = intent.getBooleanExtra(EXTRA_MUTED, false),
      connected = intent.getBooleanExtra(EXTRA_CONNECTED, false),
      muteLabel = RideNotificationModel.label(intent.getStringExtra(EXTRA_LABEL_MUTE), RideNotificationModel.DEFAULT_MUTE),
      unmuteLabel = RideNotificationModel.label(intent.getStringExtra(EXTRA_LABEL_UNMUTE), RideNotificationModel.DEFAULT_UNMUTE),
      endLabel = RideNotificationModel.label(intent.getStringExtra(EXTRA_LABEL_END), RideNotificationModel.DEFAULT_END),
    )
  }
}
