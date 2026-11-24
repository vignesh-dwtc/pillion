package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PeerTrackerTest {
  private val pairId = "Ab3_-xYz09QwErTy"
  private val tracker = PeerTracker("_pillion._tcp", pairId, "pn-")
  private val name = "pn-$pairId"

  @Test fun acceptsOnlyOurTypeAndPair() {
    assertTrue(tracker.isOurs(name, "_pillion._tcp."))
    assertTrue(tracker.isOurs(name, "_PILLION._tcp"))
    assertTrue(tracker.isOurs("$name (2)", null))
    assertFalse(tracker.isOurs(name, "_other._tcp."))
    assertFalse(tracker.isOurs("pn-someoneElse", "_pillion._tcp."))
    assertFalse(tracker.isOurs("printer", "_pillion._tcp."))
  }

  @Test fun reportsFoundOncePerHostPortAndPrefersPrivateIpv4() {
    val first = tracker.resolved(name, listOf("fe80::1%wlan0", "2001:db8::5", "192.168.1.20"), 40000)
    assertEquals(PeerEvent(PeerEvent.FOUND, name, "192.168.1.20", 40000), first)
    assertNull(tracker.resolved(name, listOf("192.168.1.20"), 40000))
    val moved = tracker.resolved(name, listOf("192.168.1.21"), 40000)
    assertEquals("192.168.1.21", moved?.host)
    val newPort = tracker.resolved(name, listOf("192.168.1.21"), 40001)
    assertEquals(40001, newPort?.port)
  }

  @Test fun ignoresUnusableResolutions() {
    assertNull(tracker.resolved(name, listOf("fe80::1"), 40000))
    assertNull(tracker.resolved(name, emptyList(), 40000))
    assertNull(tracker.resolved(name, listOf("10.0.0.2"), 0))
    assertNull(tracker.resolved("pn-other", listOf("10.0.0.2"), 4000))
  }

  @Test fun lostOnlyAfterFoundAndThenFoundAgain() {
    assertNull(tracker.lost(name))
    tracker.resolved(name, listOf("10.0.0.2"), 4000)
    assertEquals(PeerEvent(PeerEvent.LOST, name, null, null), tracker.lost(name))
    assertNull(tracker.lost(name))
    assertEquals(PeerEvent.FOUND, tracker.resolved(name, listOf("10.0.0.2"), 4000)?.kind)
  }

  @Test fun resetForgetsReports() {
    tracker.resolved(name, listOf("10.0.0.2"), 4000)
    tracker.reset()
    assertEquals(PeerEvent.FOUND, tracker.resolved(name, listOf("10.0.0.2"), 4000)?.kind)
  }

  @Test fun wireShape() {
    assertEquals(
      mapOf("kind" to "found", "serviceName" to name, "host" to "10.0.0.2", "port" to 4000),
      PeerEvent(PeerEvent.FOUND, name, "10.0.0.2", 4000).toWire(),
    )
  }
}

class ResolveQueueTest {
  @Test fun oneInFlightRestInOrderWithoutDuplicates() {
    val q = ResolveQueue<String>()
    assertTrue(q.offer("a"))
    assertFalse(q.offer("b"))
    assertFalse(q.offer("c"))
    assertFalse(q.offer("a")) // in flight
    assertFalse(q.offer("b")) // waiting
    assertEquals(2, q.waitingCount())
    assertEquals("b", q.done("a"))
    assertEquals("c", q.done("b"))
    assertNull(q.done("c"))
    assertNull(q.inFlight())
    assertTrue(q.offer("d"))
  }

  @Test fun doneForAKeyNotInFlightIsIgnored() {
    val q = ResolveQueue<String>()
    q.offer("a")
    q.offer("b")
    assertNull(q.done("b"))
    assertEquals("a", q.inFlight())
  }

  @Test fun removeDropsWaitingAndClearResets() {
    val q = ResolveQueue<String>()
    q.offer("a")
    q.offer("b")
    q.offer("c")
    q.remove("b")
    assertEquals("c", q.done("a"))
    q.clear()
    assertNull(q.inFlight())
    assertTrue(q.offer("x"))
  }
}

class LockHoldersTest {
  @Test fun heldWhileAnyHolderExists() {
    val h = LockHolders()
    assertTrue(h.add("discovery"))
    assertFalse(h.add("explicit"))
    assertFalse(h.add("explicit"))
    assertFalse(h.remove("discovery"))
    assertTrue(h.isHeld())
    assertTrue(h.remove("explicit"))
    assertFalse(h.isHeld())
    assertFalse(h.remove("explicit"))
  }

  @Test fun clearReportsWhetherSomethingWasHeld() {
    val h = LockHolders()
    assertFalse(h.clear())
    h.add("a")
    assertTrue(h.clear())
    assertFalse(h.isHeld())
  }
}

class NetworkLossTest {
  private fun c(id: String, local: String?) = ConnectionInfo(id, local, "10.0.0.9", "wlan0")
  private fun iface(name: String, up: Boolean, vararg addresses: String) =
    IfaceInfo(name, IfaceKind.WIFI, addresses.toList(), up, true)

  @Test fun closesOnlyConnectionsWhoseAddressVanished() {
    val conns = listOf(c("c1", "192.168.1.5"), c("c2", "192.168.49.1"), c("c3", null), c("c4", "fe80::2%wlan0"))
    val ifaces = listOf(iface("p2p-wlan0-0", true, "192.168.49.1"), iface("wlan0", false, "192.168.1.5", "fe80::2%wlan0"))
    assertEquals(listOf("c1", "c4"), NetworkLoss.lostConnections(conns, ifaces))
  }

  @Test fun bareStripsScopeAndMappedPrefix() {
    assertEquals("fe80::1", NetworkLoss.bare("FE80::1%wlan0"))
    assertEquals("10.0.0.2", NetworkLoss.bare("::ffff:10.0.0.2"))
    assertEquals("10.0.0.2", NetworkLoss.bare("10.0.0.2"))
  }
}

class ServiceTypeValidationTest {
  @Test fun validTypes() {
    for (t in listOf("_pillion._tcp", "_a._udp", "_x-y2._tcp", "_abcdefghijklmno._tcp")) {
      assertTrue(t, NsdServiceNames.isValidServiceType(t))
    }
  }

  @Test fun invalidTypes() {
    for (t in listOf("", "pillion._tcp", "_pillion._tcp.", "_pillion", "_-a._tcp", "_a-._tcp", "_abcdefghijklmnop._tcp", "_a b._tcp", "_a._sctp")) {
      assertFalse(t, NsdServiceNames.isValidServiceType(t))
    }
  }
}
