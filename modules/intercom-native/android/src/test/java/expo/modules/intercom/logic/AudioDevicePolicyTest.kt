package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioDevicePolicyTest {
  private fun dev(id: String, kind: DeviceKind, mic: Boolean = true) = DeviceInfo(id, kind, id, mic)

  private val earpiece = dev("ear", DeviceKind.EARPIECE)
  private val speaker = dev("spk", DeviceKind.SPEAKER)
  private val sco = dev("sco", DeviceKind.BLUETOOTH_SCO)
  private val le = dev("le", DeviceKind.BLUETOOTH_LE)
  private val wired = dev("wired", DeviceKind.WIRED_HEADSET)
  private val usb = dev("usb", DeviceKind.USB_HEADSET)

  private fun chosen(sel: DeviceSelection): DeviceInfo = (sel as DeviceSelection.Chosen).device

  @Test fun emptyListIsNoHeadset() {
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(emptyList(), 34, allowFallback = false))
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(emptyList(), 34, allowFallback = true))
  }

  @Test fun onlyBuiltInWithoutFallbackIsNoHeadset() {
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(listOf(earpiece, speaker), 34, false))
  }

  @Test fun fallbackPrefersEarpieceThenSpeakerAndIsFlagged() {
    val both = AudioDevicePolicy.select(listOf(speaker, earpiece), 34, true) as DeviceSelection.Chosen
    assertEquals("ear", both.device.id)
    assertTrue(both.isFallback)
    val only = AudioDevicePolicy.select(listOf(speaker), 29, true) as DeviceSelection.Chosen
    assertEquals("spk", only.device.id)
    assertTrue(only.isFallback)
  }

  @Test fun fallbackAllowedButNothingAtAllIsNoHeadset() {
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(listOf(dev("x", DeviceKind.OTHER)), 34, true))
  }

  @Test fun headsetBeatsFallbackEvenWhenFallbackAllowed() {
    val sel = AudioDevicePolicy.select(listOf(earpiece, speaker, wired), 34, true) as DeviceSelection.Chosen
    assertEquals("wired", sel.device.id)
    assertFalse(sel.isFallback)
  }

  @Test fun priorityOrderBleScoWiredUsb() {
    val all = listOf(usb, wired, sco, le, earpiece, speaker)
    assertEquals("le", chosen(AudioDevicePolicy.select(all, 34, false)).id)
    assertEquals("sco", chosen(AudioDevicePolicy.select(all - le, 34, false)).id)
    assertEquals("wired", chosen(AudioDevicePolicy.select(all - le - sco, 34, false)).id)
    assertEquals("usb", chosen(AudioDevicePolicy.select(all - le - sco - wired, 34, false)).id)
  }

  @Test fun bleIgnoredBelowApi31() {
    assertEquals("sco", chosen(AudioDevicePolicy.select(listOf(le, sco), 30, false)).id)
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(listOf(le), 29, false))
    assertEquals("le", chosen(AudioDevicePolicy.select(listOf(le), 31, false)).id)
  }

  @Test fun headsetWithoutMicIsRejected() {
    val noMic = dev("hp", DeviceKind.WIRED_HEADSET, mic = false)
    assertEquals(DeviceSelection.NoHeadset, AudioDevicePolicy.select(listOf(noMic), 34, false))
    assertEquals("usb", chosen(AudioDevicePolicy.select(listOf(noMic, usb), 34, false)).id)
    assertFalse(AudioDevicePolicy.hasAcceptableHeadset(listOf(noMic, earpiece), 34))
  }

  @Test fun headsetWithoutMicFallsBackWhenAllowed() {
    val noMic = dev("hp", DeviceKind.WIRED_HEADSET, mic = false)
    val sel = AudioDevicePolicy.select(listOf(noMic, earpiece), 34, true) as DeviceSelection.Chosen
    assertEquals("ear", sel.device.id)
    assertTrue(sel.isFallback)
  }

  @Test fun otherKindsAreNeverHeadsets() {
    val a2dp = dev("a2dp", DeviceKind.OTHER)
    assertFalse(AudioDevicePolicy.hasAcceptableHeadset(listOf(a2dp), 34))
  }

  @Test fun currentDeviceIsKeptWithinTheBestTier() {
    val sco2 = dev("sco2", DeviceKind.BLUETOOTH_SCO)
    assertEquals("sco2", chosen(AudioDevicePolicy.select(listOf(sco, sco2), 34, false, currentId = "sco2")).id)
    assertEquals("sco", chosen(AudioDevicePolicy.select(listOf(sco, sco2), 34, false, currentId = null)).id)
  }

  @Test fun currentDeviceInLowerTierDoesNotBlockBetterOne() {
    assertEquals("sco", chosen(AudioDevicePolicy.select(listOf(wired, sco), 34, false, currentId = "wired")).id)
  }

  @Test fun fallbackTiersAreNotSticky() {
    // Earpiece is a better fallback tier than the speaker, so a current speaker does not block it.
    assertEquals("ear", chosen(AudioDevicePolicy.select(listOf(earpiece, speaker), 34, true, currentId = "spk")).id)
    val spk2 = dev("spk2", DeviceKind.SPEAKER)
    assertEquals("spk2", chosen(AudioDevicePolicy.select(listOf(speaker, spk2), 34, true, currentId = "spk2")).id)
  }

  @Test fun hasAcceptableHeadsetReflectsApi() {
    assertTrue(AudioDevicePolicy.hasAcceptableHeadset(listOf(le), 33))
    assertFalse(AudioDevicePolicy.hasAcceptableHeadset(listOf(le), 30))
  }
}
