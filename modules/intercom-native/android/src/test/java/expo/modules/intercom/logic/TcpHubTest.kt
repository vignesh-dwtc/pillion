package expo.modules.intercom.logic

import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Real loopback sockets: the hub is plain java.net, so the JVM can exercise it end to end. */
class TcpHubTest {
  private sealed class Ev {
    data class Accept(val listenerId: String, val c: ConnectionInfo) : Ev()
    data class Data(val id: String, val bytes: ByteArray) : Ev()
    data class Close(val id: String, val reason: CloseReason, val detail: String?) : Ev()
  }

  private class Recorder : TcpHubEvents {
    val events = LinkedBlockingQueue<Ev>()
    override fun onAccept(listenerId: String, connection: ConnectionInfo) {
      events.add(Ev.Accept(listenerId, connection))
    }
    override fun onData(connectionId: String, bytes: ByteArray) {
      events.add(Ev.Data(connectionId, bytes))
    }
    override fun onClose(connectionId: String, reason: CloseReason, detail: String?) {
      events.add(Ev.Close(connectionId, reason, detail))
    }

    fun next(): Ev = events.poll(5, TimeUnit.SECONDS) ?: throw AssertionError("no event within 5 s")

    inline fun <reified T : Ev> nextOf(): T {
      while (true) {
        val e = next()
        if (e is T) return e
      }
    }

    /** Collects data for [id] until [length] bytes arrived. */
    fun readBytes(id: String, length: Int): ByteArray {
      val out = ByteArrayOutputStream()
      while (out.size() < length) {
        val e = next()
        if (e is Ev.Data && e.id == id) out.write(e.bytes) else if (e is Ev.Close && e.id == id) break
      }
      return out.toByteArray()
    }
  }

  private val hostEvents = Recorder()
  private val guestEvents = Recorder()
  private val host = TcpHub(hostEvents, interfaceNameOf = { "lo" })
  private val guest = TcpHub(guestEvents, interfaceNameOf = { "lo" })

  @After fun tearDown() {
    host.dispose()
    guest.dispose()
  }

  private fun pair(): Triple<String, ConnectionInfo, ConnectionInfo> {
    val l = host.listen(0)
    assertTrue(l.port > 0)
    val out = guest.connect("127.0.0.1", l.port, 2000)
    val acc = hostEvents.nextOf<Ev.Accept>()
    assertEquals(l.listenerId, acc.listenerId)
    return Triple(l.listenerId, acc.c, out)
  }

  private fun send(hub: TcpHub, id: String, bytes: ByteArray): LinkException? {
    val latch = CountDownLatch(1)
    var result: LinkException? = null
    hub.send(id, bytes) {
      result = it
      latch.countDown()
    }
    assertTrue("send did not complete", latch.await(5, TimeUnit.SECONDS))
    return result
  }

  @Test fun bytesFlowBothWaysWithAddresses() {
    val (_, hostSide, guestSide) = pair()
    assertEquals("127.0.0.1", guestSide.remoteAddress)
    assertEquals("127.0.0.1", hostSide.localAddress)
    assertEquals("lo", guestSide.interfaceName)

    assertNull(send(guest, guestSide.connectionId, byteArrayOf(1, 2, 3)))
    assertArrayEquals(byteArrayOf(1, 2, 3), hostEvents.readBytes(hostSide.connectionId, 3))

    assertNull(send(host, hostSide.connectionId, byteArrayOf(9, 8)))
    assertArrayEquals(byteArrayOf(9, 8), guestEvents.readBytes(guestSide.connectionId, 2))
  }

  @Test fun concurrentSendsAreWrittenInCallOrderWithoutInterleaving() {
    val (_, hostSide, guestSide) = pair()
    val chunks = (0 until 200).map { i -> ByteArray(257) { i.toByte() } }
    val latch = CountDownLatch(chunks.size)
    // Issued from one thread in order (as the Expo queue does); the writer thread must keep that order.
    for (c in chunks) guest.send(guestSide.connectionId, c) { e -> assertNull(e); latch.countDown() }
    assertTrue(latch.await(10, TimeUnit.SECONDS))
    val received = hostEvents.readBytes(hostSide.connectionId, 200 * 257)
    assertEquals(200 * 257, received.size)
    for (i in 0 until 200) {
      for (j in 0 until 257) assertEquals(i.toByte(), received[i * 257 + j])
    }
  }

  @Test fun localCloseReportsLocalCloseAndPeerSeesRemoteClose() {
    val (_, hostSide, guestSide) = pair()
    guest.close(guestSide.connectionId)
    val mine = guestEvents.nextOf<Ev.Close>()
    assertEquals(guestSide.connectionId, mine.id)
    assertEquals(CloseReason.LOCAL_CLOSE, mine.reason)
    val theirs = hostEvents.nextOf<Ev.Close>()
    assertEquals(hostSide.connectionId, theirs.id)
    assertEquals(CloseReason.REMOTE_CLOSE, theirs.reason)
  }

  @Test fun onCloseComesExactlyOnceAndAfterTheLastData() {
    val (_, hostSide, guestSide) = pair()
    assertNull(send(guest, guestSide.connectionId, ByteArray(1000) { 7 }))
    guest.close(guestSide.connectionId)
    guest.close(guestSide.connectionId) // idempotent
    var bytes = 0
    var closes = 0
    while (true) {
      val e = hostEvents.next()
      if (e is Ev.Data) {
        assertEquals("data after close", 0, closes)
        bytes += e.bytes.size
      }
      if (e is Ev.Close) {
        closes++
        break
      }
    }
    assertEquals(1000, bytes)
    assertNull(hostEvents.events.poll(200, TimeUnit.MILLISECONDS))
    assertEquals(1, closes)
    assertTrue(host.openConnections().none { it.connectionId == hostSide.connectionId })
  }

