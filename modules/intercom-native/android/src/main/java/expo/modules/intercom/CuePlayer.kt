package expo.modules.intercom

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import expo.modules.intercom.logic.CueKind
import expo.modules.intercom.logic.CueSynth
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Plays generated cues through an AudioTrack with USAGE_VOICE_COMMUNICATION, so they follow the communication device
 * (the headset) instead of the media stream. No audio focus is requested. One cue at a time; at most [MAX_QUEUED] wait,
 * extra ones are dropped (a burst of state changes must not turn into a minute of beeps).
 */
class CuePlayer {
  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "intercom-cue").apply { isDaemon = true } }
  private val queued = AtomicInteger(0)

  /** [done] gets null when the cue finished (or was dropped), else the failure. */
  fun play(kind: CueKind, done: (Throwable?) -> Unit) {
    if (queued.incrementAndGet() > MAX_QUEUED) {
      queued.decrementAndGet()
      done(null)
      return
    }
    try {
      executor.execute {
        try {
          playBlocking(kind)
          done(null)
        } catch (e: Exception) {
          done(e)
        } finally {
          queued.decrementAndGet()
        }
      }
    } catch (e: java.util.concurrent.RejectedExecutionException) {
      queued.decrementAndGet()
      done(e)
    }
  }

  fun shutdown() {
    executor.shutdownNow()
  }

  private fun playBlocking(kind: CueKind) {
    val pcm = CueSynth.pcm(kind)
    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build(),
      )
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(CueSynth.SAMPLE_RATE)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setBufferSizeInBytes(pcm.size * 2)
      .build()
    try {
      check(track.state == AudioTrack.STATE_INITIALIZED) { "AudioTrack not initialized" }
      val written = track.write(pcm, 0, pcm.size)
      check(written == pcm.size) { "AudioTrack write returned $written" }
      track.play()
      Thread.sleep(CueSynth.durationMs(kind).toLong() + TAIL_MS)
      track.stop()
    } finally {
      track.release()
    }
  }

  companion object {
    const val MAX_QUEUED = 3
    const val TAIL_MS = 60L
  }
}
