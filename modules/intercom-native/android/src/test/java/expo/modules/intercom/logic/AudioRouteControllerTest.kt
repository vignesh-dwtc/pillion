package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

private class FakeAudio(override val sdkInt: Int) : AudioPlatform {
  val devices = mutableListOf<DeviceInfo>()
  var currentMode = 0
  var speakerOn = false
  var scoOn = false
  var scoStarted = false
  var commDevice: String? = null
  var btPermission = true
  val rejectIds = mutableSetOf<String>()
  val calls = mutableListOf<String>()

  override fun listDevices() = devices.toList()
  override fun getMode() = currentMode
  override fun setMode(mode: Int) {
    calls += "setMode($mode)"
    currentMode = mode
  }
  override fun hasBluetoothPermission() = btPermission
  override fun setCommunicationDevice(id: String): Boolean {
    calls += "setCommunicationDevice($id)"
    if (id in rejectIds) return false
    commDevice = id
    return true
  }
  override fun clearCommunicationDevice() {
    calls += "clearCommunicationDevice"
    commDevice = null
  }
  override fun isSpeakerphoneOn() = speakerOn
  override fun setSpeakerphoneOn(on: Boolean) {
    calls += "setSpeakerphoneOn($on)"
    speakerOn = on
  }
  override fun isBluetoothScoOn() = scoOn
  override fun setBluetoothScoOn(on: Boolean) {
    calls += "setBluetoothScoOn($on)"
    scoOn = on
  }
  override fun startBluetoothSco() {
    calls += "startBluetoothSco"
    scoStarted = true
  }
  override fun stopBluetoothSco() {
    calls += "stopBluetoothSco"
    scoStarted = false
  }
}

class AudioRouteControllerTest {
  private fun dev(id: String, kind: DeviceKind, mic: Boolean = true) = DeviceInfo(id, kind, "n-$id", mic)

  private val earpiece = dev("1", DeviceKind.EARPIECE)
  private val speaker = dev("2", DeviceKind.SPEAKER)
  private val sco = dev("7", DeviceKind.BLUETOOTH_SCO)
  private val le = dev("26", DeviceKind.BLUETOOTH_LE)
  private val wired = dev("3", DeviceKind.WIRED_HEADSET)

  // ---- API 31+ ----------------------------------------------------------------------------------------------------

  @Test fun modernStartRoutesToBluetoothAndStopRestoresEverything() {
    val p = FakeAudio(34).apply { devices += listOf(earpiece, speaker, sco, wired) }
    val c = AudioRouteController(p)
    val s = c.start(allowFallbackDevice = false)
    assertEquals(RouteStatus.ACTIVE, s.status)
    assertEquals("7", s.activeDeviceId)
    assertTrue(s.communicationMode)
    assertTrue(s.headsetConnected)
    assertFalse(s.usingFallback)
    assertEquals(AudioRouteController.MODE_IN_COMMUNICATION, p.currentMode)
    assertEquals("7", p.commDevice)

    c.stop()
    assertEquals(0, p.currentMode)
    assertNull(p.commDevice)
    assertEquals(RouteStatus.INACTIVE, c.state().status)
    assertFalse(c.state().communicationMode)
    // Never touches the legacy calls on 31+.
    assertTrue(p.calls.none { it.startsWith("setSpeakerphoneOn") || it.contains("Sco") })
  }

  @Test fun modernPrefersLeAudio() {
    val p = FakeAudio(33).apply { devices += listOf(sco, le, earpiece) }
    assertEquals("26", AudioRouteController(p).start(false).activeDeviceId)
  }

