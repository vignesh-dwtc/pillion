package expo.modules.intercom

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import expo.modules.intercom.logic.LockHolders
import expo.modules.intercom.logic.WifiLockPlan

/**
 * Wi-Fi locks of the link:
 *  - MulticastLock (CHANGE_WIFI_MULTICAST_STATE): mDNS reception. Held while advertising, discovering, or explicitly
 *    (`acquireLocks`). NsdManager docs: required before T extensions 7; later the system manages it only for foreground
 *    apps, and a ride runs with the screen off.
 *  - WifiLock(s) (WAKE_LOCK) per [WifiLockPlan]: held only explicitly (`acquireLocks`), so the radio does not doze mid-ride.
 * Locks are not reference counted; [LockHolders] decides when to acquire and release. Tags carry no product name.
 */
class LinkLocks(context: Context) {
  private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  private val multicastHolders = LockHolders()
  private val multicast: WifiManager.MulticastLock =
    wifi.createMulticastLock("intercom:link-mdns").apply { setReferenceCounted(false) }
  private val wifiLocks: List<WifiManager.WifiLock> = WifiLockPlan.modes(Build.VERSION.SDK_INT).map { mode ->
    @Suppress("DEPRECATION") // WIFI_MODE_FULL_HIGH_PERF only below API 34 (see WifiLockPlan).
    wifi.createWifiLock(mode, "intercom:link-$mode").apply { setReferenceCounted(false) }
  }

  @Synchronized fun holdMulticast(holder: String) {
    if (multicastHolders.add(holder)) multicast.acquire()
  }

  @Synchronized fun releaseMulticast(holder: String) {
    if (multicastHolders.remove(holder) && multicast.isHeld) multicast.release()
  }

  @Synchronized fun acquireExplicit() {
    holdMulticast(EXPLICIT)
    wifiLocks.forEach { if (!it.isHeld) it.acquire() }
  }

  @Synchronized fun releaseExplicit() {
    releaseMulticast(EXPLICIT)
    wifiLocks.forEach { if (it.isHeld) it.release() }
  }

  @Synchronized fun releaseAll() {
    multicastHolders.clear()
    if (multicast.isHeld) multicast.release()
    wifiLocks.forEach { if (it.isHeld) it.release() }
  }

  companion object {
    const val EXPLICIT = "explicit"
    const val DISCOVERY = "discovery"
    const val ADVERTISING = "advertising"
  }
}
