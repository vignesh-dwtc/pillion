package expo.modules.intercom.logic

/**
 * NSD service names derived from the (non-secret) pair id: `<prefix><pairId>`. A DNS-SD instance label is at most
 * 63 bytes, and NsdManager renames a clashing registration to "<name> (2)", which [parsePairId] tolerates.
 * The prefix is a protocol constant passed by JS, never a product name.
 */
object NsdServiceNames {
  const val DEFAULT_PREFIX = "pn-"
  const val MAX_LABEL_BYTES = 63

  private val PAIR_ID = Regex("[A-Za-z0-9_-]+")
  private val CONFLICT_SUFFIX = Regex(" \\(\\d+\\)$")

  /** @throws IllegalArgumentException when [pairId] is not base64url or the result exceeds the label limit. */
  fun build(pairId: String, prefix: String = DEFAULT_PREFIX): String {
    require(PAIR_ID.matches(pairId)) { "pairId must be non-empty base64url" }
    val name = prefix + pairId
    require(name.toByteArray(Charsets.UTF_8).size <= MAX_LABEL_BYTES) { "service name longer than $MAX_LABEL_BYTES bytes" }
    return name
  }

  /** The pair id inside [serviceName], or null when it is not one of ours. Matching is exact (case-sensitive). */
  fun parsePairId(serviceName: String, prefix: String = DEFAULT_PREFIX): String? {
    val base = serviceName.replace(CONFLICT_SUFFIX, "")
    if (!base.startsWith(prefix)) return null
    val id = base.substring(prefix.length)
    return if (PAIR_ID.matches(id)) id else null
  }

  fun matches(serviceName: String, pairId: String, prefix: String = DEFAULT_PREFIX): Boolean =
    parsePairId(serviceName, prefix) == pairId

  /** NsdServiceInfo reports "_x._tcp." with a trailing dot; registration takes it without. Compare through this. */
  fun normalizeServiceType(type: String): String = type.trim().trimEnd('.').lowercase()

  fun sameServiceType(a: String, b: String): Boolean = normalizeServiceType(a) == normalizeServiceType(b)

  /**
   * DNS-SD service type as NsdManager takes it: `_<name>._tcp` or `_<name>._udp`, name 1-15 characters of letters, digits
   * and hyphens (RFC 6335 section 5.1), no trailing dot.
   */
  fun isValidServiceType(type: String): Boolean = SERVICE_TYPE.matches(type)

  private val SERVICE_TYPE = Regex("_[A-Za-z0-9](?:[A-Za-z0-9-]{0,13}[A-Za-z0-9])?\\._(tcp|udp)")
}
