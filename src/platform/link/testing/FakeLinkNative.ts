/**
 * Test fake of the IntercomLink native module: an in-memory "Wi-Fi network" joining any number of fake phones.
 * Advertising registers `<pairId>` -> (phone, listener); discovery on another phone reports it as a resolved `onPeer`;
 * `connect` creates a connection pair and fires `onAccept` on the host; `send` delivers Base64 to the other side.
 * Events are delivered asynchronously (setTimeout 0), like the real bridge. Test-only: never imported by app code.
 */
import type {
  IntercomLinkEvents,
  NativeConnection,
  NativeNetworkInterface,
} from '../../../../specs/IntercomLink';
import type { LinkNativeModule } from '../LanTransport';

type EventName = keyof IntercomLinkEvents;
type AnyListener = (event: never) => void;

interface Advert {
  phone: FakeLinkNative;
  listenerId: string;
  port: number;
}

export class FakeNetwork {
  readonly adverts = new Map<string, Advert>();
  private readonly phones = new Set<FakeLinkNative>();
  private nextPort = 40000;
  private nextId = 0;

  join(address: string): FakeLinkNative {
    const phone = new FakeLinkNative(this, address);
    this.phones.add(phone);
    return phone;
  }

  port(): number {
    this.nextPort += 1;
    return this.nextPort;
  }

  id(prefix: string): string {
    this.nextId += 1;
    return `${prefix}${this.nextId}`;
  }

  /** Announce an advertisement to every discovering phone. */
  announce(pairId: string) {
    for (const phone of this.phones) phone.maybeReport(pairId);
  }

  findListener(host: string, port: number): Advert | undefined {
    return [...this.adverts.values()].find((a) => a.phone.address === host && a.port === port);
  }
}

export class FakeLinkNative implements LinkNativeModule {
  wifi = true;
  /** Set to make the next connect() reject with this native code. */
  connectError: string | null = null;
  /** When true, connect() never settles (a hung native call). */
  connectHangs = false;
  /** When true, advertised services are not reported to discoverers (a host that is not there). */
  silent = false;
  readonly calls: string[] = [];
  readonly listeners = new Map<string, Set<AnyListener>>();
  readonly openListeners = new Map<string, number>();
  readonly connections = new Map<string, { peer: FakeLinkNative; peerId: string }>();
  readonly sent: { connectionId: string; data: string }[] = [];
  locks = false;
  advertising: string | null = null;
  discovering: string | null = null;

  constructor(
    private readonly net: FakeNetwork,
    readonly address: string,
  ) {}

  addListener<E extends EventName>(eventName: E, listener: IntercomLinkEvents[E]): { remove(): void } {
    const set = this.listeners.get(eventName) ?? new Set<AnyListener>();
    set.add(listener as AnyListener);
    this.listeners.set(eventName, set);
    return { remove: () => set.delete(listener as AnyListener) };
  }

