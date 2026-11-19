package expo.modules.intercom

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import expo.modules.intercom.logic.AudioRouteController
import expo.modules.intercom.logic.AudioRouteException
import expo.modules.intercom.logic.CueKind
import expo.modules.intercom.logic.RouteState
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.Executor

class AudioStartOptions : Record {
  @Field val allowFallbackDevice: Boolean = false
}

/**
 * JS name `IntercomAudioRoute` (see specs/IntercomAudioRoute.ts). Decisions live in [AudioRouteController] (plain Kotlin,
 * JVM-tested); this class wires AudioManager callbacks to it:
 *  - AudioDeviceCallback (device added/removed), all API levels;
 *  - OnCommunicationDeviceChangedListener, API 31+ (another app or the system changed the communication device);
 *  - ACTION_SCO_AUDIO_STATE_UPDATED receiver, API 29-30 (legacy SCO connection state).
 * Callbacks are registered only between start and stop, on a private handler thread, and each emits `onChange`.
 * Audio focus is never requested.
 */
class IntercomAudioRouteModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val audioManager: AudioManager by lazy { context.getSystemService(Context.AUDIO_SERVICE) as AudioManager }
  private val controller: AudioRouteController by lazy { AudioRouteController(AndroidAudioPlatform(context, audioManager)) }
  private val cues = CuePlayer()

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private var deviceCallback: AudioDeviceCallback? = null
  private var commListener: Any? = null // AudioManager.OnCommunicationDeviceChangedListener (API 31+)
  private var scoReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("IntercomAudioRoute")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onChange")

    OnDestroy {
      try {
        unwatch()
        if (controller.isActive()) controller.stop()
      } catch (_: Exception) {
        // React context already gone: nothing left to restore through it.
      }
      cues.shutdown()
    }

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("getState") { controller.state().toWire() }

    AsyncFunction("start") { options: AudioStartOptions ->
      val state = try {
        controller.start(options.allowFallbackDevice)
      } catch (e: AudioRouteException) {
        throw CodedException(e.code, e.message, null)
      } catch (e: RuntimeException) {
        // Undo whatever was changed before the failure.
        safeStop()
        throw CodedException(AudioRouteException.ROUTE, "start failed: ${e.javaClass.simpleName}", null)
      }
      watch()
      state.toWire()
    }

    AsyncFunction("stop") {
      unwatch()
      safeStop()
    }

    AsyncFunction("setAllowFallback") { allow: Boolean -> controller.setAllowFallback(allow).toWire() }

    AsyncFunction("playCue") { cue: String, promise: Promise ->
      val kind = CueKind.fromWire(cue)
      if (kind == null) {
        promise.reject(AudioRouteException.ROUTE, "unknown cue", null)
        return@AsyncFunction
      }
      cues.play(kind) { error ->
        if (error == null) promise.resolve(null) else promise.reject(AudioRouteException.ROUTE, "cue failed: ${error.javaClass.simpleName}", null)
      }
    }
  }

  private fun safeStop() {
    try {
      controller.stop()
    } catch (_: RuntimeException) {
    }
  }

  private fun emit(state: RouteState) {
    sendEvent("onChange", state.toWire())
  }

  @Synchronized private fun watch() {
    if (thread != null) return
    val t = HandlerThread("intercom-audio").apply { start() }
    val h = Handler(t.looper)
    thread = t
    handler = h

    val callback = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) = emit(controller.devicesChanged())
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) = emit(controller.devicesChanged())
    }
    audioManager.registerAudioDeviceCallback(callback, h)
    deviceCallback = callback

    if (Build.VERSION.SDK_INT >= 31) {
      val listener = AudioManager.OnCommunicationDeviceChangedListener { emit(controller.state()) }
      audioManager.addOnCommunicationDeviceChangedListener(Executor { h.post(it) }, listener)
      commListener = listener
    } else {
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
          @Suppress("DEPRECATION")
          val state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR)
          controller.scoStateChanged(state)?.let(::emit)
        }
      }
      @Suppress("DEPRECATION")
      val filter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
      // System broadcast; API 29-30 have no exported/not-exported flag requirement.
      context.registerReceiver(receiver, filter, null, h)
      scoReceiver = receiver
    }
  }

  @Synchronized private fun unwatch() {
    deviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
    deviceCallback = null
    if (Build.VERSION.SDK_INT >= 31) {
      (commListener as? AudioManager.OnCommunicationDeviceChangedListener)?.let {
        audioManager.removeOnCommunicationDeviceChangedListener(it)
      }
    }
    commListener = null
    scoReceiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (_: IllegalArgumentException) {
      }
    }
    scoReceiver = null
    thread?.quitSafely()
    thread = null
    handler = null
  }
}
