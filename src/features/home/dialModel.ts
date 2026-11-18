import type { PairingSummary } from '../../app/store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "17 Nov 2026" (engraved in capitals by the dial). */
export function formatSince(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** First letter of a name, upper case; '?' when there is none. */
export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  const first = trimmed ? Array.from(trimmed)[0] : undefined;
  return first ? first.toUpperCase() : '?';
}

/**
 * Who is rider and who is pillion on the dial: the host showed the plate and is normally the rider.
 */
export function dialPair(pairing: PairingSummary, you: string, partnerFallback: string) {
  const partner = pairing.partnerName ?? partnerFallback;
  const youInitial = initialOf(you);
  const partnerInitial = initialOf(pairing.partnerName);
  return {
    partner,
    riderInitial: pairing.role === 'host' ? youInitial : partnerInitial,
    pillionInitial: pairing.role === 'host' ? partnerInitial : youInitial,
    since: formatSince(pairing.createdAt),
  };
}
