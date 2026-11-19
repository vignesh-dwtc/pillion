package expo.modules.intercom

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.annotation.RequiresApi
import expo.modules.intercom.logic.LinkException
import expo.modules.intercom.logic.PeerEvent
import expo.modules.intercom.logic.PeerTracker
import expo.modules.intercom.logic.ResolveQueue
import java.util.concurrent.Executor

/**
 * NsdManager glue: one registration and one discovery at a time. Filtering, de-duplication and the resolve queue are
 * plain Kotlin (PeerTracker, ResolveQueue). Resolution:
 *  - API 34+: registerServiceInfoCallback (continuous updates, several host addresses, not deprecated);
 *  - API 29-33: legacy resolveService, one at a time through ResolveQueue (FAILURE_ALREADY_ACTIVE otherwise).
 * All NSD callbacks are funnelled onto one handler thread, so this class has a single writer.
 */
class NsdController(context: Context, private val emitPeer: (PeerEvent) -> Unit) {
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val thread = HandlerThread("intercom-nsd").apply { start() }
  private val handler = Handler(thread.looper)
  private val executor = Executor { handler.post(it) }

  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: Discovery? = null

  // ---- Advertising -------------------------------------------------------------------------------------------------

  /** Registers [serviceName]; [done] gets the registered name (NSD may rename on a conflict) or an error. */
  fun register(serviceType: String, serviceName: String, port: Int, done: (String?, LinkException?) -> Unit) {
    handler.post {
      unregisterNow()
      val info = NsdServiceInfo().apply {
        this.serviceName = serviceName
        this.serviceType = serviceType
        this.port = port
      }
      var settled = false
      val listener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(registered: NsdServiceInfo) {
          handler.post {
            if (!settled) {
              settled = true
              done(registered.serviceName ?: serviceName, null)
            }
          }
        }

        override fun onRegistrationFailed(failed: NsdServiceInfo, errorCode: Int) {
          handler.post {
            if (registration === this) registration = null
            if (!settled) {
              settled = true
              done(null, LinkException(LinkException.NSD, "registerService failed (code $errorCode)"))
            }
          }
        }

        override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
        override fun onUnregistrationFailed(info: NsdServiceInfo, errorCode: Int) = Unit
      }
      registration = listener
      try {
        nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
      } catch (e: RuntimeException) {
        registration = null
        settled = true
        done(null, LinkException(LinkException.NSD, "registerService threw ${e.javaClass.simpleName}"))
      }
    }
  }

  fun unregister(done: () -> Unit = {}) {
    handler.post {
      unregisterNow()
      done()
    }
  }

  private fun unregisterNow() {
    val listener = registration ?: return
    registration = null
    try {
      nsd.unregisterService(listener)
    } catch (_: IllegalArgumentException) {
      // Listener not registered (registration failed or already gone).
    }
  }

  // ---- Discovery ---------------------------------------------------------------------------------------------------

  fun startDiscovery(serviceType: String, tracker: PeerTracker, done: (LinkException?) -> Unit) {
    handler.post {
      stopDiscoveryNow()
      val d = Discovery(serviceType, tracker, done)
      discovery = d
      d.start()
    }
  }

  fun stopDiscovery(done: () -> Unit = {}) {
    handler.post {
      stopDiscoveryNow()
      done()
    }
  }

  private fun stopDiscoveryNow() {
    discovery?.stop()
    discovery = null
  }

  /** Stops everything; the controller stays usable. */
  fun reset(done: () -> Unit = {}) {
    handler.post {
      stopDiscoveryNow()
      unregisterNow()
      done()
    }
  }

  /** Final teardown (module destroyed). */
  fun shutdown() {
    handler.post {
      stopDiscoveryNow()
      unregisterNow()
      thread.quitSafely()
    }
  }

  private inner class Discovery(
    private val serviceType: String,
    private val tracker: PeerTracker,
    private var startDone: ((LinkException?) -> Unit)?,
  ) : NsdManager.DiscoveryListener {
    private var active = true
    private val resolveQueue = ResolveQueue<String>()
    private val pendingInfo = HashMap<String, NsdServiceInfo>()
    private val infoCallbacks = HashMap<String, NsdManager.ServiceInfoCallback>()

    fun start() {
      try {
        nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, this)
      } catch (e: RuntimeException) {
        active = false
        finishStart(LinkException(LinkException.NSD, "discoverServices threw ${e.javaClass.simpleName}"))
      }
    }

    fun stop() {
      if (!active) return
      active = false
      if (Build.VERSION.SDK_INT >= API_SERVICE_INFO_CALLBACK) {
        infoCallbacks.values.forEach { unregisterInfoCallback(it) }
      }
      // API 29-33: an in-flight legacy resolve completes on its own and is ignored (active = false).
      infoCallbacks.clear()
      resolveQueue.clear()
      pendingInfo.clear()
      tracker.reset()
      try {
        nsd.stopServiceDiscovery(this)
      } catch (_: IllegalArgumentException) {
      }
      finishStart(LinkException(LinkException.NSD, "discovery stopped before it started"))
    }

    private fun finishStart(error: LinkException?) {
      val cb = startDone ?: return
      startDone = null
      cb(error)
    }

    override fun onDiscoveryStarted(regType: String) {
      handler.post { finishStart(null) }
    }

    override fun onStartDiscoveryFailed(type: String, errorCode: Int) {
      handler.post {
        active = false
        if (discovery === this) discovery = null
        finishStart(LinkException(LinkException.NSD, "discoverServices failed (code $errorCode)"))
      }
    }

    override fun onDiscoveryStopped(type: String) = Unit
    override fun onStopDiscoveryFailed(type: String, errorCode: Int) = Unit

    override fun onServiceFound(info: NsdServiceInfo) {
      handler.post {
        val name = info.serviceName ?: return@post
        if (!active || !tracker.isOurs(name, info.serviceType)) return@post
        if (Build.VERSION.SDK_INT >= API_SERVICE_INFO_CALLBACK) {
          watch(name, info)
        } else {
          pendingInfo[name] = info
          if (resolveQueue.offer(name)) resolveLegacy(name)
        }
      }
    }

    override fun onServiceLost(info: NsdServiceInfo) {
      handler.post {
        val name = info.serviceName ?: return@post
        if (!active) return@post
        resolveQueue.remove(name)
        if (resolveQueue.inFlight() != name) pendingInfo.remove(name)
        if (Build.VERSION.SDK_INT >= API_SERVICE_INFO_CALLBACK) {
          infoCallbacks.remove(name)?.let { unregisterInfoCallback(it) }
        }
        tracker.lost(name)?.let(emitPeer)
      }
    }

    // API 34+ ------------------------------------------------------------------------------------------------------

    @RequiresApi(API_SERVICE_INFO_CALLBACK)
    private fun watch(name: String, info: NsdServiceInfo) {
      if (infoCallbacks.containsKey(name)) return
      val callback = object : NsdManager.ServiceInfoCallback {
        override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
          handler.post { infoCallbacks.remove(name) }
        }

        override fun onServiceUpdated(updated: NsdServiceInfo) {
          handler.post {
            if (!active) return@post
            val addresses = updated.hostAddresses.mapNotNull { it.hostAddress }
            tracker.resolved(name, addresses, updated.port)?.let(emitPeer)
          }
        }

        override fun onServiceLost() {
          handler.post { if (active) tracker.lost(name)?.let(emitPeer) }
        }

        override fun onServiceInfoCallbackUnregistered() = Unit
      }
      infoCallbacks[name] = callback
      try {
        nsd.registerServiceInfoCallback(info, executor, callback)
      } catch (_: RuntimeException) {
        infoCallbacks.remove(name)
      }
    }

    @RequiresApi(API_SERVICE_INFO_CALLBACK)
    private fun unregisterInfoCallback(callback: NsdManager.ServiceInfoCallback) {
      try {
        nsd.unregisterServiceInfoCallback(callback)
      } catch (_: IllegalArgumentException) {
      }
    }

    // API 29-33 ----------------------------------------------------------------------------------------------------

    @Suppress("DEPRECATION") // resolveService: deprecated in API 34; this path only runs on 29-33.
    private fun resolveLegacy(name: String) {
      val info = pendingInfo[name]
      if (info == null) {
        resolveQueue.done(name)?.let(::resolveLegacy)
        return
      }
      val listener = object : NsdManager.ResolveListener {
        override fun onServiceResolved(resolved: NsdServiceInfo) {
          handler.post {
            pendingInfo.remove(name)
            if (active) {
              val address = resolved.host?.hostAddress
              if (address != null) tracker.resolved(name, listOf(address), resolved.port)?.let(emitPeer)
            }
            next(name)
          }
        }

        override fun onResolveFailed(failed: NsdServiceInfo, errorCode: Int) {
          handler.post {
            if (active && errorCode == NsdManager.FAILURE_ALREADY_ACTIVE) {
              // Another resolve of this process is still running: try the same service again shortly.
              handler.postDelayed({ if (active && resolveQueue.inFlight() == name) resolveLegacy(name) }, RESOLVE_RETRY_MS)
            } else {
              pendingInfo.remove(name)
              next(name)
            }
          }
        }
      }
      try {
        nsd.resolveService(info, listener)
      } catch (_: RuntimeException) {
        pendingInfo.remove(name)
        next(name)
      }
    }

    private fun next(done: String) {
      if (!active) return
      resolveQueue.done(done)?.let(::resolveLegacy)
    }
  }

  companion object {
    const val API_SERVICE_INFO_CALLBACK = 34
    const val RESOLVE_RETRY_MS = 300L
  }
}
