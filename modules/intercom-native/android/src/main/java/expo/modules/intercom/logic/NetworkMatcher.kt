package expo.modules.intercom.logic

/** An address prefix (IPv4 or IPv6 bytes + length) from a network's LinkProperties. */
class AddressPrefix(val address: ByteArray, val prefixLength: Int) {
  /** True when [target] lies inside this prefix. Different address families never match. */
  fun contains(target: ByteArray): Boolean {
    if (target.size != address.size) return false
    val bits = prefixLength.coerceIn(0, address.size * 8)
    val fullBytes = bits / 8
    for (i in 0 until fullBytes) if (target[i] != address[i]) return false
    val rest = bits % 8
    if (rest == 0) return true
    val mask = (0xFF shl (8 - rest)) and 0xFF
    return (target[fullBytes].toInt() and mask) == (address[fullBytes].toInt() and mask)
  }
}

/**
 * Chooses the network a guest's TCP socket must be bound to. Background: a Wi-Fi network without internet is not the
 * default network while mobile data is up, and an unbound socket follows the default network's routes (cellular has
 * 0.0.0.0/0), so connect() to the LAN address NSD resolved would go out over mobile data and fail.
 *
 * Rule: among the candidates (the connected Wi-Fi networks), the one with the longest non-default prefix (link address
 * or route) containing the target wins. Default routes (/0) are ignored: they match everything and prove nothing. No
 * match: null (leave the socket unbound; e.g. a Wi-Fi Direct group address in M2, which is not a ConnectivityManager
 * network).
 */
object NetworkMatcher {
  fun <T> pick(target: ByteArray, candidates: List<Pair<T, List<AddressPrefix>>>): T? {
    var best: T? = null
    var bestLength = 0
    for ((network, prefixes) in candidates) {
      for (prefix in prefixes) {
        if (prefix.prefixLength <= 0) continue
        if (!prefix.contains(target)) continue
        if (prefix.prefixLength > bestLength) {
          best = network
          bestLength = prefix.prefixLength
        }
      }
    }
    return best
  }

  /**
   * Bytes of a numeric IPv4/IPv6 literal (an optional `%scope` suffix is ignored), or null for anything else. Never
   * resolves a name (no DNS): NSD hands over numeric addresses.
   */
  fun numericAddress(host: String): ByteArray? {
    val bare = host.substringBefore('%').removePrefix("[").removeSuffix("]")
    return parseIpv4(bare) ?: parseIpv6(bare)
  }

  private fun parseIpv4(s: String): ByteArray? {
    val parts = s.split('.')
    if (parts.size != 4) return null
    val out = ByteArray(4)
    for ((i, p) in parts.withIndex()) {
      if (p.isEmpty() || p.length > 3 || !p.all { it in '0'..'9' }) return null
      val v = p.toInt()
      if (v > 255) return null
      out[i] = v.toByte()
    }
    return out
  }

  private fun parseIpv6(s: String): ByteArray? {
    if (!s.contains(':')) return null
    val halves = s.split("::")
    if (halves.size > 2) return null
    fun groups(part: String): List<Int>? {
      if (part.isEmpty()) return emptyList()
      return part.split(':').map { g ->
        if (g.isEmpty() || g.length > 4 || !g.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
        g.toInt(16)
      }
    }
    val head = groups(halves[0]) ?: return null
    val tail = if (halves.size == 2) groups(halves[1]) ?: return null else emptyList()
    val all: List<Int> = if (halves.size == 2) {
      val missing = 8 - head.size - tail.size
      if (missing < 1) return null
      head + List(missing) { 0 } + tail
    } else {
      head
    }
    if (all.size != 8) return null
    val out = ByteArray(16)
    all.forEachIndexed { i, g ->
      out[2 * i] = (g shr 8).toByte()
      out[2 * i + 1] = g.toByte()
    }
    return out
  }
}
