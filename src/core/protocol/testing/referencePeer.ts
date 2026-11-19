/// <reference types="node" />
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import type { ByteChannel } from '../secureChannel';

/**
 * An INDEPENDENT implementation of the wire protocol, written straight from the spec in messages.ts / the header of
 * handshake.ts using only node:crypto and Buffer: it shares no code with src/core/protocol. A real
 * establishSecureChannel talking to this peer proves conformance to the spec rather than self-consistency.
 */

const frame = (payload: Buffer): Buffer => {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
};

class Deframer {
  private buffer = Buffer.alloc(0);
  push(chunk: Uint8Array): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const out: Buffer[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + length) break;
      out.push(Buffer.from(this.buffer.subarray(4, 4 + length)));
      this.buffer = this.buffer.subarray(4 + length);
    }
    return out;
  }
}

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();
const counterBytes = (n: number): Buffer => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(n));
  return out;
};

export interface ReferencePeer {
  /** Authenticated messages received after the handshake (the guest consumes `ready` itself). */
  readonly messages: Record<string, unknown>[];
  /** Reasons given by plain `reject` frames received. */
  readonly rejects: string[];
  readonly errors: string[];
  readonly established: boolean;
  /** Sends one authenticated session message. */
  send(message: Record<string, unknown>): void;
  /** Raw access for attack tests: the next send counter and the key for that direction. */
  readonly keys: { send: Buffer; receive: Buffer } | null;
  readonly sendCounter: number;
}

export function startReferenceGuest(
  end: ByteChannel,
  secret: Uint8Array,
  pairIdB64: string,
  options: { nonce?: Buffer } = {},
): ReferencePeer {
  const deframer = new Deframer();
  const nonceGuest = options.nonce ?? randomBytes(16);
  const pairId = Buffer.from(pairIdB64, 'base64url');
  const authKey = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'pillion/v1/auth', 32));
  let phase: 'await-ack' | 'await-ready' | 'open' | 'dead' = 'await-ack';
  let keys: { send: Buffer; receive: Buffer } | null = null;
  let sendCounter = 0;
  let receiveCounter = 0;
  const peer = {
    messages: [] as Record<string, unknown>[],
    rejects: [] as string[],
    errors: [] as string[],
    get established() {
      return phase === 'open';
    },
    get keys() {
      return keys;
    },
    get sendCounter() {
      return sendCounter;
    },
    send(message: Record<string, unknown>) {
      if (keys === null) throw new Error('not established');
      const body = Buffer.from(JSON.stringify(message));
      const tag = hmac(keys.send, Buffer.concat([counterBytes(sendCounter), body]));
      sendCounter += 1;
      void end.send(new Uint8Array(frame(Buffer.concat([tag, body]))));
    },
  };
  end.onData((chunk) => {
    for (const payload of deframer.push(chunk)) {
      if (phase === 'await-ack') {
        const message = JSON.parse(payload.toString('utf8')) as Record<string, string | number>;
        if (message.type === 'reject') {
          peer.rejects.push(String(message.reason));
          phase = 'dead';
          return;
        }
        const nonceHost = Buffer.from(String(message.nonce), 'base64url');
        const expected = hmac(authKey, Buffer.concat([Buffer.from('host'), pairId, nonceGuest, nonceHost]));
        if (!timingSafeEqual(expected, Buffer.from(String(message.proof), 'base64url'))) {
          peer.errors.push('host proof invalid');
          phase = 'dead';
          void end.close();
          return;
        }
        const guestProof = hmac(
          authKey,
          Buffer.concat([Buffer.from('guest'), pairId, nonceHost, nonceGuest]),
        );
        const okm = Buffer.from(
          hkdfSync('sha256', secret, Buffer.concat([nonceGuest, nonceHost]), 'pillion/v1/session', 64),
        );
        keys = { send: okm.subarray(0, 32), receive: okm.subarray(32, 64) };
        void end.send(
          new Uint8Array(
            frame(Buffer.from(JSON.stringify({ type: 'auth', proof: guestProof.toString('base64url') }))),
          ),
        );
        phase = 'await-ready';
      } else if (phase === 'await-ready' || phase === 'open') {
        if (keys === null) return;
        const tag = payload.subarray(0, 32);
        const body = payload.subarray(32);
        const expected = hmac(keys.receive, Buffer.concat([counterBytes(receiveCounter), body]));
        if (payload.length < 34 || !timingSafeEqual(expected, tag)) {
          peer.errors.push('bad mac');
          phase = 'dead';
          void end.close();
          return;
        }
        receiveCounter += 1;
        const message = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        if (phase === 'await-ready') {
          if (message.type !== 'ready') {
            peer.errors.push('first message was not ready');
            phase = 'dead';
            return;
          }
          phase = 'open';
        } else {
          peer.messages.push(message);
        }
      }
    }
  });
  void end.send(
    new Uint8Array(
      frame(
        Buffer.from(
          JSON.stringify({ type: 'hello', v: 1, pairId: pairIdB64, nonce: nonceGuest.toString('base64url') }),
        ),
      ),
    ),
  );
  return peer;
}

