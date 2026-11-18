package expo.modules.intercom.logic

import java.net.SocketException

enum class IfaceKind(val wireName: String) {
  WIFI("wifi"),
  WIFI_DIRECT("wifi-direct"),
  HOTSPOT("hotspot"),
  CELLULAR("cellular"),
  ETHERNET("ethernet"),
  VPN("vpn"),
  LOOPBACK("loopback"),
  OTHER("other"),
}

data class IfaceInfo(
  val name: String,
  val kind: IfaceKind,
  val addresses: List<String>,
  val up: Boolean,
  val multicast: Boolean,
)

data class AdvertiseChoice(val interfaceName: String, val kind: IfaceKind, val address: String)

/** Classifies interfaces by their Linux names (Android naming conventions; unknown names are OTHER). */
object InterfaceClassifier {
  fun classify(name: String, isLoopback: Boolean = false): IfaceKind {
    val n = name.lowercase()
    return when {
      isLoopback || n == "lo" -> IfaceKind.LOOPBACK
      n.startsWith("p2p") -> IfaceKind.WIFI_DIRECT // p2p0, p2p-wlan0-0, p2p-p2p0-3
      n.startsWith("ap") && n.drop(2).all { it.isDigit() } -> IfaceKind.HOTSPOT // ap0, ap1
      n.startsWith("swlan") || n.startsWith("softap") -> IfaceKind.HOTSPOT
      n.startsWith("wlan") -> IfaceKind.WIFI
      n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("v4-rmnet") || n.startsWith("pdp") || n.startsWith("wwan") -> IfaceKind.CELLULAR
      n.startsWith("tun") || n.startsWith("ppp") || n.startsWith("tap") || n.startsWith("wg") -> IfaceKind.VPN
      n.startsWith("eth") || n.startsWith("usb") || n.startsWith("rndis") -> IfaceKind.ETHERNET
      else -> IfaceKind.OTHER
    }
  }
}

/**
 * Which local interface/address a host advertises and listens on. Candidates: up, non-loopback, multicast-capable
 * (mDNS needs it) wifi-direct / hotspot / wifi / ethernet interfaces. Cellular, VPN and unknown interfaces are never
 * advertised on: the peer is on the local link. Within a kind IPv4 wins; link-local addresses (169.254/16, fe80::/10) are
 * skipped, private RFC 1918 addresses are preferred over other IPv4.
 */
object AdvertiseAddressSelector {
  private val KIND_ORDER = listOf(IfaceKind.WIFI_DIRECT, IfaceKind.HOTSPOT, IfaceKind.WIFI, IfaceKind.ETHERNET)

  fun choose(interfaces: List<IfaceInfo>): AdvertiseChoice? =
    interfaces
      .filter { it.up && it.multicast && it.kind in KIND_ORDER }
      .sortedBy { KIND_ORDER.indexOf(it.kind) }
      .firstNotNullOfOrNull { iface -> bestAddress(iface.addresses)?.let { AdvertiseChoice(iface.name, iface.kind, it) } }

  fun bestAddress(addresses: List<String>): String? {
    val v4 = addresses.filter { isIpv4(it) && !isLinkLocal(it) && it != "0.0.0.0" }
    v4.firstOrNull { isPrivateV4(it) }?.let { return it }
    v4.firstOrNull()?.let { return it }
    return addresses.firstOrNull { it.contains(':') && !isLinkLocal(it) && it != "::" && it != "::1" }
  }

  fun isIpv4(a: String): Boolean {
    val parts = a.split('.')
    return parts.size == 4 && parts.all { p -> p.isNotEmpty() && p.length <= 3 && p.all(Char::isDigit) && p.toInt() in 0..255 }
  }

  fun isLinkLocal(a: String): Boolean {
    val bare = a.substringBefore('%').lowercase()
    if (isIpv4(bare)) return bare.startsWith("169.254.")
    return bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")
  }

  fun isPrivateV4(a: String): Boolean {
    val p = a.split('.').map { it.toIntOrNull() ?: return false }
    if (p.size != 4) return false
    return p[0] == 10 || (p[0] == 172 && p[1] in 16..31) || (p[0] == 192 && p[1] == 168)
  }
}

/**
 * Reads every interface with [read], skipping the ones whose read throws [SocketException]. `NetworkInterface.isUp`,
 * `supportsMulticast` and friends query the kernel each time and throw when an interface disappears mid-listing
 * (Wi-Fi Direct groups and hotspots come and go), which must cost that one entry, not the whole listing.
 */
object InterfaceSnapshot {
  fun <T> readAll(items: List<T>, read: (T) -> IfaceInfo): List<IfaceInfo> =
    items.mapNotNull { item ->
      try {
        read(item)
      } catch (_: SocketException) {
        null
      }
    }
}
