package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** A manual scheduler: tasks run only when the test advances time, like a Handler on a frozen clock. */
private class FakeScheduler : TimerScheduler {
  class Entry(val at: Long, val task: Runnable) {
    var cancelled = false
  }

  var now = 0L
  val entries = mutableListOf<Entry>()

  override fun schedule(delayMs: Long, task: Runnable): Any = Entry(now + delayMs, task).also { entries.add(it) }

  override fun cancel(token: Any) {
    (token as Entry).cancelled = true
  }

  /** Runs every due, non-cancelled task in time order (a cancelled task the platform had already dequeued: [runStale]). */
  fun advance(ms: Long) {
    now += ms
    while (true) {
      val due = entries.filter { it.at <= now && !it.cancelled }.minByOrNull { it.at } ?: return
      entries.remove(due)
      due.task.run()
    }
  }

  fun runStale() = entries.toList().forEach { it.task.run() }
}

class TimerQueueTest {
  private val scheduler = FakeScheduler()
  private val fired = mutableListOf<Int>()
  private val queue = TimerQueue(scheduler, onFire = { fired.add(it) }, maxTimers = 3)

  @Test fun firesOnceAfterTheDelayInDueOrder() {
    assertTrue(queue.schedule(1, 6000.0))
    assertTrue(queue.schedule(2, 2000.0))
    scheduler.advance(1999)
    assertEquals(emptyList<Int>(), fired)
    scheduler.advance(1)
    assertEquals(listOf(2), fired)
    scheduler.advance(4000)
    assertEquals(listOf(2, 1), fired)
    scheduler.advance(100_000)
    assertEquals(listOf(2, 1), fired)
    assertEquals(0, queue.size())
  }

  @Test fun cancelledTimersNeverFireEvenIfAlreadyDequeued() {
    queue.schedule(7, 10.0)
    queue.cancel(7)
    scheduler.runStale() // the platform ran the task anyway (removeCallbacks raced with the Looper)
    scheduler.advance(1000)
    assertEquals(emptyList<Int>(), fired)
    queue.cancel(7) // idempotent
    queue.cancel(99) // unknown id
  }

  @Test fun aReplacedTaskThatRunsAnywayDoesNotFireTheNewTimerEarly() {
    queue.schedule(3, 100.0)
    val stale = scheduler.entries.first()
    queue.schedule(3, 500.0)
    stale.task.run()
    assertEquals(emptyList<Int>(), fired)
    assertEquals(1, queue.size())
  }

  @Test fun replacedTimerDoesNotFireButTheNewOneDoes() {
    queue.schedule(3, 100.0)
    queue.schedule(3, 500.0)
    scheduler.advance(100)
    assertEquals(emptyList<Int>(), fired)
    scheduler.advance(400)
    assertEquals(listOf(3), fired)
  }

  @Test fun boundedQueueRefusesBeyondTheLimit() {
    assertTrue(queue.schedule(1, 10.0))
    assertTrue(queue.schedule(2, 10.0))
    assertTrue(queue.schedule(3, 10.0))
    assertFalse(queue.schedule(4, 10.0))
    assertTrue(queue.schedule(3, 20.0)) // replacing an existing id is not growth
    scheduler.advance(10)
    assertTrue(queue.schedule(4, 10.0))
  }

  @Test fun cancelAllDropsEverything() {
    queue.schedule(1, 10.0)
    queue.schedule(2, 20.0)
    queue.cancelAll()
    scheduler.runStale()
    assertEquals(emptyList<Int>(), fired)
    assertEquals(0, queue.size())
  }

  @Test fun delaysAreClamped() {
    assertEquals(0L, TimerQueue.clampDelay(-5.0))
    assertEquals(0L, TimerQueue.clampDelay(Double.NaN))
    assertEquals(2L, TimerQueue.clampDelay(1.2))
    assertEquals(TimerQueue.MAX_DELAY_MS, TimerQueue.clampDelay(Double.POSITIVE_INFINITY))
    queue.schedule(5, -1.0)
    scheduler.advance(0)
    assertEquals(listOf(5), fired)
  }

  @Test fun aHeartbeatChainKeepsTicking() {
    // ping every 2 s re-armed from the callback, as the session does; 10 minutes with no frame callbacks at all.
    var ticks = 0
    lateinit var q: TimerQueue
    q = TimerQueue(scheduler, onFire = { id ->
      ticks++
      q.schedule(id, 2000.0)
    })
    q.schedule(1, 2000.0)
    repeat(300) { scheduler.advance(2000) }
    assertEquals(300, ticks)
  }
}
