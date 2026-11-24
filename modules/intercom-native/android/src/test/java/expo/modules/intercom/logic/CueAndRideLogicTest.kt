package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class CueSynthTest {
  @Test fun everyWireNameMapsBack() {
    for (k in CueKind.entries) assertEquals(k, CueKind.fromWire(k.wireName))
    assertNull(CueKind.fromWire("beep"))
  }

  @Test fun cuesAreShortBoundedAndClickFree() {
    for (k in CueKind.entries) {
      val pcm = CueSynth.pcm(k)
      val ms = CueSynth.durationMs(k)
      assertTrue("$k too long", ms in 100..800)
      assertEquals(CueSynth.SAMPLE_RATE * ms / 1000, pcm.size)
      val peak = pcm.maxOf { abs(it.toInt()) }
      assertTrue("$k peak $peak", peak > 0 && peak <= (Short.MAX_VALUE * CueSynth.PEAK).toInt() + 1)
      // Starts and ends at (near) silence: fades in and out.
      assertTrue(abs(pcm.first().toInt()) < 50)
      assertTrue(abs(pcm.last().toInt()) < 50)
    }
  }

  @Test fun cuesAreDistinguishable() {
    val shapes = CueKind.entries.map { CueSynth.tones(it) }
    assertEquals(shapes.size, shapes.toSet().size)
    // Connected rises, disconnected falls.
    val up = CueSynth.tones(CueKind.CONNECTED)
    val down = CueSynth.tones(CueKind.DISCONNECTED)
    assertTrue(up.last().freqHz > up.first().freqHz)
    assertTrue(down.last().freqHz < down.first().freqHz)
  }
}

class RideLogicTest {
  @Test fun serviceTypeMaskPerApiLevel() {
    assertEquals(16, ServiceTypes.mask(29))
    assertEquals(128 or 16, ServiceTypes.mask(30))
    assertEquals(144, ServiceTypes.mask(34))
    assertEquals(144, ServiceTypes.mask(37))
  }

  @Test fun wifiLockModesPerApiLevel() {
    assertEquals(listOf(4, 3), WifiLockPlan.modes(29))
    assertEquals(listOf(4, 3), WifiLockPlan.modes(33))
    assertEquals(listOf(4), WifiLockPlan.modes(34))
  }

  @Test fun rideActionsRoundTrip() {
    assertEquals(RideAction.TOGGLE_MUTE, RideAction.fromIntentSuffix("TOGGLE_MUTE"))
    assertEquals(RideAction.END, RideAction.fromIntentSuffix("END"))
    assertNull(RideAction.fromIntentSuffix("START"))
    assertNull(RideAction.fromIntentSuffix(null))
    assertEquals("toggle-mute", RideAction.TOGGLE_MUTE.wireName)
  }

  @Test fun actionBufferKeepsOnlyTheLastPressUntilASinkArrives() {
    val b = ActionBuffer()
    val got = mutableListOf<RideAction>()
    b.dispatch(RideAction.TOGGLE_MUTE)
    b.dispatch(RideAction.END)
    assertEquals(RideAction.END, b.pending())
    b.setSink { got += it }
    assertEquals(listOf(RideAction.END), got)
    assertNull(b.pending())
    b.dispatch(RideAction.TOGGLE_MUTE)
    assertEquals(listOf(RideAction.END, RideAction.TOGGLE_MUTE), got)
    b.setSink(null)
    b.dispatch(RideAction.TOGGLE_MUTE)
    b.clear()
    assertNull(b.pending())
  }

  @Test fun notificationModelLabelsAndSanitising() {
    val m = RideNotificationModel("t", "x", muted = false, connected = true)
    assertEquals("Mute", m.toggleLabel)
    assertEquals("Unmute", m.copy(muted = true).toggleLabel)
    assertEquals("Stop", RideNotificationModel.label("  Stop ", "End"))
    assertEquals("End", RideNotificationModel.label("   ", "End"))
    assertEquals("End", RideNotificationModel.label(null, "End"))
    assertEquals(RideNotificationModel.MAX_TEXT, RideNotificationModel.sanitize("a".repeat(500)).length)
  }

  @Test fun startGate() {
    assertEquals(StartDecision.PERMISSION, StartGate.decide(alreadyRunning = true, importance = 100, recordAudioGranted = false))
    assertEquals(StartDecision.OK, StartGate.decide(false, 100, true))
    assertEquals(StartDecision.OK, StartGate.decide(false, 200, true))
    assertEquals(StartDecision.BACKGROUND, StartGate.decide(false, 300, true))
    assertEquals(StartDecision.BACKGROUND, StartGate.decide(false, 400, true))
    assertEquals(StartDecision.OK, StartGate.decide(true, 400, true))
  }
}