  @Test fun noHeadsetWithoutFallbackIsNoHeadsetAndClearsNothingItDidNotSet() {
    val p = FakeAudio(34).apply { devices += listOf(earpiece, speaker) }
    val c = AudioRouteController(p)
    val s = c.start(false)
    assertEquals(RouteStatus.NO_HEADSET, s.status)
    assertNull(s.activeDeviceId)
    assertFalse(s.headsetConnected)
    assertEquals(AudioRouteController.MODE_IN_COMMUNICATION, p.currentMode) // communication mode stays on, waiting for a headset
    c.stop()
    assertFalse(p.calls.contains("clearCommunicationDevice"))
    assertEquals(0, p.currentMode)
  }

  @Test fun fallbackOnlyWhenAllowedAndFlagged() {
    val p = FakeAudio(34).apply { devices += listOf(earpiece, speaker) }
    val c = AudioRouteController(p)
    c.start(false)
    val s = c.setAllowFallback(true)
    assertEquals(RouteStatus.ACTIVE, s.status)
    assertEquals("1", s.activeDeviceId)
    assertTrue(s.usingFallback)
    val back = c.setAllowFallback(false)
    assertEquals(RouteStatus.NO_HEADSET, back.status)
    assertNull(p.commDevice)
  }

  @Test fun followsDevicesWhileRunning() {
    val p = FakeAudio(34).apply { devices += listOf(earpiece) }
    val c = AudioRouteController(p)
    assertEquals(RouteStatus.NO_HEADSET, c.start(false).status)
    p.devices += sco
    val connected = c.devicesChanged()
    assertEquals(RouteStatus.ACTIVE, connected.status)
    assertEquals("7", p.commDevice)
    p.devices.remove(sco)
    val gone = c.devicesChanged()
    assertEquals(RouteStatus.NO_HEADSET, gone.status)
    assertNull(p.commDevice)
  }

  @Test fun keepsTheCurrentDeviceWhenAnotherOfTheSameTierAppears() {
    val other = dev("70", DeviceKind.BLUETOOTH_SCO)
    val p = FakeAudio(34).apply { devices += listOf(sco) }
    val c = AudioRouteController(p)
    c.start(false)
    p.devices.add(0, other)
    assertEquals("7", c.devicesChanged().activeDeviceId)
  }

  @Test fun rejectedCommunicationDeviceIsFailed() {
    val p = FakeAudio(34).apply {
      devices += listOf(sco)
      rejectIds += "7"
    }
    val s = AudioRouteController(p).start(false)
    assertEquals(RouteStatus.FAILED, s.status)
    assertNull(s.activeDeviceId)
    assertTrue(s.error!!.isNotEmpty())
  }

  @Test fun bluetoothWithoutPermissionRejectsStartWithoutChangingAnything() {
    val p = FakeAudio(31).apply {
      devices += listOf(sco, earpiece)
      btPermission = false
    }
    try {
      AudioRouteController(p).start(false)
      fail("expected AudioRouteException")
    } catch (e: AudioRouteException) {
      assertEquals(AudioRouteException.PERMISSION, e.code)
    }
    assertTrue(p.calls.isEmpty())
  }

  @Test fun bluetoothChoiceNeedsPermissionButWiredDoesNot() {
    val p = FakeAudio(31).apply {
      devices += listOf(sco, wired)
      btPermission = false
    }
    // The policy prefers Bluetooth, so start refuses; once the permission is granted it routes to Bluetooth.
    try {
      AudioRouteController(p).start(false)
      fail()
    } catch (_: AudioRouteException) {
    }
    p.devices.remove(sco)
    assertEquals("3", AudioRouteController(p).start(false).activeDeviceId)
  }

  @Test fun bluetoothAppearingWithoutPermissionWhileRunningIsSkipped() {
    val p = FakeAudio(34).apply { devices += listOf(wired) }
    val c = AudioRouteController(p)
    c.start(false)
    p.btPermission = false
    p.devices += sco
    assertEquals("3", c.devicesChanged().activeDeviceId)
  }

  @Test fun startTwiceDoesNotOverwriteTheSavedState() {
    val p = FakeAudio(34).apply {
      devices += listOf(sco)
      currentMode = 0
    }
    val c = AudioRouteController(p)
    c.start(false)
    c.start(true)
    c.stop()
    assertEquals(0, p.currentMode)
  }

