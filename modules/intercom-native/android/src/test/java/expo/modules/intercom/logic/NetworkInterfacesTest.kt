package expo.modules.intercom.logic

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkInterfacesTest {
  private fun iface(
    name: String,
    vararg addrs: String,
    up: Boolean = true,
    multicast: Boolean = true,
  ) = IfaceInfo(name, InterfaceClassifier.classify(name), addrs.toList(), up, multicast)

  @Test fun classifiesAndroidNames() {
    assertEquals(IfaceKind.WIFI, InterfaceClassifier.classify("wlan0"))
    assertEquals(IfaceKind.WIFI, InterfaceClassifier.classify("wlan1"))
    assertEquals(IfaceKind.WIFI_DIRECT, InterfaceClassifier.classify("p2p0"))
    assertEquals(IfaceKind.WIFI_DIRECT, InterfaceClassifier.classify("p2p-wlan0-0"))
    assertEquals(IfaceKind.HOTSPOT, InterfaceClassifier.classify("ap0"))
    assertEquals(IfaceKind.HOTSPOT, InterfaceClassifier.classify("swlan0"))
    assertEquals(IfaceKind.CELLULAR, InterfaceClassifier.classify("rmnet_data1"))
    assertEquals(IfaceKind.CELLULAR, InterfaceClassifier.classify("ccmni0"))
    assertEquals(IfaceKind.VPN, InterfaceClassifier.classify("tun0"))
    assertEquals(IfaceKind.ETHERNET, InterfaceClassifier.classify("eth0"))
    assertEquals(IfaceKind.LOOPBACK, InterfaceClassifier.classify("lo"))
    assertEquals(IfaceKind.LOOPBACK, InterfaceClassifier.classify("weird", isLoopback = true))
    assertEquals(IfaceKind.OTHER, InterfaceClassifier.classify("dummy0"))
    assertEquals(IfaceKind.OTHER, InterfaceClassifier.classify("apple")) // "ap" prefix alone is not a hotspot
  }

  @Test fun picksWifiAddress() {
    val choice = AdvertiseAddressSelector.choose(
      listOf(iface("lo", "127.0.0.1"), iface("rmnet0", "100.70.1.2"), iface("wlan0", "fe80::1%wlan0", "192.168.1.20")),
    )
    assertEquals(AdvertiseChoice("wlan0", IfaceKind.WIFI, "192.168.1.20"), choice)
  }

  @Test fun wifiDirectAndHotspotBeatWifi() {
    val wifi = iface("wlan0", "192.168.1.20")
    assertEquals("p2p-wlan0-0", AdvertiseAddressSelector.choose(listOf(wifi, iface("p2p-wlan0-0", "192.168.49.1")))!!.interfaceName)
    assertEquals("ap0", AdvertiseAddressSelector.choose(listOf(wifi, iface("ap0", "192.168.43.1")))!!.interfaceName)
    assertEquals("p2p0", AdvertiseAddressSelector.choose(listOf(iface("ap0", "192.168.43.1"), iface("p2p0", "192.168.49.1")))!!.interfaceName)
  }

  @Test fun skipsDownNonMulticastCellularVpn() {
    assertNull(AdvertiseAddressSelector.choose(listOf(iface("wlan0", "192.168.1.5", up = false))))
    assertNull(AdvertiseAddressSelector.choose(listOf(iface("wlan0", "192.168.1.5", multicast = false))))
    assertNull(AdvertiseAddressSelector.choose(listOf(iface("rmnet0", "10.1.1.1"), iface("tun0", "10.8.0.2"))))
    assertNull(AdvertiseAddressSelector.choose(emptyList()))
  }

  @Test fun fallsThroughWhenBestInterfaceHasNoUsableAddress() {
    val choice = AdvertiseAddressSelector.choose(listOf(iface("p2p0", "169.254.3.4", "fe80::2"), iface("wlan0", "10.0.0.7")))
    assertEquals("wlan0", choice!!.interfaceName)
  }

  @Test fun addressPreference() {
    assertEquals("192.168.0.2", AdvertiseAddressSelector.bestAddress(listOf("fe80::1", "8.8.4.4", "192.168.0.2")))
    assertEquals("8.8.4.4", AdvertiseAddressSelector.bestAddress(listOf("fe80::1", "8.8.4.4")))
    assertEquals("2001:db8::1", AdvertiseAddressSelector.bestAddress(listOf("fe80::1%wlan0", "2001:db8::1")))
    assertNull(AdvertiseAddressSelector.bestAddress(listOf("169.254.1.1", "fe80::1", "0.0.0.0", "::1")))
  }

  @Test fun addressPredicates() {
    assertTrue(AdvertiseAddressSelector.isPrivateV4("172.16.0.1"))
    assertTrue(AdvertiseAddressSelector.isPrivateV4("172.31.255.255"))
    assertFalse(AdvertiseAddressSelector.isPrivateV4("172.32.0.1"))
    assertFalse(AdvertiseAddressSelector.isPrivateV4("100.64.0.1"))
    assertTrue(AdvertiseAddressSelector.isLinkLocal("fe80::abcd%wlan0"))
    assertTrue(AdvertiseAddressSelector.isLinkLocal("169.254.9.9"))
    assertFalse(AdvertiseAddressSelector.isLinkLocal("fd00::1"))
    assertFalse(AdvertiseAddressSelector.isIpv4("1.2.3"))
    assertFalse(AdvertiseAddressSelector.isIpv4("1.2.3.256"))
    assertFalse(AdvertiseAddressSelector.isIpv4("a.b.c.d"))
  }
}