  emit<E extends EventName>(eventName: E, event: Parameters<IntercomLinkEvents[E]>[0]) {
    setTimeout(() => {
      for (const listener of [...(this.listeners.get(eventName) ?? [])])
        (listener as (e: unknown) => void)(event);
    }, 0);
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  async isWifiConnected() {
    this.calls.push('isWifiConnected');
    return this.wifi;
  }

  async listInterfaces(): Promise<NativeNetworkInterface[]> {
    return [{ name: 'wlan0', kind: 'wifi', addresses: [this.address], up: true, multicast: true }];
  }

  async acquireLocks() {
    this.calls.push('acquireLocks');
    this.locks = true;
  }

  async releaseLocks() {
    this.calls.push('releaseLocks');
    this.locks = false;
  }

  async startAdvertising(options: {
    serviceType: string;
    pairId: string;
    serviceNamePrefix?: string;
    port: number;
  }) {
    this.calls.push(`startAdvertising:${options.serviceType}:${options.pairId}`);
    const listenerId = [...this.openListeners.entries()].find(([, port]) => port === options.port)?.[0];
    if (listenerId === undefined) throw Object.assign(new Error('no listener'), { code: 'ERR_LINK_NSD' });
    this.advertising = options.pairId;
    this.net.adverts.set(options.pairId, { phone: this, listenerId, port: options.port });
    if (!this.silent) this.net.announce(options.pairId);
    return { registeredName: `pn-${options.pairId}` };
  }

  async stopAdvertising() {
    this.calls.push('stopAdvertising');
    if (this.advertising !== null) this.net.adverts.delete(this.advertising);
    this.advertising = null;
  }

  async startDiscovery(options: { serviceType: string; pairId: string }) {
    this.calls.push(`startDiscovery:${options.serviceType}:${options.pairId}`);
    if (!this.wifi) throw Object.assign(new Error('no wifi'), { code: 'ERR_LINK_NOT_WIFI' });
    this.discovering = options.pairId;
    this.maybeReport(options.pairId);
  }

  async stopDiscovery() {
    this.calls.push('stopDiscovery');
    this.discovering = null;
  }

  maybeReport(pairId: string) {
    if (this.discovering !== pairId) return;
    const advert = this.net.adverts.get(pairId);
    if (!advert || advert.phone === this || advert.phone.silent) return;
    this.emit('onPeer', {
      kind: 'found',
      serviceName: `pn-${pairId}`,
      host: advert.phone.address,
      port: advert.port,
    });
  }

  async listen(options: { port: number }) {
    this.calls.push('listen');
    const listenerId = this.net.id('l');
    const port = options.port || this.net.port();
    this.openListeners.set(listenerId, port);
    return { listenerId, port, localAddress: this.address, interfaceName: 'wlan0' };
  }

  async stopListening(listenerId: string) {
    this.calls.push(`stopListening:${listenerId}`);
    this.openListeners.delete(listenerId);
  }

  connect(options: { host: string; port: number; timeoutMs: number }): Promise<NativeConnection> {
    this.calls.push(`connect:${options.host}:${options.port}:${options.timeoutMs > 0 ? 'timeout' : 'none'}`);
    if (this.connectHangs) return new Promise<NativeConnection>(() => undefined);
    if (this.connectError !== null) {
      return Promise.reject(Object.assign(new Error('refused'), { code: this.connectError }));
    }
    const advert = this.net.findListener(options.host, options.port);
    if (!advert || !advert.phone.openListeners.has(advert.listenerId)) {
      return Promise.reject(Object.assign(new Error('refused'), { code: 'ERR_LINK_CONNECT' }));
    }
    const mine = this.net.id('c');
    const theirs = this.net.id('c');
    this.connections.set(mine, { peer: advert.phone, peerId: theirs });
    advert.phone.connections.set(theirs, { peer: this, peerId: mine });
    advert.phone.emit('onAccept', {
      listenerId: advert.listenerId,
      connectionId: theirs,
      localAddress: advert.phone.address,
      remoteAddress: this.address,
      interfaceName: 'wlan0',
    });
    return Promise.resolve({
      connectionId: mine,
      localAddress: this.address,
      remoteAddress: options.host,
      interfaceName: 'wlan0',
    });
  }

  async send(connectionId: string, dataBase64: string) {
    const link = this.connections.get(connectionId);
    if (!link) throw Object.assign(new Error('unknown'), { code: 'ERR_LINK_UNKNOWN_CONNECTION' });
    this.sent.push({ connectionId, data: dataBase64 });
    link.peer.emit('onData', { connectionId: link.peerId, data: dataBase64 });
  }

  async close(connectionId: string) {
    this.calls.push(`close:${connectionId}`);
    const link = this.connections.get(connectionId);
    if (!link) return;
    this.connections.delete(connectionId);
    link.peer.connections.delete(link.peerId);
    this.emit('onClose', { connectionId, reason: 'local-close' });
    link.peer.emit('onClose', { connectionId: link.peerId, reason: 'remote-close' });
  }

  /** Simulates the native side losing the network under a connection. */
  dropConnection(connectionId: string) {
    const link = this.connections.get(connectionId);
    this.connections.delete(connectionId);
    if (link) link.peer.connections.delete(link.peerId);
    this.emit('onClose', { connectionId, reason: 'network-lost', detail: 'local address no longer present' });
  }

  async dispose() {
    this.calls.push('dispose');
    for (const id of [...this.connections.keys()]) await this.close(id);
    this.openListeners.clear();
    if (this.advertising !== null) this.net.adverts.delete(this.advertising);
    this.advertising = null;
    this.discovering = null;
    this.locks = false;
  }
}
