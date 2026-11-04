import { createHmac, timingSafeEqual } from 'node:crypto';

export type SmsDeliveryState = 'sent' | 'delivered' | 'failed';

export interface SmsProvider {
  send(to: string, body: string, opts?: { statusCallbackUrl?: string }): Promise<{ id: string }>;
  /** Validates and parses a delivery-report webhook. Returns null when the signature is invalid. */
  parseDeliveryReport(url: string, params: Record<string, string>, signature: string | undefined): { id: string; state: SmsDeliveryState; error?: string } | null;
}

/** Twilio Programmable Messaging over its REST API. */
export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly accountSid: string, private readonly authToken: string, private readonly from: string) {}

  async send(to: string, body: string, opts?: { statusCallbackUrl?: string }): Promise<{ id: string }> {
    const form = new URLSearchParams({ To: to, From: this.from, Body: body });
    if (opts?.statusCallbackUrl) form.set('StatusCallback', opts.statusCallbackUrl);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok || !json.sid) throw new Error(`twilio send failed: HTTP ${res.status} code ${json.code ?? '-'}`);
    return { id: json.sid };
  }

  parseDeliveryReport(url: string, params: Record<string, string>, signature: string | undefined) {
    if (!signature) return null;
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = createHmac('sha1', this.authToken).update(data).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const id = params.MessageSid;
    if (!id) return null;
    const status = params.MessageStatus ?? '';
    const state: SmsDeliveryState = status === 'delivered' ? 'delivered' : ['failed', 'undelivered'].includes(status) ? 'failed' : 'sent';
    return { id, state, error: params.ErrorCode };
  }
}

export class FakeSmsProvider implements SmsProvider {
  sent: { to: string; body: string; id: string }[] = [];
  failAll = false;
  private seq = 0;

  async send(to: string, body: string): Promise<{ id: string }> {
    if (this.failAll) throw new Error('sms provider unavailable');
    const id = `sms-${++this.seq}`;
    this.sent.push({ to, body, id });
    return { id };
  }

  parseDeliveryReport(_url: string, params: Record<string, string>, signature: string | undefined) {
    if (signature !== 'fake-valid' || !params.MessageSid) return null;
    const status = params.MessageStatus;
    return { id: params.MessageSid, state: (status === 'delivered' ? 'delivered' : status === 'failed' ? 'failed' : 'sent') as SmsDeliveryState };
  }
}
