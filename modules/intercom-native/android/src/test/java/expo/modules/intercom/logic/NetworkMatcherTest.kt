package expo.modules.intercom.logic

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkMatcherTest {
  private fun v4(s: String) = NetworkMatcher.numericAddress(s)!!
  private fun prefix(s: String, len: Int) = AddressPrefix(v4(s), len)

  @Test fun parsesNumericLiteralsOnly() {
    assertArrayEquals(byteArrayOf(192.toByte(), 168.toByte(), 43, 1), v4("192.168.43.1"))
    assertNull(NetworkMatcher.numericAddress("256.1.1.1"))
    assertNull(NetworkMatcher.numericAddress("1.2.3"))
    assertNull(NetworkMatcher.numericAddress("phone.local"))
    assertNull(NetworkMatcher.numericAddress(""))
    val ll = NetworkMatcher.numericAddress("fe80::1%wlan0")!!
    assertEquals(16, ll.size)
    assertEquals(0xfe.toByte(), ll[0])
    assertEquals(1.toByte(), ll[15])
    assertEquals(16, NetworkMatcher.numericAddress("2001:db8:0:0:0:0:0:2")!!.size)
    assertEquals(16, NetworkMatcher.numericAddress("::")!!.size)
    assertNull(NetworkMatcher.numericAddress("1::2::3"))
    assertNull(NetworkMatcher.numericAddress("1:2:3:4:5:6:7:8:9"))
    assertNull(NetworkMatcher.numericAddress("12345::1"))
  }

  @Test fun prefixContainment() {
    assertTrue(prefix("192.168.1.0", 24).contains(v4("192.168.1.77")))
    assertFalse(prefix("192.168.1.0", 24).contains(v4("192.168.2.77")))
    assertTrue(prefix("10.0.0.0", 9).contains(v4("10.127.3.4")))
    assertFalse(prefix("10.0.0.0", 9).contains(v4("10.128.3.4")))
    assertFalse(prefix("10.0.0.0", 8).contains(NetworkMatcher.numericAddress("fe80::1")!!))
  }

  @Test fun picksTheWifiNetworkCoveringTheTargetAndIgnoresDefaultRoutes() {
    // Router-only LAN (no internet) next to a Wi-Fi that also carries a default route: only the covering one wins.
    val lan = "wifi-lan" to listOf(prefix("192.168.8.23", 24), prefix("0.0.0.0", 0))
    val other = "wifi-other" to listOf(prefix("10.1.0.5", 16), prefix("0.0.0.0", 0))
    assertEquals("wifi-lan", NetworkMatcher.pick(v4("192.168.8.1"), listOf(other, lan)))
    assertEquals("wifi-other", NetworkMatcher.pick(v4("10.1.200.9"), listOf(other, lan)))
    // Covered only by default routes: leave unbound.
    assertNull(NetworkMatcher.pick(v4("172.20.0.1"), listOf(other, lan)))
    assertNull(NetworkMatcher.pick(v4("192.168.8.1"), emptyList<Pair<String, List<AddressPrefix>>>()))
  }

  @Test fun longestPrefixWins() {
    val wide = "wide" to listOf(prefix("10.0.0.0", 8))
    val narrow = "narrow" to listOf(prefix("10.5.5.0", 24))
    assertEquals("narrow", NetworkMatcher.pick(v4("10.5.5.9"), listOf(wide, narrow)))
    assertEquals("wide", NetworkMatcher.pick(v4("10.6.5.9"), listOf(wide, narrow)))
  }

  @Test fun ipv6LinkLocal() {
    val net = "wifi" to listOf(AddressPrefix(NetworkMatcher.numericAddress("fe80::abcd")!!, 64))
    assertEquals("wifi", NetworkMatcher.pick(NetworkMatcher.numericAddress("fe80::1234%wlan0")!!, listOf(net)))
  }
}
