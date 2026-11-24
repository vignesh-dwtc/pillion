package expo.modules.intercom

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import expo.modules.intercom.logic.AddressPrefix
import expo.modules.intercom.logic.AdvertiseAddressSelector
import expo.modules.intercom.logic.Base64Codec
import expo.modules.intercom.logic.CloseReason
import expo.modules.intercom.logic.ConnectionInfo
import expo.modules.intercom.logic.IfaceInfo
import expo.modules.intercom.logic.InterfaceClassifier
import expo.modules.intercom.logic.InterfaceSnapshot
import expo.modules.intercom.logic.LinkException
import expo.modules.intercom.logic.NetworkLoss
import expo.modules.intercom.logic.NetworkMatcher
import expo.modules.intercom.logic.NsdServiceNames
import expo.modules.intercom.logic.PeerTracker
import expo.modules.intercom.logic.TcpHub
import expo.modules.intercom.logic.TcpHubEvents
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.net.NetworkInterface
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.Executors

class StartAdvertisingOptions : Record {
  @Field val serviceType: String = ""
  @Field val pairId: String = ""
  @Field val serviceNamePrefix: String? = null
  @Field val port: Int = 0
}

class StartDiscoveryOptions : Record {
  @Field val serviceType: String = ""
  @Field val pairId: String = ""
  @Field val serviceNamePrefix: String? = null
}

class ListenOptions : Record {
  @Field val port: Int = 0
}

class ConnectOptions : Record {
  @Field val host: String = ""
  @Field val port: Int = 0
  @Field val timeoutMs: Int = 10_000
}

/**
 * JS name `IntercomLink`: a dumb byte pipe (see specs/IntercomLink.ts). Thin glue: TCP lives in [TcpHub] (plain JVM),
 * NSD in [NsdController], locks in [LinkLocks], Wi-Fi change events in [WifiNetworkWatcher].
 *
 * Threading: quick calls run on the Expo module queue; the blocking TCP connect runs on [blocking]; sends complete on the
 * connection's writer thread; NSD results arrive on the NSD handler thread. Events are emitted from those threads.
 */
class IntercomLinkModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val blocking = Executors.newCachedThreadPool { r -> Thread(r, "intercom-link-io").apply { isDaemon = true } }

  private val hub: TcpHub by lazy {
    TcpHub(prepareSocket = ::bindToWifiNetwork, events = object : TcpHubEvents {
      override fun onAccept(listenerId: String, connection: ConnectionInfo) {
        sendEvent("onAccept", connectionWire(connection) + ("listenerId" to listenerId))
      }

      override fun onData(connectionId: String, bytes: ByteArray) {
        sendEvent("onData", mapOf("connectionId" to connectionId, "data" to Base64Codec.encode(bytes)))
      }

      override fun onClose(connectionId: String, reason: CloseReason, detail: String?) {
        sendEvent("onClose", mapOf("connectionId" to connectionId, "reason" to reason.wireName, "detail" to detail))
      }
    })
  }

  private val nsd: NsdController by lazy { NsdController(context) { sendEvent("onPeer", it.toWire()) } }
  private val locks: LinkLocks by lazy { LinkLocks(context) }
  private val watcher: WifiNetworkWatcher by lazy {
    WifiNetworkWatcher(
      context,
      onChange = { connected -> sendEvent("onNetworkChange", mapOf("wifiConnected" to connected)) },
      onNetworkLost = ::closeConnectionsOnLostAddresses,
    )
  }

  @Volatile private var started = false

  override fun definition() = ModuleDefinition {
    Name("IntercomLink")

    Constant("API_VERSION") { INTERCOM_API_VERSION }

    Events("onData", "onClose", "onAccept", "onPeer", "onNetworkChange")

    OnDestroy {
      if (started) {
        hub.dispose(CloseReason.ABORTED)
        nsd.shutdown()
        locks.releaseAll()
        watcher.shutdown()
      }
      blocking.shutdownNow()
    }

    AsyncFunction("getInfo") {
      mapOf("apiVersion" to INTERCOM_API_VERSION, "sdkInt" to Build.VERSION.SDK_INT)
    }

    AsyncFunction("isWifiConnected") { isWifiConnected(context) }

    AsyncFunction("listInterfaces") { readInterfaces().map(::interfaceWire) }

    AsyncFunction("acquireLocks") {
      activate()
      locks.acquireExplicit()
    }

    AsyncFunction("releaseLocks") {
      if (started) locks.releaseExplicit()
    }

    AsyncFunction("startAdvertising") { options: StartAdvertisingOptions, promise: Promise ->
      val name = try {
        requireWifi()
        validateType(options.serviceType)
        require(options.port in 1..65535) { "port out of range" }
        NsdServiceNames.build(options.pairId, prefixOf(options.serviceNamePrefix))
      } catch (e: LinkException) {
        promise.reject(e.code, e.message, null)
        return@AsyncFunction
      } catch (e: IllegalArgumentException) {
        promise.reject(LinkException.NSD, e.message, null)
        return@AsyncFunction
      }
      activate()
      locks.holdMulticast(LinkLocks.ADVERTISING)
      nsd.register(options.serviceType, name, options.port) { registered, error ->
        if (error != null) {
          locks.releaseMulticast(LinkLocks.ADVERTISING)
          promise.reject(error.code, error.message, null)
        } else {
          promise.resolve(mapOf("registeredName" to registered))
        }
      }
    }

    AsyncFunction("stopAdvertising") { promise: Promise ->
      if (!started) {
        promise.resolve(null)
        return@AsyncFunction
      }
      nsd.unregister {
        locks.releaseMulticast(LinkLocks.ADVERTISING)
        promise.resolve(null)
      }
    }

    AsyncFunction("startDiscovery") { options: StartDiscoveryOptions, promise: Promise ->
      val tracker = try {
        requireWifi()
        validateType(options.serviceType)
        val prefix = prefixOf(options.serviceNamePrefix)
        NsdServiceNames.build(options.pairId, prefix) // validates the pair id
        PeerTracker(options.serviceType, options.pairId, prefix)
      } catch (e: LinkException) {
        promise.reject(e.code, e.message, null)
        return@AsyncFunction
      } catch (e: IllegalArgumentException) {
        promise.reject(LinkException.NSD, e.message, null)
        return@AsyncFunction
      }
      activate()
      locks.holdMulticast(LinkLocks.DISCOVERY)
      nsd.startDiscovery(options.serviceType, tracker) { error ->
        if (error != null) {
          locks.releaseMulticast(LinkLocks.DISCOVERY)
          promise.reject(error.code, error.message, null)
        } else {
          promise.resolve(null)
        }
      }
    }

    AsyncFunction("stopDiscovery") { promise: Promise ->
      if (!started) {
        promise.resolve(null)
        return@AsyncFunction
      }
      nsd.stopDiscovery {
        locks.releaseMulticast(LinkLocks.DISCOVERY)
        promise.resolve(null)
      }
    }

    AsyncFunction("listen") { options: ListenOptions ->
      activate()
      val info = try {
        hub.listen(options.port)
      } catch (e: LinkException) {
        throw CodedException(e.code, e.message, null)
      } catch (e: IllegalArgumentException) {
        throw CodedException(LinkException.IO, e.message, null)
      }
      val choice = AdvertiseAddressSelector.choose(readInterfaces())
      mapOf(
        "listenerId" to info.listenerId,
        "port" to info.port,
        "localAddress" to choice?.address,
        "interfaceName" to choice?.interfaceName,
      )
    }

    AsyncFunction("stopListening") { listenerId: String ->
      if (started) hub.stopListening(listenerId)
    }

    AsyncFunction("connect") { options: ConnectOptions, promise: Promise ->
      activate()
      blocking.execute {
        try {
          promise.resolve(connectionWire(hub.connect(options.host, options.port, options.timeoutMs)))
        } catch (e: LinkException) {
          promise.reject(e.code, e.message, null)
        } catch (e: IllegalArgumentException) {
          promise.reject(LinkException.CONNECT, e.message, null)
        }
      }
    }

    AsyncFunction("send") { connectionId: String, dataBase64: String, promise: Promise ->
      val bytes = try {
        Base64Codec.decode(dataBase64)
      } catch (_: IllegalArgumentException) {
        promise.reject(LinkException.IO, "send: data is not valid Base64", null)
        return@AsyncFunction
      }
      if (!started) {
        promise.reject(LinkException.UNKNOWN_CONNECTION, "unknown or closed connection", null)
        return@AsyncFunction
      }
      hub.send(connectionId, bytes) { error ->
        if (error == null) promise.resolve(null) else promise.reject(error.code, error.message, null)
      }
    }

    AsyncFunction("close") { connectionId: String ->
      if (started) hub.close(connectionId, CloseReason.LOCAL_CLOSE)
    }

    AsyncFunction("dispose") { promise: Promise ->
      if (!started) {
        promise.resolve(null)
        return@AsyncFunction
      }
      hub.dispose(CloseReason.LOCAL_CLOSE)
      nsd.reset {
        locks.releaseAll()
        watcher.stop()
        promise.resolve(null)
      }
    }
  }

  private fun activate() {
    started = true
    watcher.start()
  }

  private fun requireWifi() {
    if (!isWifiConnected(context)) throw LinkException(LinkException.NOT_WIFI, "no Wi-Fi network is connected")
  }

  private fun validateType(type: String) {
    if (!NsdServiceNames.isValidServiceType(type)) throw LinkException(LinkException.NSD, "invalid service type")
  }

  private fun prefixOf(prefix: String?) = prefix ?: NsdServiceNames.DEFAULT_PREFIX

  private fun closeConnectionsOnLostAddresses() {
    if (!started) return
    val lost = NetworkLoss.lostConnections(hub.openConnections(), readInterfaces()).toSet()
    if (lost.isEmpty()) return
    hub.closeWhere(CloseReason.NETWORK_LOST, "local address no longer present") { it.connectionId in lost }
  }

  private fun connectionWire(c: ConnectionInfo): Map<String, Any?> = mapOf(
    "connectionId" to c.connectionId,
    "localAddress" to c.localAddress,
    "remoteAddress" to c.remoteAddress,
    "interfaceName" to c.interfaceName,
  )

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

  /**
   * Binds an outgoing socket to the connected Wi-Fi network whose addresses or routes cover [host] (D-046 follow-up): a
   * Wi-Fi network without internet is not the default network while mobile data is up, and an unbound socket would
   * follow cellular's default route. No covering Wi-Fi network: the socket stays unbound. Network.bindSocket: API 23.
   */
  private fun bindToWifiNetwork(socket: Socket, host: String) {
    val target = NetworkMatcher.numericAddress(host) ?: return
    val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    @Suppress("DEPRECATION") // allNetworks: see isWifiConnected.
    val candidates: List<Pair<Network, List<AddressPrefix>>> = cm.allNetworks.mapNotNull { network ->
      if (cm.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) != true) return@mapNotNull null
      val lp = cm.getLinkProperties(network) ?: return@mapNotNull null
      val prefixes = lp.linkAddresses.map { AddressPrefix(it.address.address, it.prefixLength) } +
        lp.routes.map { AddressPrefix(it.destination.address.address, it.destination.prefixLength) }
      network to prefixes
    }
    NetworkMatcher.pick(target, candidates)?.bindSocket(socket)
  }

  private fun readInterfaces(): List<IfaceInfo> {
    val all = try {
      NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
    } catch (_: SocketException) {
      emptyList()
    }
    // An interface can vanish between the listing and the reads below (SocketException): skip it, keep the rest.
    return InterfaceSnapshot.readAll(all) { ni ->
      IfaceInfo(
        name = ni.name,
        kind = InterfaceClassifier.classify(ni.name, ni.isLoopback),
        addresses = ni.inetAddresses.toList().mapNotNull { it.hostAddress },
        up = ni.isUp,
        multicast = ni.supportsMulticast(),
      )
    }
  }

  private fun interfaceWire(info: IfaceInfo): Map<String, Any?> = mapOf(
    "name" to info.name,
    "kind" to info.kind.wireName,
    "addresses" to info.addresses,
    "up" to info.up,
    "multicast" to info.multicast,
  )
}
