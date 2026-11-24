package expo.modules.intercom.logic

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** `NativeCloseReason` of specs/IntercomLink.ts. */
enum class CloseReason(val wireName: String) {
  LOCAL_CLOSE("local-close"),
  REMOTE_CLOSE("remote-close"),
  IO_ERROR("io-error"),
  TIMEOUT("timeout"),
  NETWORK_LOST("network-lost"),
  ABORTED("aborted"),
}

/** A failure with one of the `LinkNativeErrorCode` values of specs/IntercomLink.ts. The message never carries payload bytes. */
class LinkException(val code: String, message: String) : Exception(message) {
  companion object {
    const val NOT_WIFI = "ERR_LINK_NOT_WIFI"
    const val PERMISSION = "ERR_LINK_PERMISSION"
    const val NSD = "ERR_LINK_NSD"
    const val CONNECT = "ERR_LINK_CONNECT"
    const val UNKNOWN_CONNECTION = "ERR_LINK_UNKNOWN_CONNECTION"
    const val IO = "ERR_LINK_IO"
  }
}

data class ConnectionInfo(
  val connectionId: String,
  val localAddress: String?,
  val remoteAddress: String?,
  val interfaceName: String?,
)

data class ListenInfo(val listenerId: String, val port: Int)

/** Callbacks of [TcpHub]. Called from the hub's reader/accept threads; per connection strictly in order. */
interface TcpHubEvents {
  /** A peer connected to [listenerId]. Always delivered before the first [onData] of that connection. */
  fun onAccept(listenerId: String, connection: ConnectionInfo)

  /** [bytes] is a fresh array the receiver may keep. */
  fun onData(connectionId: String, bytes: ByteArray)

  /** Exactly once per connection, after its last [onData]. */
  fun onClose(connectionId: String, reason: CloseReason, detail: String?)
}

/**
 * The TCP half of the byte pipe, in plain JVM code (java.net only, no Android types) so it runs under JUnit against real
 * loopback sockets.
 *
 * - Listeners: one accept thread each. ONE PEER AT A TIME: while a listener's accepted connection is open, further
 *   connections to it are closed right away (the host talks to exactly one partner).
 * - Connections: one reader thread (emits [TcpHubEvents.onData] then exactly one [TcpHubEvents.onClose]) and one writer
 *   thread per connection, so [send] calls are written in call order and never interleave. The writer queue is bounded by
 *   [maxPendingBytes]: a send that would exceed it fails with ERR_LINK_IO instead of buffering without limit (backpressure;
 *   the control channel carries only signalling, so hitting the limit means the peer stopped reading).
 * - Close reasons: the first cause wins (local close, network loss, write error, end of stream, read error). The reader
 *   thread is the only one that reports the close, which keeps `onClose` after the last `onData`.
 *
 * TCP_NODELAY is on (small signalling messages, latency matters) and SO_KEEPALIVE is on (dead peers are detected
 * eventually even without traffic; the session's heartbeats detect them much sooner).
 *
 * [prepareSocket] runs on every outgoing socket before connect (unconnected, still unbound). The app uses it to bind the
 * socket to the Wi-Fi network that holds the target address (Network.bindSocket): otherwise a Wi-Fi network without
 * internet loses to mobile data as the default network and the connect goes out over cellular. A failing hook does not
 * fail the connect. Accepted sockets need nothing: they belong to the network the peer reached us on.
 */
