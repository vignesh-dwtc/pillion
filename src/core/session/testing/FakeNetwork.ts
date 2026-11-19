import type { Unsubscribe } from '../../common/types';

/**
 * The shared physical layer of a simulation. The in-memory link and the fake media path both read it, so
 * "the phones walked out of range" is one switch that takes the signaling link AND the audio path down.
 *
 *   up        false: nothing can connect, existing links are cut (network-lost), media paths go down
 *   blackhole true:  everything silently vanishes but nothing reports an error (a half-open TCP connection):
 *                    only heartbeats can notice
 */
export class FakeNetwork {
  private upState = true;
  private blackholeState = false;
  private readonly listeners = new Set<() => void>();

  get isUp(): boolean {
    return this.upState;
  }

  get isBlackholed(): boolean {
    return this.blackholeState;
  }

  setUp(up: boolean): void {
    if (this.upState === up) return;
    this.upState = up;
    this.notify();
  }

  setBlackhole(on: boolean): void {
    if (this.blackholeState === on) return;
    this.blackholeState = on;
    this.notify();
  }

  /** Called after every change of `up` or `blackhole`. */
  onChange(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
