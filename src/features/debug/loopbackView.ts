import { formatMs } from '../../app/format';
import { strings } from '../../app/strings';
import type { Tone } from '../../app/theme';
import type { LoopbackFailure, LoopbackPhase, LoopbackResult } from '../../platform/media/loopback';

/**
 * What the loopback card says, from the self-test's progress or result. Pure (Jest-tested); the card only draws it.
 * Never shows SDP or candidates: the result carries counters and a short reason only.
 */

export interface LoopbackView {
  tone: Tone;
  status: string;
  detail: string | null;
}

const FAILURE_TEXT: Record<LoopbackFailure, string> = {
  permission: 'the microphone permission was refused',
  'capture-failed': 'the microphone could not start',
  'negotiation-failed': 'the two loop ends could not agree on audio',
  unsupported: 'WebRTC is not available on this build',
  'connect-timeout': 'the loop did not connect in time',
  'connection-failed': 'the loop connection failed',
  'no-audio': 'no audio went round the loop',
  cancelled: 'stopped',
  error: 'an unexpected error',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function describeLoopbackPhase(phase: LoopbackPhase, elapsedMs: number): LoopbackView {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return {
    tone: 'info',
    status: `${strings.debug.loopbackPhases[phase]} · ${seconds} s`,
    detail: null,
  };
}

export function describeLoopbackResult(result: LoopbackResult): LoopbackView {
  const detail = strings.debug.loopbackDetail(
    result.connectMs === null ? strings.common.notAvailable : formatMs(result.connectMs),
    formatBytes(result.bytesSent),
    formatBytes(result.bytesReceived),
    result.packetsLost,
  );
  if (result.ok) return { tone: 'success', status: strings.debug.loopbackPassed, detail };
  const reason = result.failure ? FAILURE_TEXT[result.failure] : FAILURE_TEXT.error;
  return {
    tone: result.failure === 'cancelled' ? 'neutral' : 'danger',
    status: strings.debug.loopbackFailed(reason),
    detail,
  };
}
