package expo.modules.intercom.logic

import java.util.Base64

/**
 * Byte encoding on the JS bridge: standard Base64 with padding (RFC 4648 section 4), no line breaks.
 * Same alphabet as `atob`/`btoa`, so the TypeScript wrappers decode it without a dependency.
 */
object Base64Codec {
  fun encode(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String {
    require(offset >= 0 && length >= 0 && offset + length <= bytes.size) { "range out of bounds" }
    val slice = if (offset == 0 && length == bytes.size) bytes else bytes.copyOfRange(offset, offset + length)
    return Base64.getEncoder().encodeToString(slice)
  }

  /** @throws IllegalArgumentException when [text] is not valid standard Base64. */
  fun decode(text: String): ByteArray = Base64.getDecoder().decode(text)
}
