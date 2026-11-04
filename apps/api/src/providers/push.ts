export type PushChannelId = 'alert-red' | 'alert-yellow' | 'alert-info';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId: PushChannelId;
  /** Notification category with the "Mottatt" action button. */
  categoryId?: 'alert' | 'status-extend';
  interruptionLevel?: 'active' | 'time-sensitive' | 'critical';
  critical?: boolean;
  priority: 'high' | 'default';
}

export interface PushTicket {
  ok: boolean;
  id?: string;
  /** Expo error code, e.g. DeviceNotRegistered. */
  error?: string;
}

export interface PushReceipt {
  id: string;
  ok: boolean;
  error?: string;
}

export interface PushProvider {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(ticketIds: string[]): Promise<PushReceipt[]>;
}

/** Expo Push Service. https://docs.expo.dev/push-notifications/sending-notifications/ */
export class ExpoPushProvider implements PushProvider {
  constructor(private readonly accessToken?: string, private readonly baseUrl = 'https://exp.host/--/api/v2/push') {}

  private headers(): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100).map((m) => ({
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data,
        channelId: m.channelId,
        categoryId: m.categoryId,
        priority: m.priority,
        interruptionLevel: m.interruptionLevel,
        sound: m.critical ? { critical: true, name: 'default', volume: 1 } : 'default',
      }));
      const res = await fetch(`${this.baseUrl}/send`, { method: 'POST', headers: this.headers(), body: JSON.stringify(chunk) });
      if (!res.ok) throw new Error(`expo push send failed: HTTP ${res.status}`);
      const json = (await res.json()) as { data: { status: string; id?: string; message?: string; details?: { error?: string } }[] };
      for (const t of json.data) tickets.push(t.status === 'ok' ? { ok: true, id: t.id } : { ok: false, error: t.details?.error ?? 'error' });
    }
    return tickets;
  }

  async receipts(ticketIds: string[]): Promise<PushReceipt[]> {
    const out: PushReceipt[] = [];
    for (let i = 0; i < ticketIds.length; i += 300) {
      const ids = ticketIds.slice(i, i + 300);
      const res = await fetch(`${this.baseUrl}/getReceipts`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error(`expo receipts failed: HTTP ${res.status}`);
      const json = (await res.json()) as { data: Record<string, { status: string; details?: { error?: string } }> };
      for (const [id, r] of Object.entries(json.data)) out.push({ id, ok: r.status === 'ok', error: r.details?.error });
    }
    return out;
  }
}

export class FakePushProvider implements PushProvider {
  sent: PushMessage[] = [];
  /** Tokens that return DeviceNotRegistered at send time. */
  unregistered = new Set<string>();
  /** Ticket ids that return DeviceNotRegistered in receipts. */
  failingReceipts = new Set<string>();
  failAll = false;
  private seq = 0;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failAll) throw new Error('push provider unavailable');
    return messages.map((m) => {
      this.sent.push(m);
      if (this.unregistered.has(m.to)) return { ok: false, error: 'DeviceNotRegistered' };
      return { ok: true, id: `ticket-${++this.seq}` };
    });
  }

  async receipts(ticketIds: string[]): Promise<PushReceipt[]> {
    return ticketIds.map((id) => (this.failingReceipts.has(id) ? { id, ok: false, error: 'DeviceNotRegistered' } : { id, ok: true }));
  }
}
