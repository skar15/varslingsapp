export interface EmailProvider {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Resend HTTP API. Invites and account-claim links only; Stripe sends receipts. */
export class ResendEmailProvider implements EmailProvider {
  constructor(private readonly apiKey: string, private readonly from: string) {}
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) throw new Error(`email send failed: HTTP ${res.status}`);
  }
}

export class FakeEmailProvider implements EmailProvider {
  sent: { to: string; subject: string; text: string }[] = [];
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push(msg);
  }
}
