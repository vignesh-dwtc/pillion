package expo.modules.intercom.logic

import kotlin.math.PI
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** `NativeCueKind` of specs/IntercomAudioRoute.ts. */
enum class CueKind(val wireName: String) {
  CONNECTED("connected"),
  DISCONNECTED("disconnected"),
  RECONNECTING("reconnecting"),
  MUTED("muted"),
  UNMUTED("unmuted"),
  PARTNER_MUTED("partner-muted"),
  PARTNER_UNMUTED("partner-unmuted"),
  ERROR("error"),
  ;

  companion object {
    fun fromWire(name: String): CueKind? = entries.firstOrNull { it.wireName == name }
  }
}

/** One tone of a cue: [freqHz] for [durationMs], then [gapMs] of silence. */
data class Tone(val freqHz: Double, val durationMs: Int, val gapMs: Int = 0)

/**
 * Generated earcons (no audio assets): short sine sequences, each with a distinct contour so they can be told apart in a
 * helmet without looking. Rising = good news, falling = bad news, repeated = in progress, low triple = error.
 * Output: 16-bit mono PCM with 8 ms raised-cosine fades on every tone (no clicks) at a moderate level (-12 dBFS peak),
 * because the cue plays straight into an earbud.
 */
object CueSynth {
  const val SAMPLE_RATE = 16_000
  const val PEAK = 0.25
  const val FADE_MS = 8

  fun tones(kind: CueKind): List<Tone> = when (kind) {
    CueKind.CONNECTED -> listOf(Tone(660.0, 110, 30), Tone(880.0, 160))
    CueKind.DISCONNECTED -> listOf(Tone(880.0, 110, 30), Tone(440.0, 220))
    CueKind.RECONNECTING -> listOf(Tone(660.0, 70, 70), Tone(660.0, 70, 70), Tone(660.0, 70))
    CueKind.MUTED -> listOf(Tone(520.0, 90, 20), Tone(390.0, 120))
    CueKind.UNMUTED -> listOf(Tone(390.0, 90, 20), Tone(520.0, 120))
    CueKind.PARTNER_MUTED -> listOf(Tone(440.0, 70, 50), Tone(440.0, 70))
    CueKind.PARTNER_UNMUTED -> listOf(Tone(740.0, 70, 50), Tone(740.0, 70))
    CueKind.ERROR -> listOf(Tone(330.0, 120, 60), Tone(330.0, 120, 60), Tone(330.0, 120))
  }

  fun durationMs(kind: CueKind): Int = tones(kind).sumOf { it.durationMs + it.gapMs }

  fun pcm(kind: CueKind, sampleRate: Int = SAMPLE_RATE): ShortArray {
    val out = ArrayList<Short>(sampleRate * durationMs(kind) / 1000 + 16)
    for (tone in tones(kind)) {
      val n = samples(tone.durationMs, sampleRate)
      val fade = min(samples(FADE_MS, sampleRate), n / 2)
      for (i in 0 until n) {
        val envelope = when {
          fade == 0 -> 1.0
          i < fade -> raisedCosine(i.toDouble() / fade)
          i >= n - fade -> raisedCosine((n - 1 - i).toDouble() / fade)
          else -> 1.0
        }
        val v = sin(2 * PI * tone.freqHz * i / sampleRate) * PEAK * envelope
        out.add((v * Short.MAX_VALUE).roundToInt().toShort())
      }
      repeat(samples(tone.gapMs, sampleRate)) { out.add(0) }
    }
    return out.toShortArray()
  }

  private fun samples(ms: Int, rate: Int) = (ms.toLong() * rate / 1000).toInt()

  /** 0 at x = 0, 1 at x = 1. */
  private fun raisedCosine(x: Double) = 0.5 - 0.5 * kotlin.math.cos(PI * x.coerceIn(0.0, 1.0))
}