export function startReferenceHost(
  end: ByteChannel,
  secret: Uint8Array,
  pairIdB64: string,
  options: { nonce?: Buffer } = {},
): ReferencePeer {
  const deframer = new Deframer();
  const nonceHost = options.nonce ?? randomBytes(16);
  const pairId = Buffer.from(pairIdB64, 'base64url');
  const authKey = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'pillion/v1/auth', 32));
  let phase: 'await-hello' | 'await-auth' | 'open' | 'dead' = 'await-hello';
  let keys: { send: Buffer; receive: Buffer } | null = null;
  let nonceGuest: Buffer = Buffer.alloc(0);
  let sendCounter = 0;
  let receiveCounter = 0;
  const sendAuthenticated = (message: Record<string, unknown>): void => {
    if (keys === null) throw new Error('not established');
    const body = Buffer.from(JSON.stringify(message));
    const tag = hmac(keys.send, Buffer.concat([counterBytes(sendCounter), body]));
    sendCounter += 1;
    void end.send(new Uint8Array(frame(Buffer.concat([tag, body]))));
  };
  const peer = {
    messages: [] as Record<string, unknown>[],
    rejects: [] as string[],
    errors: [] as string[],
    get established() {
      return phase === 'open';
    },
    get keys() {
      return keys;
    },
    get sendCounter() {
      return sendCounter;
    },
    send: sendAuthenticated,
  };
  end.onData((chunk) => {
    for (const payload of deframer.push(chunk)) {
      if (phase === 'await-hello') {
        const message = JSON.parse(payload.toString('utf8')) as Record<string, string | number>;
        if (message.type !== 'hello' || message.pairId !== pairIdB64) {
          peer.errors.push('unexpected hello');
          phase = 'dead';
          void end.close();
          return;
        }
        nonceGuest = Buffer.from(String(message.nonce), 'base64url');
        const hostProof = hmac(authKey, Buffer.concat([Buffer.from('host'), pairId, nonceGuest, nonceHost]));
        void end.send(
          new Uint8Array(
            frame(
              Buffer.from(
                JSON.stringify({
                  type: 'hello-ack',
                  v: 1,
                  nonce: nonceHost.toString('base64url'),
                  proof: hostProof.toString('base64url'),
                }),
              ),
            ),
          ),
        );
        phase = 'await-auth';
      } else if (phase === 'await-auth') {
        const message = JSON.parse(payload.toString('utf8')) as Record<string, string | number>;
        if (message.type === 'reject') {
          peer.rejects.push(String(message.reason));
          phase = 'dead';
          return;
        }
        const expected = hmac(authKey, Buffer.concat([Buffer.from('guest'), pairId, nonceHost, nonceGuest]));
        if (
          message.type !== 'auth' ||
          !timingSafeEqual(expected, Buffer.from(String(message.proof), 'base64url'))
        ) {
          peer.errors.push('guest proof invalid');
          phase = 'dead';
          void end.close();
          return;
        }
        const okm = Buffer.from(
          hkdfSync('sha256', secret, Buffer.concat([nonceGuest, nonceHost]), 'pillion/v1/session', 64),
        );
        keys = { send: okm.subarray(32, 64), receive: okm.subarray(0, 32) };
        phase = 'open';
        sendAuthenticated({ type: 'ready' });
      } else if (phase === 'open' && keys !== null) {
        const tag = payload.subarray(0, 32);
        const body = payload.subarray(32);
        const expected = hmac(keys.receive, Buffer.concat([counterBytes(receiveCounter), body]));
        if (payload.length < 34 || !timingSafeEqual(expected, tag)) {
          peer.errors.push('bad mac');
          phase = 'dead';
          void end.close();
          return;
        }
        receiveCounter += 1;
        peer.messages.push(JSON.parse(body.toString('utf8')) as Record<string, unknown>);
      }
    }
  });
  return peer;
}
