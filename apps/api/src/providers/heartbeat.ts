/** Pinged after each successful poll, so a dead worker also raises the alarm externally. */
export interface Heartbeat {
  ping(source: string): Promise<void>;
}

export class HttpHeartbeat implements Heartbeat {
  constructor(private readonly url: string) {}
  async ping(source: string): Promise<void> {
    const u = new URL(this.url);
    u.searchParams.set('source', source);
    await fetch(u, { signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }
}

export class FakeHeartbeat implements Heartbeat {
  pings: string[] = [];
  async ping(source: string) {
    this.pings.push(source);
  }
}
