package expo.modules.intercom.logic

/** `LinkPeerEvent` of specs/IntercomLink.ts. */
data class PeerEvent(val kind: String, val serviceName: String, val host: String?, val port: Int?) {
  fun toWire(): Map<String, Any?> = mapOf("kind" to kind, "serviceName" to serviceName, "host" to host, "port" to port)

  companion object {
    const val FOUND = "found"
    const val LOST = "lost"
  }
}

/**
 * Filters and de-duplicates discovery results for one pair id. NsdManager reports every service of the type on the
 * network (other pairs, other apps' stale records); only `<prefix><pairId>` (plus NSD's " (n)" conflict suffix) counts.
 * A resolved service is reported as `found` once per distinct host:port, `lost` only after a `found`.
 */
class PeerTracker(serviceType: String, private val pairId: String, private val prefix: String) {
  private val type = NsdServiceNames.normalizeServiceType(serviceType)
  private val reported = HashMap<String, Pair<String, Int>>()

  /** [foundType] is what onServiceFound reported (may carry a trailing dot, or be null when the platform omits it). */
  fun isOurs(serviceName: String, foundType: String?): Boolean {
    if (foundType != null && NsdServiceNames.normalizeServiceType(foundType) != type) return false
    return NsdServiceNames.matches(serviceName, pairId, prefix)
  }

  /** A resolution (or an update of one). Null when nothing new must be reported. */
  @Synchronized fun resolved(serviceName: String, addresses: List<String>, port: Int): PeerEvent? {
    if (!NsdServiceNames.matches(serviceName, pairId, prefix)) return null
    if (port !in 1..65535) return null
    val host = AdvertiseAddressSelector.bestAddress(addresses) ?: return null
    if (reported[serviceName] == host to port) return null
    reported[serviceName] = host to port
    return PeerEvent(PeerEvent.FOUND, serviceName, host, port)
  }

  @Synchronized fun lost(serviceName: String): PeerEvent? {
    if (reported.remove(serviceName) == null) return null
    return PeerEvent(PeerEvent.LOST, serviceName, null, null)
  }

  @Synchronized fun reset() {
    reported.clear()
  }
}

/**
 * Serialises legacy `NsdManager.resolveService` calls (API 29-33): a second resolve while one is in flight fails with
 * FAILURE_ALREADY_ACTIVE. One in flight, the rest wait in arrival order, duplicates are dropped. Thread-safe.
 */
class ResolveQueue<K> {
  private val waiting = ArrayDeque<K>()
  private var inFlight: K? = null

  /** Adds [key]; true when the caller must start resolving it now. */
  @Synchronized fun offer(key: K): Boolean {
    if (inFlight == key || waiting.contains(key)) return false
    if (inFlight == null) {
      inFlight = key
      return true
    }
    waiting.addLast(key)
    return false
  }

  /** The in-flight resolve ended (success or failure). Returns the next key to start, if any. */
  @Synchronized fun done(key: K): K? {
    if (inFlight != key) return null
    inFlight = waiting.removeFirstOrNull()
    return inFlight
  }

  /** The service vanished: drop it if it is still waiting. An in-flight resolve finishes normally. */
  @Synchronized fun remove(key: K) {
    waiting.remove(key)
  }

  @Synchronized fun clear() {
    waiting.clear()
    inFlight = null
  }

  @Synchronized fun inFlight(): K? = inFlight

  @Synchronized fun waitingCount(): Int = waiting.size
}

/**
 * Who needs the Wi-Fi multicast lock (or any other shared lock): it is held while at least one holder exists.
 * Holders: the explicit `acquireLocks`, a running discovery, a running advertisement. Thread-safe.
 */
class LockHolders {
  private val holders = HashSet<String>()

  /** Returns true when this call changed the lock from released to held. */
  @Synchronized fun add(holder: String): Boolean {
    val wasEmpty = holders.isEmpty()
    holders.add(holder)
    return wasEmpty && holders.isNotEmpty()
  }

  /** Returns true when this call changed the lock from held to released. */
  @Synchronized fun remove(holder: String): Boolean {
    if (!holders.remove(holder)) return false
    return holders.isEmpty()
  }

  @Synchronized fun isHeld(): Boolean = holders.isNotEmpty()

  @Synchronized fun clear(): Boolean {
    val was = holders.isNotEmpty()
    holders.clear()
    return was
  }
}

/**
 * Which open connections died with a network change: those whose local address is no longer configured on any up
 * interface. Connections on a still-present address (another network, a Wi-Fi Direct group in M2) are left alone; a
 * connection without a known local address is kept (the socket itself will fail if it is dead).
 */
object NetworkLoss {
  fun lostConnections(connections: List<ConnectionInfo>, interfaces: List<IfaceInfo>): List<String> {
    val live = interfaces.filter { it.up }.flatMap { it.addresses }.map(::bare).toSet()
    return connections
      .filter { c -> c.localAddress != null && bare(c.localAddress) !in live }
      .map { it.connectionId }
  }

  /** "fe80::1%wlan0" -> "fe80::1"; IPv4-mapped "::ffff:10.0.0.2" -> "10.0.0.2". */
  fun bare(address: String): String {
    val noScope = address.substringBefore('%').lowercase()
    return if (noScope.startsWith("::ffff:") && AdvertiseAddressSelector.isIpv4(noScope.removePrefix("::ffff:"))) {
      noScope.removePrefix("::ffff:")
    } else {
      noScope
    }
  }
}