  @Test fun stopIsIdempotent() {
    val p = FakeAudio(34)
    val c = AudioRouteController(p)
    c.stop()
    assertTrue(p.calls.isEmpty())
  }

  // ---- API 29-30 --------------------------------------------------------------------------------------------------

  @Test fun legacyScoStartAndFullRestore() {
    val p = FakeAudio(29).apply {
      devices += listOf(earpiece, speaker, sco)
      speakerOn = true
      currentMode = 0
    }
    val c = AudioRouteController(p)
    val s = c.start(false)
    assertEquals(RouteStatus.ACTIVE, s.status)
    assertEquals("7", s.activeDeviceId)
    assertTrue(p.scoStarted)
    assertTrue(p.scoOn)
    assertFalse(p.speakerOn)
    assertTrue(p.calls.none { it.contains("CommunicationDevice") })

    c.stop()
    assertFalse(p.scoStarted)
    assertFalse(p.scoOn)
    assertTrue(p.speakerOn) // restored
    assertEquals(0, p.currentMode)
  }

  @Test fun legacyIgnoresLeAudio() {
    val p = FakeAudio(30).apply { devices += listOf(le, wired) }
    assertEquals("3", AudioRouteController(p).start(false).activeDeviceId)
  }

  @Test fun legacySwitchFromScoToWiredStopsSco() {
    val p = FakeAudio(30).apply { devices += listOf(sco) }
    val c = AudioRouteController(p)
    c.start(false)
    p.devices.clear()
    p.devices += wired
    val s = c.devicesChanged()
    assertEquals("3", s.activeDeviceId)
    assertFalse(p.scoStarted)
    assertFalse(p.scoOn)
    assertFalse(p.speakerOn)
  }

  @Test fun legacySpeakerFallbackTurnsSpeakerphoneOnAndStopRestoresIt() {
    val p = FakeAudio(29).apply { devices += listOf(speaker) }
    val c = AudioRouteController(p)
    val s = c.start(true)
    assertTrue(s.usingFallback)
    assertTrue(p.speakerOn)
    c.stop()
    assertFalse(p.speakerOn)
  }

  @Test fun legacyScoErrorFailsAndConnectRecovers() {
    val p = FakeAudio(29).apply { devices += listOf(sco) }
    val c = AudioRouteController(p)
    c.start(false)
    assertNull(c.scoStateChanged(2)) // connecting: no change
    val failed = c.scoStateChanged(AudioRouteController.SCO_STATE_ERROR)
    assertEquals(RouteStatus.FAILED, failed?.status)
    val ok = c.scoStateChanged(AudioRouteController.SCO_STATE_CONNECTED)
    assertEquals(RouteStatus.ACTIVE, ok?.status)
  }

  @Test fun scoEventsAreIgnoredWhenNotOnSco() {
    val p = FakeAudio(29).apply { devices += listOf(wired) }
    val c = AudioRouteController(p)
    assertNull(c.scoStateChanged(AudioRouteController.SCO_STATE_ERROR))
    c.start(false)
    assertNull(c.scoStateChanged(AudioRouteController.SCO_STATE_ERROR))
  }

  @Test fun stateReportsWouldChooseAndWireShape() {
    val p = FakeAudio(34).apply { devices += listOf(earpiece, wired) }
    val s = AudioRouteController(p).state()
    assertEquals("3", s.wouldChoose)
    val wire = s.toWire()
    assertEquals("inactive", wire["status"])
    assertEquals(false, wire["communicationMode"])
    @Suppress("UNCHECKED_CAST")
    val devices = wire["devices"] as List<Map<String, Any?>>
    assertEquals(mapOf("id" to "1", "kind" to "earpiece", "name" to "n-1", "hasMic" to true), devices[0])
  }
}
