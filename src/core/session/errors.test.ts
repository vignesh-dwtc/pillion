import { LinkError } from '../../platform/link/LinkTransport';
import { MediaError } from '../../platform/media/MediaEngine';
import { ProtocolError, type ProtocolErrorCode } from '../protocol/secureChannel';
import {
  FAILURES,
  FatalFailure,
  describeError,
  failureFromCloseReason,
  failureFromLinkError,
  failureFromMediaError,
  failureFromMediaStartError,
  failureFromProtocolError,
} from './errors';

describe('describeError', () => {
  it('describes errors, strings and odd values on one bounded line', () => {
    expect(describeError(new Error('  multi\nline   text '))).toBe('multi line text');
    expect(describeError('plain')).toBe('plain');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
    expect(describeError(undefined)).toBe('undefined');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeError(circular)).toBe('unknown error');
    const long = describeError(new Error('x'.repeat(500)));
    expect(long.length).toBeLessThanOrEqual(203);
    expect(long.endsWith('...')).toBe(true);
  });

  it('falls back to the error name for an empty message', () => {
    expect(describeError(new TypeError(''))).toBe('TypeError');
  });
});

describe('failureFromLinkError', () => {
  const cases: [ConstructorParameters<typeof LinkError>[0], string, boolean][] = [
    ['unavailable', 'link-unavailable', true],
    ['permission', 'permission-denied', false],
    ['timeout', 'link-unavailable', true],
    ['aborted', 'link-unavailable', true],
    ['discovery-failed', 'link-unavailable', true],
    ['connect-failed', 'link-unavailable', true],
    ['unsupported', 'link-unavailable', false],
  ];
  it.each(cases)('maps LinkError(%s) to %s, recoverable %s', (code, mapped, recoverable) => {
    const failure = failureFromLinkError(new LinkError(code, 'native detail'));
    expect(failure.code).toBe(mapped);
    expect(failure.recoverable).toBe(recoverable);
    expect(failure.detail).toContain('native detail');
  });

  it('never copies the lower-layer text into the user-facing message', () => {
    const failure = failureFromLinkError(
      new LinkError('connect-failed', 'DIRECT-xy-home passphrase hunter2'),
    );
    expect(failure.message).not.toContain('hunter2');
    expect(failure.message).not.toContain('DIRECT');
  });

  it('treats unknown errors as a lost connection (recoverable)', () => {
    expect(failureFromLinkError(new Error('socket exploded'))).toMatchObject({
      code: 'link-unavailable',
      recoverable: true,
    });
    expect(failureFromLinkError('weird')).toMatchObject({ code: 'link-unavailable', recoverable: true });
  });

  it('recognises a LinkError by name and code, not by instanceof (duplicate module copies)', () => {
    const lookalike = Object.assign(new Error('x'), { name: 'LinkError', code: 'permission' });
    expect(failureFromLinkError(lookalike).code).toBe('permission-denied');
  });
});

describe('failureFromProtocolError', () => {
  const cases: [ProtocolErrorCode, string][] = [
    ['handshake-timeout', 'link-unavailable'],
    ['unsupported-version', 'version-mismatch'],
    ['unknown-pair', 'auth-failed'],
    ['bad-proof', 'auth-failed'],
    ['bad-mac', 'auth-failed'],
    ['malformed-frame', 'link-unavailable'],
    ['frame-too-large', 'link-unavailable'],
    ['busy', 'link-unavailable'],
    ['closed', 'link-unavailable'],
  ];
  it.each(cases)('maps ProtocolError(%s) to %s', (code, mapped) => {
    expect(failureFromProtocolError(new ProtocolError(code)).code).toBe(mapped);
  });

  it('keeps every handshake failure recoverable: an unauthenticated peer must not be able to end a ride', () => {
    for (const [code] of cases) {
      expect(failureFromProtocolError(new ProtocolError(code)).recoverable).toBe(true);
    }
  });

  it('maps anything else thrown during the handshake to a lost connection', () => {
    expect(failureFromProtocolError(new TypeError('bad options'))).toMatchObject({
      code: 'link-unavailable',
      recoverable: true,
    });
  });
});

describe('failureFromCloseReason', () => {
  it('maps transport reasons to link-unavailable with a fitting message', () => {
    expect(failureFromCloseReason('remote-close').message).toMatch(/partner closed/i);
    expect(failureFromCloseReason('network-lost').message).toMatch(/network/i);
    for (const reason of ['io-error', 'timeout', 'aborted', 'local-close']) {
      expect(failureFromCloseReason(reason)).toMatchObject({ code: 'link-unavailable', recoverable: true });
    }
  });

  it('maps protocol codes that close an authenticated channel', () => {
    expect(failureFromCloseReason('bad-mac').code).toBe('auth-failed');
    expect(failureFromCloseReason('malformed-frame').code).toBe('link-unavailable');
    expect(failureFromCloseReason('something-new').code).toBe('link-unavailable');
  });
});

describe('media failures', () => {
  it('maps mid-ride media errors: unsupported and permission end the ride, the rest retry', () => {
    expect(failureFromMediaError(new MediaError('permission'))).toMatchObject({
      code: 'permission-denied',
      recoverable: false,
    });
    expect(failureFromMediaError(new MediaError('unsupported'))).toMatchObject({
      code: 'media-failed',
      recoverable: false,
    });
    for (const code of ['negotiation-failed', 'capture-failed', 'closed'] as const) {
      expect(failureFromMediaError(new MediaError(code))).toMatchObject({
        code: 'media-failed',
        recoverable: true,
      });
    }
    expect(failureFromMediaError(new Error('x'))).toMatchObject({ code: 'media-failed', recoverable: true });
  });

  it('maps start errors: a denied microphone is permission-denied, anything else media-failed, never recoverable', () => {
    expect(failureFromMediaStartError(new MediaError('permission'))).toMatchObject({
      code: 'permission-denied',
      recoverable: false,
    });
    expect(failureFromMediaStartError(new MediaError('capture-failed'))).toMatchObject({
      code: 'media-failed',
      recoverable: false,
    });
    expect(failureFromMediaStartError(new Error('x'))).toMatchObject({
      code: 'media-failed',
      recoverable: false,
    });
  });
});

describe('constants', () => {
  it('every built-in failure is recoverable and carries no lower-layer text', () => {
    for (const failure of Object.values(FAILURES)) {
      expect(failure.recoverable).toBe(true);
      expect(failure.message.length).toBeGreaterThan(0);
    }
  });

  it('FatalFailure carries its failure', () => {
    const failure = { code: 'no-headset', message: 'm', recoverable: false } as const;
    const error = new FatalFailure(failure);
    expect(error.failure).toBe(failure);
    expect(error.message).toBe('m');
  });
});