class TcpHub(
  private val events: TcpHubEvents,
  private val maxPendingBytes: Int = DEFAULT_MAX_PENDING_BYTES,
  private val readBufferSize: Int = DEFAULT_READ_BUFFER,
  private val interfaceNameOf: (InetAddress?) -> String? = ::defaultInterfaceName,
  private val prepareSocket: (socket: Socket, host: String) -> Unit = { _, _ -> },
) {
  private val ids = AtomicLong(0)
  private val listeners = ConcurrentHashMap<String, ListenerEntry>()
  private val connections = ConcurrentHashMap<String, Connection>()
  private val pendingConnects = ConcurrentHashMap.newKeySet<Socket>()

  /** Opens a listening socket on every local address. [port] 0 = ephemeral. */
  fun listen(port: Int): ListenInfo {
    require(port in 0..65535) { "port out of range" }
    val server = ServerSocket()
    try {
      server.reuseAddress = true
      server.bind(InetSocketAddress(port))
    } catch (e: IOException) {
      closeQuietly(server)
      throw LinkException(LinkException.IO, "listen failed: ${describe(e)}")
    }
    val id = "l" + ids.incrementAndGet()
    val entry = ListenerEntry(id, server)
    listeners[id] = entry
    Thread({ acceptLoop(entry) }, "intercom-accept-$id").apply { isDaemon = true }.start()
    return ListenInfo(id, server.localPort)
  }

  fun stopListening(listenerId: String) {
    listeners.remove(listenerId)?.let { closeQuietly(it.server) }
  }

  /**
   * Blocking TCP connect with a timeout. Call it from a background thread. The returned connection is already reading; its
   * events can arrive before the caller sees the result (the JS wrapper buffers them by connection id).
   */
  fun connect(host: String, port: Int, timeoutMs: Int): ConnectionInfo {
    require(port in 1..65535) { "port out of range" }
    val socket = Socket()
    pendingConnects.add(socket)
    try {
      try {
        prepareSocket(socket, host)
      } catch (_: Exception) {
        // Best effort: an unbound socket still works whenever the default network can reach the host.
      }
      socket.connect(InetSocketAddress(host, port), ConnectTimeout.clamp(timeoutMs))
    } catch (e: SocketTimeoutException) {
      closeQuietly(socket)
      throw LinkException(LinkException.CONNECT, "connect timed out")
    } catch (e: IOException) {
      closeQuietly(socket)
      throw LinkException(LinkException.CONNECT, "connect failed: ${describe(e)}")
    } catch (e: IllegalArgumentException) {
      closeQuietly(socket)
      throw LinkException(LinkException.CONNECT, "bad address")
    } finally {
      pendingConnects.remove(socket)
    }
    val connection = register(socket)
    connection.startReading()
    return connection.info
  }

  /**
   * Queues [bytes] for writing. [done] is called with null once the bytes are written and flushed, or with a
   * [LinkException] (unknown/closed connection, queue full, write error).
   */
  fun send(connectionId: String, bytes: ByteArray, done: (LinkException?) -> Unit) {
    val connection = connections[connectionId]
    if (connection == null) {
      done(LinkException(LinkException.UNKNOWN_CONNECTION, "unknown or closed connection"))
      return
    }
    connection.send(bytes, done)
  }

  /** Closes the connection; `onClose` follows from its reader thread. Unknown ids are ignored. */
  fun close(connectionId: String, reason: CloseReason = CloseReason.LOCAL_CLOSE, detail: String? = null) {
    connections[connectionId]?.close(reason, detail)
  }

  /** Closes every connection for which [predicate] is true (used on network loss). Returns the ids closed. */
  fun closeWhere(reason: CloseReason, detail: String?, predicate: (ConnectionInfo) -> Boolean): List<String> {
    val closed = connections.values.filter { predicate(it.info) }
    closed.forEach { it.close(reason, detail) }
    return closed.map { it.info.connectionId }
  }

  fun openConnections(): List<ConnectionInfo> = connections.values.map { it.info }

  fun hasActivity(): Boolean = listeners.isNotEmpty() || connections.isNotEmpty() || pendingConnects.isNotEmpty()

  /** Stops every listener, aborts pending connects and closes every connection with [reason]. Reusable afterwards. */
  fun dispose(reason: CloseReason = CloseReason.LOCAL_CLOSE) {
    listeners.keys.toList().forEach(::stopListening)
    pendingConnects.toList().forEach(::closeQuietly)
    connections.values.toList().forEach { it.close(reason, null) }
  }

  private fun acceptLoop(entry: ListenerEntry) {
    while (true) {
      val socket = try {
        entry.server.accept()
      } catch (_: IOException) {
        break // closed by stopListening/dispose
      }
      val current = entry.currentConnectionId.get()
      if (current != null && connections.containsKey(current)) {
        closeQuietly(socket) // one peer at a time
        continue
      }
      if (!listeners.containsKey(entry.id)) {
        closeQuietly(socket)
        break
      }
      val connection = try {
        register(socket)
      } catch (_: IOException) {
        closeQuietly(socket)
        continue
      }
      entry.currentConnectionId.set(connection.info.connectionId)
      events.onAccept(entry.id, connection.info)
      connection.startReading()
    }
  }

  private fun register(socket: Socket): Connection {
    try {
      socket.tcpNoDelay = true
      socket.keepAlive = true
    } catch (_: SocketException) {
      // Options are best effort.
    }
    val id = "c" + ids.incrementAndGet()
    val info = ConnectionInfo(
      connectionId = id,
      localAddress = socket.localAddress?.hostAddress,
      remoteAddress = socket.inetAddress?.hostAddress,
      interfaceName = interfaceNameOf(socket.localAddress),
    )
    val connection = Connection(info, socket, socket.getInputStream(), socket.getOutputStream())
    connections[id] = connection
    return connection
  }

  private class ListenerEntry(val id: String, val server: ServerSocket) {
    val currentConnectionId = AtomicReference<String?>(null)
  }

  private inner class Connection(
    val info: ConnectionInfo,
    private val socket: Socket,
    private val input: InputStream,
    private val output: OutputStream,
  ) {
    private val closing = AtomicBoolean(false)
    private val reason = AtomicReference<Pair<CloseReason, String?>?>(null)
    private val pending = PendingBytes(maxPendingBytes)
    private val writer: ExecutorService = Executors.newSingleThreadExecutor { r ->
      Thread(r, "intercom-write-${info.connectionId}").apply { isDaemon = true }
    }

    fun startReading() {
      Thread(::readLoop, "intercom-read-${info.connectionId}").apply { isDaemon = true }.start()
    }

    fun send(bytes: ByteArray, done: (LinkException?) -> Unit) {
      if (closing.get()) {
        done(LinkException(LinkException.UNKNOWN_CONNECTION, "connection closed"))
        return
      }
      if (!pending.tryReserve(bytes.size)) {
        done(LinkException(LinkException.IO, "send queue full (${pending.limit} bytes pending)"))
        return
      }
      try {
        writer.execute {
          try {
            if (closing.get()) {
              done(LinkException(LinkException.UNKNOWN_CONNECTION, "connection closed"))
              return@execute
            }
            output.write(bytes)
            output.flush()
            done(null)
          } catch (e: IOException) {
            done(LinkException(LinkException.IO, "write failed: ${describe(e)}"))
            close(CloseReason.IO_ERROR, "write failed: ${describe(e)}")
          } finally {
            pending.release(bytes.size)
          }
        }
      } catch (_: java.util.concurrent.RejectedExecutionException) {
        pending.release(bytes.size)
        done(LinkException(LinkException.UNKNOWN_CONNECTION, "connection closed"))
      }
    }

    /** First caller sets the reason; the socket is closed so the reader thread unblocks and reports it. */
    fun close(why: CloseReason, detail: String?) {
      reason.compareAndSet(null, why to detail)
      if (closing.compareAndSet(false, true)) {
        closeQuietly(socket)
        writer.shutdown()
      }
    }

    private fun readLoop() {
      val buffer = ByteArray(readBufferSize)
      var endReason: Pair<CloseReason, String?> = CloseReason.REMOTE_CLOSE to null
      try {
        while (true) {
          val n = input.read(buffer)
          if (n < 0) break
          if (n > 0) events.onData(info.connectionId, buffer.copyOf(n))
        }
      } catch (e: SocketTimeoutException) {
        endReason = CloseReason.TIMEOUT to describe(e)
      } catch (e: IOException) {
        endReason = CloseReason.IO_ERROR to describe(e)
      }
      // A local cause (close, network loss, write error) set before the socket died wins over what the reader saw.
      reason.compareAndSet(null, endReason)
      close(endReason.first, endReason.second)
      connections.remove(info.connectionId)
      val (finalReason, finalDetail) = reason.get() ?: endReason
      events.onClose(info.connectionId, finalReason, finalDetail)
    }
  }

  companion object {
    const val DEFAULT_MAX_PENDING_BYTES = 1 shl 20
    const val DEFAULT_READ_BUFFER = 16 * 1024

    fun defaultInterfaceName(address: InetAddress?): String? = try {
      address?.let { NetworkInterface.getByInetAddress(it)?.name }
    } catch (_: SocketException) {
      null
    }

    /** Exception class and message only: never payload bytes. */
    fun describe(e: Throwable): String = listOfNotNull(e.javaClass.simpleName, e.message).joinToString(": ")

    private fun closeQuietly(closeable: java.io.Closeable) {
      try {
        closeable.close()
      } catch (_: IOException) {
      }
    }
  }
}

/** Byte budget of one connection's write queue. Thread-safe. */
class PendingBytes(val limit: Int) {
  private var used = 0L

  /** Reserves [size] bytes; false when that would exceed [limit]. A single chunk larger than the limit is refused too. */
  @Synchronized fun tryReserve(size: Int): Boolean {
    if (size < 0) return false
    if (used + size > limit) return false
    used += size
    return true
  }

  @Synchronized fun release(size: Int) {
    used = (used - size).coerceAtLeast(0)
  }

  @Synchronized fun used(): Long = used
}

/** Connect timeouts accepted from JS: at least 100 ms (0 would mean "infinite" to java.net), at most 60 s. */
object ConnectTimeout {
  const val MIN_MS = 100
  const val MAX_MS = 60_000

  fun clamp(timeoutMs: Int): Int = timeoutMs.coerceIn(MIN_MS, MAX_MS)
}
