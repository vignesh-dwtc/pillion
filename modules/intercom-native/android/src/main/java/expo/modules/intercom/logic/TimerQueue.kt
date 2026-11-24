package expo.modules.intercom.logic

/** Platform scheduler under [TimerQueue]: an Android Handler in the app, a fake in tests. */
interface TimerScheduler {
  /** Runs [task] once after [delayMs]; returns a token for [cancel]. */
  fun schedule(delayMs: Long, task: Runnable): Any

  fun cancel(token: Any)
}

/**
 * One-shot timers keyed by a JS-chosen id, for the ride clock (`scheduleTimer` / `cancelTimer` / `onTimer` of
 * IntercomRideService). Why native: React Native's JS timers fire from a Choreographer frame callback that stops while
 * the host is paused (screen off), so heartbeats and reconnect backoff would freeze during a ride.
 *
 * - Scheduling an id that is already pending replaces it (the old one never fires).
 * - A timer fires at most once and [onFire] is never called for a cancelled or replaced timer, even when the platform
 *   had already dequeued its task (the token check under the lock decides).
 * - At most [maxTimers] pending: a leak in JS must not grow the native queue without bound; [schedule] returns false and
 *   the caller falls back.
 * Thread-safe; [onFire] is called outside the lock.
 */
class TimerQueue(
  private val scheduler: TimerScheduler,
  private val onFire: (Int) -> Unit,
  private val maxTimers: Int = DEFAULT_MAX_TIMERS,
) {
  private val pending = HashMap<Int, Any>()

  fun schedule(id: Int, delayMs: Double): Boolean {
    val delay = clampDelay(delayMs)
    val task = FireTask(id)
    synchronized(this) {
      val previous = pending.remove(id)
      if (previous != null) scheduler.cancel(previous)
      if (pending.size >= maxTimers) return false
      task.token = scheduler.schedule(delay, task)
      pending[id] = task.token!!
    }
    return true
  }

  fun cancel(id: Int) {
    synchronized(this) { pending.remove(id) }?.let(scheduler::cancel)
  }

  fun cancelAll() {
    val tokens = synchronized(this) { pending.values.toList().also { pending.clear() } }
    tokens.forEach(scheduler::cancel)
  }

  @Synchronized fun size(): Int = pending.size

  private inner class FireTask(private val id: Int) : Runnable {
    @Volatile var token: Any? = null

    override fun run() {
      val fire = synchronized(this@TimerQueue) {
        val current = pending[id]
        if (current != null && current === token) {
          pending.remove(id)
          true
        } else {
          false
        }
      }
      if (fire) onFire(id)
    }
  }

  companion object {
    const val DEFAULT_MAX_TIMERS = 1024
    /** One day: longer delays (or NaN/Infinity) are clamped; the ride clock never needs more. */
    const val MAX_DELAY_MS = 86_400_000L

    fun clampDelay(delayMs: Double): Long = when {
      delayMs.isNaN() || delayMs <= 0.0 -> 0L
      delayMs >= MAX_DELAY_MS -> MAX_DELAY_MS
      else -> kotlin.math.ceil(delayMs).toLong()
    }
  }
}