  @Test fun sendOnUnknownOrClosedConnectionFails() {
    assertEquals(LinkException.UNKNOWN_CONNECTION, send(guest, "c999", byteArrayOf(1))?.code)
    val (_, _, guestSide) = pair()
    guest.close(guestSide.connectionId)
    guestEvents.nextOf<Ev.Close>()
    assertEquals(LinkException.UNKNOWN_CONNECTION, send(guest, guestSide.connectionId, byteArrayOf(1))?.code)
  }

  @Test fun closingAnUnknownIdIsANoOp() {
    guest.close("nope")
  }

  @Test fun onePeerAtATimePerListener() {
    val l = host.listen(0)
    val first = guest.connect("127.0.0.1", l.port, 2000)
    val accepted = hostEvents.nextOf<Ev.Accept>()
    // A second peer connects at TCP level but is closed right away by the host.
    val intruder = Socket("127.0.0.1", l.port)
    intruder.soTimeout = 3000
    assertEquals(-1, intruder.getInputStream().read())
    intruder.close()
    assertNull(hostEvents.events.poll(200, TimeUnit.MILLISECONDS)?.takeIf { it is Ev.Accept })
    // Once the first connection is gone, the listener accepts again.
    guest.close(first.connectionId)
    hostEvents.nextOf<Ev.Close>().also { assertEquals(accepted.c.connectionId, it.id) }
    guest.connect("127.0.0.1", l.port, 2000)
    assertEquals(l.listenerId, hostEvents.nextOf<Ev.Accept>().listenerId)
  }

  @Test fun connectRefusedIsConnectError() {
    val port = ServerSocket(0).use { it.localPort } // closed again: nothing listens there
    try {
      guest.connect("127.0.0.1", port, 1000)
      fail("expected LinkException")
    } catch (e: LinkException) {
      assertEquals(LinkException.CONNECT, e.code)
    }
  }

  @Test fun stopListeningRefusesNewConnections() {
    val l = host.listen(0)
    host.stopListening(l.listenerId)
    try {
      guest.connect("127.0.0.1", l.port, 1000)
      fail("expected LinkException")
    } catch (e: LinkException) {
      assertEquals(LinkException.CONNECT, e.code)
    }
  }

  @Test fun acceptedConnectionSurvivesStopListening() {
    val (listenerId, hostSide, guestSide) = pair()
    host.stopListening(listenerId)
    assertNull(send(guest, guestSide.connectionId, byteArrayOf(5)))
    assertArrayEquals(byteArrayOf(5), hostEvents.readBytes(hostSide.connectionId, 1))
  }

  @Test fun closeWhereUsesTheGivenReason() {
    val (_, _, guestSide) = pair()
    val closed = guest.closeWhere(CloseReason.NETWORK_LOST, "gone") { it.connectionId == guestSide.connectionId }
    assertEquals(listOf(guestSide.connectionId), closed)
    val e = guestEvents.nextOf<Ev.Close>()
    assertEquals(CloseReason.NETWORK_LOST, e.reason)
    assertEquals("gone", e.detail)
  }

  @Test fun disposeClosesEverythingAndTheHubIsReusable() {
    val (_, _, guestSide) = pair()
    guest.dispose(CloseReason.ABORTED)
    assertEquals(CloseReason.ABORTED, guestEvents.nextOf<Ev.Close>().reason)
    assertTrue(guest.openConnections().isEmpty())
    val l = host.listen(0)
    assertNotNull(guest.connect("127.0.0.1", l.port, 2000))
    assertTrue(guestSide.connectionId.isNotEmpty())
  }

  @Test fun sendQueueOverLimitFailsWithIoError() {
    val small = TcpHub(guestEvents, maxPendingBytes = 10, interfaceNameOf = { null })
    try {
      val l = host.listen(0)
      val c = small.connect("127.0.0.1", l.port, 2000)
      assertEquals(LinkException.IO, send(small, c.connectionId, ByteArray(11))?.code)
      assertNull(send(small, c.connectionId, ByteArray(10)))
    } finally {
      small.dispose()
    }
  }

  @Test fun invalidPortsAreRejected() {
    try {
      host.listen(70000)
      fail()
    } catch (_: IllegalArgumentException) {
    }
    try {
      guest.connect("127.0.0.1", 0, 100)
      fail()
    } catch (_: IllegalArgumentException) {
    }
  }
}

class PendingBytesAndTimeoutTest {
  @Test fun reservesUpToTheLimit() {
    val p = PendingBytes(100)
    assertTrue(p.tryReserve(60))
    assertTrue(p.tryReserve(40))
    assertEquals(false, p.tryReserve(1))
    p.release(40)
    assertTrue(p.tryReserve(40))
    assertEquals(false, p.tryReserve(-1))
    p.release(1000)
    assertEquals(0L, p.used())
  }

  @Test fun clampsConnectTimeouts() {
    assertEquals(ConnectTimeout.MIN_MS, ConnectTimeout.clamp(0))
    assertEquals(ConnectTimeout.MIN_MS, ConnectTimeout.clamp(-5))
    assertEquals(5000, ConnectTimeout.clamp(5000))
    assertEquals(ConnectTimeout.MAX_MS, ConnectTimeout.clamp(Int.MAX_VALUE))
  }

  @Test fun describeNeverIncludesMoreThanClassAndMessage() {
    assertEquals("IOException: boom", TcpHub.describe(java.io.IOException("boom")))
    assertEquals("IOException", TcpHub.describe(java.io.IOException()))
  }
}
