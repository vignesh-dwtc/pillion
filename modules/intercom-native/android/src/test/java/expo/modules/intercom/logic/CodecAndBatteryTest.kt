package expo.modules.intercom.logic

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CodecAndBatteryTest {
  @Test fun base64KnownVectorsAndRoundTrip() {
    assertEquals("", Base64Codec.encode(ByteArray(0)))
    assertEquals("Zg==", Base64Codec.encode("f".toByteArray()))
    assertEquals("Zm9vYmFy", Base64Codec.encode("foobar".toByteArray()))
    val all = ByteArray(256) { it.toByte() }
    assertArrayEquals(all, Base64Codec.decode(Base64Codec.encode(all)))
  }

  @Test fun base64Slice() {
    assertEquals("b2Jh", Base64Codec.encode("foobar".toByteArray(), 2, 3))
  }

  @Test fun base64RejectsGarbageAndBadRange() {
    try {
      Base64Codec.decode("not base64!")
      fail()
    } catch (_: IllegalArgumentException) {
    }
    try {
      Base64Codec.encode(ByteArray(2), 1, 5)
      fail()
    } catch (_: IllegalArgumentException) {
    }
  }

  @Test fun batteryPercent() {
    assertEquals(50, BatteryMath.percent(50, 100))
    assertEquals(67, BatteryMath.percent(2, 3))
    assertEquals(100, BatteryMath.percent(120, 100))
    assertNull(BatteryMath.percent(-1, 100))
    assertNull(BatteryMath.percent(10, 0))
  }

  @Test fun charging() {
    assertTrue(BatteryMath.isCharging(2))
    assertTrue(BatteryMath.isCharging(5))
    assertFalse(BatteryMath.isCharging(3))
  }
}
