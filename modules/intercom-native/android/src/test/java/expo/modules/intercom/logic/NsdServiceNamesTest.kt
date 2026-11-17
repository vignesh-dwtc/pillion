package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NsdServiceNamesTest {
  private val pairId = "Ab3_-xYz09QwErTy"

  @Test fun buildsPrefixPlusPairId() {
    assertEquals("pn-$pairId", NsdServiceNames.build(pairId))
    assertEquals("x-$pairId", NsdServiceNames.build(pairId, "x-"))
  }

  @Test fun roundTrips() {
    assertEquals(pairId, NsdServiceNames.parsePairId(NsdServiceNames.build(pairId)))
  }

  @Test fun toleratesNsdConflictSuffix() {
    assertEquals(pairId, NsdServiceNames.parsePairId("pn-$pairId (2)"))
    assertEquals(pairId, NsdServiceNames.parsePairId("pn-$pairId (13)"))
    assertTrue(NsdServiceNames.matches("pn-$pairId (2)", pairId))
  }

  @Test fun rejectsForeignNames() {
    assertNull(NsdServiceNames.parsePairId("printer-1"))
    assertNull(NsdServiceNames.parsePairId("pn-"))
    assertNull(NsdServiceNames.parsePairId("pn-bad id"))
    assertNull(NsdServiceNames.parsePairId("PN-$pairId"))
    assertNull(NsdServiceNames.parsePairId("pn-$pairId (x)"))
    assertFalse(NsdServiceNames.matches("pn-$pairId", "other"))
  }

  @Test fun buildRejectsBadInput() {
    for (bad in listOf("", "has space", "a.b", "a/b", "ü")) {
      try {
        NsdServiceNames.build(bad)
        fail("expected failure for '$bad'")
      } catch (_: IllegalArgumentException) {
      }
    }
  }

  @Test fun buildRejectsTooLong() {
    try {
      NsdServiceNames.build("a".repeat(61)) // 3 + 61 = 64 bytes
      fail("expected failure")
    } catch (_: IllegalArgumentException) {
    }
    assertEquals(63, NsdServiceNames.build("a".repeat(60)).length)
  }

  @Test fun serviceTypeComparisonIgnoresTrailingDotAndCase() {
    assertTrue(NsdServiceNames.sameServiceType("_pillion._tcp.", "_pillion._tcp"))
    assertTrue(NsdServiceNames.sameServiceType("_Pillion._TCP", "_pillion._tcp."))
    assertFalse(NsdServiceNames.sameServiceType("_pillion._udp", "_pillion._tcp"))
  }
}
