package expo.modules.intercom.logic

/**
 * Foreground-service type mask for `startForeground(id, notification, type)`.
 * Values are ServiceInfo constants (checked against android.jar 36/37 and api-versions.xml):
 * FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE = 16 (API 29), FOREGROUND_SERVICE_TYPE_MICROPHONE = 128 (API 30).
 * The microphone type does not exist on API 29, so it is left out there (microphone access in a foreground service has no
 * type gate on 29). The manifest declares `microphone|connectedDevice`; the mask is always a subset of it.
 */
object ServiceTypes {
  const val CONNECTED_DEVICE = 16
  const val MICROPHONE = 128
  const val API_MICROPHONE_TYPE = 30

  fun mask(sdkInt: Int): Int = if (sdkInt >= API_MICROPHONE_TYPE) MICROPHONE or CONNECTED_DEVICE else CONNECTED_DEVICE
}

/**
 * Wi-Fi lock modes to hold during a ride. WifiManager docs: WIFI_MODE_FULL_LOW_LATENCY (4, API 29) is only active while
 * the screen is on and the app is in the foreground; for an app holding both, WIFI_MODE_FULL_HIGH_PERF (3) "will take
 * effect otherwise" (screen off: the whole ride). From API 34 HIGH_PERF is deprecated and silently becomes a LOW_LATENCY
 * lock, so it is only requested below 34.
 */
object WifiLockPlan {
  const val MODE_FULL_HIGH_PERF = 3
  const val MODE_FULL_LOW_LATENCY = 4
  const val API_HIGH_PERF_DEPRECATED = 34

  fun modes(sdkInt: Int): List<Int> =
    if (sdkInt >= API_HIGH_PERF_DEPRECATED) listOf(MODE_FULL_LOW_LATENCY) else listOf(MODE_FULL_LOW_LATENCY, MODE_FULL_HIGH_PERF)
}

/** Notification-button actions (`NativeRideAction`). Intent actions are namespaced by the caller's package at runtime. */
enum class RideAction(val wireName: String, val intentSuffix: String) {
  TOGGLE_MUTE("toggle-mute", "TOGGLE_MUTE"),
  END("end", "END"),
  ;

  companion object {
    fun fromIntentSuffix(suffix: String?): RideAction? = entries.firstOrNull { it.intentSuffix == suffix }
  }
}

/**
 * Buffer of one for notification actions pressed while JS has no listener (spec: only the most recent press matters).
 * Thread-safe; the sink is called outside the lock.
 */
class ActionBuffer {
  private var sink: ((RideAction) -> Unit)? = null
  private var pending: RideAction? = null

  fun setSink(newSink: ((RideAction) -> Unit)?) {
    val deliver: RideAction?
    synchronized(this) {
      sink = newSink
      deliver = if (newSink != null) pending else null
      if (deliver != null) pending = null
    }
    if (deliver != null) newSink?.invoke(deliver)
  }

  fun dispatch(action: RideAction) {
    val current: ((RideAction) -> Unit)?
    synchronized(this) {
      current = sink
      if (current == null) pending = action
    }
    current?.invoke(action)
  }

  @Synchronized fun pending(): RideAction? = pending

  @Synchronized fun clear() {
    pending = null
  }
}

/** Notification content as JS sent it; labels default to plain English only when JS omitted them. */
data class RideNotificationModel(
  val title: String,
  val text: String,
  val muted: Boolean,
  val connected: Boolean,
  val muteLabel: String = DEFAULT_MUTE,
  val unmuteLabel: String = DEFAULT_UNMUTE,
  val endLabel: String = DEFAULT_END,
) {
  /** Label of the mute button: shows what pressing it will do. */
  val toggleLabel: String get() = if (muted) unmuteLabel else muteLabel

  companion object {
    const val DEFAULT_MUTE = "Mute"
    const val DEFAULT_UNMUTE = "Unmute"
    const val DEFAULT_END = "End"
    /** Notification text is capped: the shade truncates anyway and an unbounded string from JS has no use there. */
    const val MAX_TEXT = 200

    fun sanitize(s: String?): String = (s ?: "").trim().take(MAX_TEXT)

    fun label(s: String?, fallback: String): String = sanitize(s).ifEmpty { fallback }
  }
}

enum class StartDecision { OK, PERMISSION, BACKGROUND }

/**
 * Whether `start` may try to start the microphone foreground service now. ActivityManager importance values:
 * IMPORTANCE_FOREGROUND = 100, IMPORTANCE_FOREGROUND_SERVICE = 125, IMPORTANCE_VISIBLE = 200. A visible activity
 * (<= 200) is required for a fresh start (Android 14+ refuses a microphone FGS from the background, and Android 11+
 * gives a background-started one no microphone). Updating an already running service is always allowed.
 */
object StartGate {
  const val IMPORTANCE_VISIBLE = 200

  fun decide(alreadyRunning: Boolean, importance: Int, recordAudioGranted: Boolean): StartDecision = when {
    !recordAudioGranted -> StartDecision.PERMISSION
    alreadyRunning -> StartDecision.OK
    importance in 1..IMPORTANCE_VISIBLE -> StartDecision.OK
    else -> StartDecision.BACKGROUND
  }
}
