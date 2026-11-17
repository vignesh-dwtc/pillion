package expo.modules.intercom

import expo.modules.kotlin.exception.CodedException

/** Surface declared in specs/ but not implemented in this milestone. Rejects with code ERR_NOT_IMPLEMENTED. */
class NotImplementedYet(feature: String) :
  CodedException("ERR_NOT_IMPLEMENTED", "$feature is not implemented yet (milestone M1)", null)

/** The module API version the specs/ files describe. Bump together with the TypeScript specs. */
const val INTERCOM_API_VERSION = 1

/** Returns Unit on purpose (Expo's AsyncFunction needs a concrete result type, a lambda returning Nothing fails to compile). */
fun notYet(feature: String) {
  throw NotImplementedYet(feature)
}
