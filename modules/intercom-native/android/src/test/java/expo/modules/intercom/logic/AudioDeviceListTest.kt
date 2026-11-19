package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioDeviceListTest {
  @Test fun kindMapping() {
    assertEquals(DeviceKind.BLUETOOTH_SCO, AudioDeviceList.kindOf(7))
    assertEquals(DeviceKind.BLUETOOTH_LE, AudioDeviceList.kindOf(26))
    assertEquals(DeviceKind.WIRED_HEADSET, AudioDeviceList.kindOf(3))
    assertEquals(DeviceKind.WIRED_HEADSET, AudioDeviceList.kindOf(4))
    assertEquals(DeviceKind.USB_HEADSET, AudioDeviceList.kindOf(22))
    assertEquals(DeviceKind.EARPIECE, AudioDeviceList.kindOf(1))
    assertEquals(DeviceKind.SPEAKER, AudioDeviceList.kindOf(2))
    assertEquals(DeviceKind.OTHER, AudioDeviceList.kindOf(8)) // A2DP: output only, not a communication device
    assertEquals(DeviceKind.OTHER, AudioDeviceList.kindOf(0))
  }

  @Test fun micTwinDecidesHasMic() {
    val outputs = listOf(
      RawAudioDevice(1, 2, "Speaker", ""),
      RawAudioDevice(2, 1, "Earpiece", ""),
      RawAudioDevice(3, 7, "Buds", "AA:BB"),
      RawAudioDevice(4, 4, "Plain headphones", ""),
      RawAudioDevice(5, 3, "Headset", ""),
    )
    val inputs = listOf(RawAudioDevice(10, 7, "Buds", "AA:BB"), RawAudioDevice(11, 3, "Headset mic", ""))
    val byId = AudioDeviceList.build(outputs, inputs).associateBy { it.id }
    assertTrue(byId.getValue("1").hasMic)
    assertTrue(byId.getValue("2").hasMic)
    assertTrue(byId.getValue("3").hasMic)
    assertFalse(byId.getValue("4").hasMic)
    assertTrue(byId.getValue("5").hasMic)
    assertEquals("bluetooth-sco", byId.getValue("3").kind.wireName)
  }

  @Test fun scoWithDifferentAddressIsNotATwin() {
    val devices = AudioDeviceList.build(
      listOf(RawAudioDevice(3, 7, "Buds", "AA:BB")),
      listOf(RawAudioDevice(10, 7, "Other", "CC:DD")),
    )
    assertFalse(devices.single().hasMic)
  }

  @Test fun endToEndWithPolicy() {
    val devices = AudioDeviceList.build(
      listOf(RawAudioDevice(1, 2, "Speaker", ""), RawAudioDevice(3, 7, "Buds", "AA")),
      listOf(RawAudioDevice(10, 7, "Buds", "AA")),
    )
    val sel = AudioDevicePolicy.select(devices, 30, allowFallback = false) as DeviceSelection.Chosen
    assertEquals("3", sel.device.id)
  }
}
