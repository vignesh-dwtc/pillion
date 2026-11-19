package expo.modules.intercom

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.HandlerThread

/**
 * Watches Wi-Fi (station) networks with a NetworkCallback (ACCESS_NETWORK_STATE). [onChange] gets `wifiConnected`
 * whenever the "any Wi-Fi network" answer flips, and [onNetworkLost] after every lost Wi-Fi network (the caller then
 * closes connections whose local address vanished). Callbacks run on a private handler thread.
 */
class WifiNetworkWatcher(
  context: Context,
  private val onChange: (Boolean) -> Unit,
  private val onNetworkLost: () -> Unit,
) {
  private val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private val thread = HandlerThread("intercom-net").apply { start() }
  private val handler = Handler(thread.looper)
  private val networks = HashSet<Network>()
  private var last: Boolean? = null
  private var callback: ConnectivityManager.NetworkCallback? = null

  @Synchronized fun start() {
    if (callback != null) return
    val cb = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        networks.add(network)
        report()
      }

      override fun onLost(network: Network) {
        networks.remove(network)
        report()
        onNetworkLost()
        // Addresses can linger for a moment after onLost: check once more a little later.
        handler.postDelayed({ onNetworkLost() }, RECHECK_MS)
      }
    }
    val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
    try {
      cm.registerNetworkCallback(request, cb, handler)
      callback = cb
    } catch (_: RuntimeException) {
      // TooManyRequestsException / SecurityException: the link still works, only change events are missing.
    }
  }

  @Synchronized fun stop() {
    val cb = callback ?: return
    callback = null
    try {
      cm.unregisterNetworkCallback(cb)
    } catch (_: IllegalArgumentException) {
    }
    handler.post {
      networks.clear()
      last = null
    }
  }

  fun shutdown() {
    stop()
    thread.quitSafely()
  }

  private fun report() {
    val now = networks.isNotEmpty()
    if (now != last) {
      last = now
      onChange(now)
    }
  }

  companion object {
    const val RECHECK_MS = 1_500L
  }
}
