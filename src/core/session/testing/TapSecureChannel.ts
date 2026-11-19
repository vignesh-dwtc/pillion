import type { Clock, Unsubscribe } from '../../common/types';
import type { SessionMessage } from '../../protocol/messages';
import type { EstablishSecureChannel, SecureChannel } from '../../protocol/secureChannel';

/**
 * A man-in-the-middle at the secure-channel level, for tests. It wraps any `EstablishSecureChannel` (the stand-in
 * or the real protocol) and sees every SESSION message a side sends, with the sender and the virtual time:
 *  - `records` is the exact wire order of the signaling (who spoke first, offer before candidates, ...);
 *  - `rewrite` can change, drop or multiply what a side sends before it is framed (and, with the real protocol,
 *    authenticated): the partner then really receives a stale generation, a malformed field, a duplicate offer,
 *    a `bye`. The messages stay perfectly authentic, which is the point: they test what the session layer does
 *    with odd but authenticated input.
 */

export interface WireRecord {
  /** Virtual time the message was handed to the secure channel. */
  t: number;
  from: 'host' | 'guest';
  message: SessionMessage;
}

export interface TapOptions {
  clock: Clock;
  records: WireRecord[];
  /**
   * Called for each message a side sends. Return the messages to send instead (an empty array drops it), or
   * undefined to send it unchanged. `index` counts the messages that side has sent on this channel.
   */
  rewrite?: (from: 'host' | 'guest', message: SessionMessage, index: number) => SessionMessage[] | undefined;
}

class TappedChannel implements SecureChannel {
  private sent = 0;

  constructor(
    private readonly inner: SecureChannel,
    private readonly options: TapOptions,
  ) {}

  get role(): 'host' | 'guest' {
    return this.inner.role;
  }

  async send(message: SessionMessage): Promise<void> {
    const index = this.sent;
    this.sent += 1;
    const replacement = this.options.rewrite?.(this.role, message, index);
    const outgoing = replacement ?? [message];
    for (const m of outgoing) {
      this.options.records.push({ t: this.options.clock.now(), from: this.role, message: m });
      await this.inner.send(m);
    }
  }

  onMessage(listener: (message: SessionMessage) => void): Unsubscribe {
    return this.inner.onMessage(listener);
  }

  onClose(listener: (reason: string) => void): Unsubscribe {
    return this.inner.onClose(listener);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

export function tapEstablish(inner: EstablishSecureChannel, options: TapOptions): EstablishSecureChannel {
  return async (channel, secureOptions) => new TappedChannel(await inner(channel, secureOptions), options);
}

/** Convenience: the types of the recorded messages, optionally for one sender. */
export function wireTypes(records: readonly WireRecord[], from?: 'host' | 'guest'): string[] {
  return records.filter((r) => from === undefined || r.from === from).map((r) => r.message.type);
}
