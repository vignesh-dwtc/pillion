import { encodeHandshakeMessage, parseHandshakeMessage, type ParsedHandshakeMessage } from '../codec';
import { FrameDecoder, encodeFrame } from '../frame';
import type { HandshakeMessage } from '../messages';
import type { ByteChannel } from '../secureChannel';
import { settle } from './memoryPipe';

/**
 * A scripted peer on one end of a pipe: it speaks frames but none of the handshake logic, so a test decides
 * exactly what the other side (the code under test) sees.
 */
export class RawPeer {
  /** Payloads of every complete frame received, in order. */
  readonly frames: Uint8Array[] = [];
  closeReason: string | null = null;
  decodeError: unknown = null;
  private cursor = 0;
  private readonly decoder = new FrameDecoder();

  constructor(readonly channel: ByteChannel) {
    channel.onData((chunk) => {
      this.decoder.push(chunk);
      try {
        for (let frame = this.decoder.next(); frame !== null; frame = this.decoder.next())
          this.frames.push(frame);
      } catch (error) {
        this.decodeError = error;
      }
    });
    channel.onClose((reason) => {
      this.closeReason = reason;
    });
  }

  sendFrame(payload: Uint8Array): Promise<void> {
    return this.channel.send(encodeFrame(payload));
  }

  sendHandshake(message: HandshakeMessage): Promise<void> {
    return this.sendFrame(encodeHandshakeMessage(message));
  }

  /** Raw bytes exactly as given (no framing): for garbage, partial headers and oversized lengths. */
  sendRaw(bytes: Uint8Array): Promise<void> {
    return this.channel.send(bytes);
  }

  /** The next frame not yet consumed by the test, after letting the event loop settle. */
  async next(): Promise<Uint8Array> {
    await settle();
    const frame = this.frames[this.cursor];
    if (frame === undefined) throw new Error('the peer under test sent no further frame');
    this.cursor += 1;
    return frame;
  }

  async nextHandshake(): Promise<ParsedHandshakeMessage> {
    return parseHandshakeMessage(await this.next());
  }

  /** How many frames arrived that the test has not consumed yet. */
  get unread(): number {
    return this.frames.length - this.cursor;
  }
}
