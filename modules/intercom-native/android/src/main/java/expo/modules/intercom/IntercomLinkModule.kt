package expo.modules.intercom

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import expo.modules.intercom.logic.IfaceInfo
import expo.modules.intercom.logic.InterfaceClassifier
import expo.modules.intercom.logic.InterfaceSnapshot
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.NetworkInterface
import java.net.SocketException

/**
 * JS name `IntercomLink`: a dumb byte pipe (see specs/IntercomLink.ts). M0 skeleton: read-only calls are real
 * (interface listing, Wi-Fi state), everything that opens sockets or NSD is M1 and rejects with ERR_NOT_IMPLEMENTED.
 * Async functions run on the Expo module queue thread, never on the main thread.
 */
class IntercomLinkModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("IntercomLink")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onData", "onClose", "onAccept", "onPeer", "onNetworkChange")

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("isWifiConnected") { isWifiConnected(context) }

    AsyncFunction("listInterfaces") { listInterfaces() }

    // M1: NSD + TCP. Declared now so the JS wrapper and specs are written against the final shape.
    AsyncFunction("acquireLocks") { notYet("acquireLocks") }
    AsyncFunction("releaseLocks") { notYet("releaseLocks") }
    AsyncFunction("startAdvertising") { _: Map<String, Any?> -> notYet("startAdvertising") }
    AsyncFunction("stopAdvertising") { notYet("stopAdvertising") }
    AsyncFunction("startDiscovery") { _: Map<String, Any?> -> notYet("startDiscovery") }
    AsyncFunction("stopDiscovery") { notYet("stopDiscovery") }
    AsyncFunction("listen") { _: Map<String, Any?> -> notYet("listen") }
    AsyncFunction("stopListening") { _: String -> notYet("stopListening") }
    AsyncFunction("connect") { _: Map<String, Any?> -> notYet("connect") }
    AsyncFunction("send") { _: String, _: String -> notYet("send") }
    AsyncFunction("close") { _: String -> notYet("close") }
    AsyncFunction("dispose") { notYet("dispose") }
  }

  /**
   * True when ANY Wi-Fi (station) network is connected, not only the default one. `activeNetwork` is the default
   * network, and Android does not make a Wi-Fi network without internet (a router-only LAN or the partner's
   * hotspot: this app's core case) the default while mobile data is up, so checking it alone would report "not
   * connected" exactly when the two phones share such a network.
   */
  private fun isWifiConnected(context: Context): Boolean {
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    @Suppress("DEPRECATION") // allNetworks: deprecated in API 31 in favour of callbacks, still correct for a one-off query.
    val networks = cm.allNetworks
    return networks.any { network ->
      cm.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    }
  }

  private fun listInterfaces(): List<Map<String, Any?>> {
    val all = try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
    } catch (_: SocketException) {
      emptyList()
    }
    // An interface can vanish between the listing and the reads below (SocketException): skip it, keep the rest.
    val infos = InterfaceSnapshot.readAll(all) { ni ->
      IfaceInfo(
        name = ni.name,
        kind = InterfaceClassifier.classify(ni.name, ni.isLoopback),
        addresses = ni.inetAddresses.toList().mapNotNull { it.hostAddress },
        up = ni.isUp,
        multicast = ni.supportsMulticast(),
      )
    }
    return infos.map { info ->
      mapOf(
        "name" to info.name,
        "kind" to info.kind.wireName,
        "addresses" to info.addresses,
        "up" to info.up,
        "multicast" to info.multicast,
      )
    }
  }
}
