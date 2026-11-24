package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class LiveSlotTest {
  private class Instance(val name: String)

  @Test fun liveOnlyOnceInTheForegroundAndNotStopping() {
    val slot = LiveSlot<Instance>()
    val a = Instance("a")
    assertNull(slot.live())
    slot.created(a)
    assertNull(slot.live()) // created, startForeground not done yet
    slot.foreground(a)
    assertSame(a, slot.live())
    assertSame(a, slot.markStopping())
    assertNull(slot.live()) // stop() asked: a start() now must not "update" it
    assertTrue(slot.isStopping(a))
    slot.foreground(a) // a late foreground does not revive it
    assertNull(slot.live())
    slot.destroyed(a)
    assertNull(slot.markStopping())
  }

  @Test fun stopThenStartBeforeTheOldInstanceIsDestroyed() {
    // stop() -> start() -> old onDestroy -> new onCreate/onStartCommand (main-thread order on a device).
    val slot = LiveSlot<Instance>()
    val old = Instance("old")
    slot.created(old)
    slot.foreground(old)
    slot.markStopping()
    assertNull(slot.live()) // start() therefore sends a fresh ACTION_START instead of resolving at once
    slot.destroyed(old)
    val fresh = Instance("new")
    slot.created(fresh)
    assertFalse(slot.isStopping(fresh))
    slot.foreground(fresh)
    assertSame(fresh, slot.live())
    slot.destroyed(old) // a stale destroy of another instance changes nothing
    assertSame(fresh, slot.live())
  }

  @Test fun anInstanceThatIsNotCurrentCountsAsStopping() {
    val slot = LiveSlot<Instance>()
    val a = Instance("a")
    val b = Instance("b")
    slot.created(a)
    slot.created(b)
    assertTrue(slot.isStopping(a))
    assertFalse(slot.isStopping(b))
  }
}

class StartRegistryTest {
  @Test fun eachTokenCompletesOnlyItsOwnStart() {
    val registry = StartRegistry<String?>()
    val results = mutableMapOf<String, String?>()
    val oldToken = registry.register { results["old"] = it }
    assertTrue(registry.complete(oldToken, null)) // old instance started fine
    val newToken = registry.register { results["new"] = it }
    // Old instance destroyed after stop(): it fails only the tokens it received (already completed: ignored).
    assertFalse(registry.complete(oldToken, "service destroyed before it started"))
    assertEquals(mapOf<String, String?>("old" to null), results)
    // The fresh instance reports success for the new start.
    assertTrue(registry.complete(newToken, null))
    assertEquals(mapOf<String, String?>("old" to null, "new" to null), results)
    assertFalse(registry.complete(newToken, "late"))
    assertEquals(0, registry.size())
  }

  @Test fun forgottenTokensAreIgnoredAndTokensAreUnique() {
    val registry = StartRegistry<Int>()
    var calls = 0
    val a = registry.register { calls++ }
    val b = registry.register { calls++ }
    assertTrue(a != b)
    registry.forget(a)
    assertFalse(registry.complete(a, 1))
    assertTrue(registry.complete(b, 1))
    assertFalse(registry.complete(12345L, 1))
    assertEquals(1, calls)
  }
}
