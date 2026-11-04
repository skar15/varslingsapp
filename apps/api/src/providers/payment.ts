import Stripe from 'stripe';

export type BillingEvent =
  | { id: string; type: 'checkout.completed'; sessionId: string; customerId: string | null; subscriptionId: string | null; email: string | null; planKey: string | null; claimEnc: string | null }
  | { id: string; type: 'subscription.updated'; subscriptionId: string; priceId: string | null; status: string; cancelAtPeriodEnd: boolean }
  | { id: string; type: 'subscription.deleted'; subscriptionId: string }
  | { id: string; type: 'invoice.payment_failed'; subscriptionId: string | null }
  | { id: string; type: 'invoice.paid'; subscriptionId: string | null }
  | { id: string; type: 'ignored'; rawType: string };

export interface PaymentProvider {
  createCheckoutSession(p: { priceId: string; planKey: string; successUrl: string; cancelUrl: string; locale: 'nb' | 'en'; metadata: Record<string, string> }): Promise<{ url: string; id: string }>;
  createPortalSession(p: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  changePlan(p: { subscriptionId: string; priceId: string }): Promise<void>;
  cancelSubscription(p: { subscriptionId: string; immediately: boolean }): Promise<void>;
  /** Verifies the signature and normalises the event. Throws on an invalid signature. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent;
}

export class StripePaymentProvider implements PaymentProvider {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) {
    this.stripe = new Stripe(secretKey);
  }

  async createCheckoutSession(p: { priceId: string; planKey: string; successUrl: string; cancelUrl: string; locale: 'nb' | 'en'; metadata: Record<string, string> }) {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: p.priceId, quantity: 1 }],
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      locale: p.locale === 'en' ? 'en' : 'nb',
      metadata: p.metadata,
      subscription_data: { metadata: { plan_key: p.planKey } },
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
    });
    if (!session.url) throw new Error('stripe returned no checkout url');
    return { url: session.url, id: session.id };
  }

  async createPortalSession(p: { customerId: string; returnUrl: string }) {
    const s = await this.stripe.billingPortal.sessions.create({ customer: p.customerId, return_url: p.returnUrl });
    return { url: s.url };
  }

  async changePlan(p: { subscriptionId: string; priceId: string }) {
    const sub = await this.stripe.subscriptions.retrieve(p.subscriptionId);
    const item = sub.items.data[0];
    if (!item) throw new Error('subscription has no items');
    await this.stripe.subscriptions.update(p.subscriptionId, { items: [{ id: item.id, price: p.priceId }], proration_behavior: 'create_prorations' });
  }

  async cancelSubscription(p: { subscriptionId: string; immediately: boolean }) {
    if (p.immediately) await this.stripe.subscriptions.cancel(p.subscriptionId);
    else await this.stripe.subscriptions.update(p.subscriptionId, { cancel_at_period_end: true });
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (!signature) throw new Error('missing signature');
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const obj = event.data.object as unknown as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null);
    switch (event.type) {
      case 'checkout.session.completed': {
        const md = (obj.metadata ?? {}) as Record<string, string>;
        const details = (obj.customer_details ?? {}) as { email?: string };
        return { id: event.id, type: 'checkout.completed', sessionId: String(obj.id), customerId: str(obj.customer), subscriptionId: str(obj.subscription), email: details.email ?? null, planKey: md.plan_key ?? null, claimEnc: md.claim ?? null };
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const items = (obj.items as { data?: { price?: { id?: string } }[] } | undefined)?.data ?? [];
        return { id: event.id, type: 'subscription.updated', subscriptionId: String(obj.id), priceId: items[0]?.price?.id ?? null, status: String(obj.status), cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end) };
      }
      case 'customer.subscription.deleted':
        return { id: event.id, type: 'subscription.deleted', subscriptionId: String(obj.id) };
      case 'invoice.payment_failed':
        return { id: event.id, type: 'invoice.payment_failed', subscriptionId: invoiceSubscription(obj) };
      case 'invoice.paid':
        return { id: event.id, type: 'invoice.paid', subscriptionId: invoiceSubscription(obj) };
      default:
        return { id: event.id, type: 'ignored', rawType: event.type };
    }
  }
}

function invoiceSubscription(obj: Record<string, unknown>): string | null {
  // Newer API versions moved the subscription under parent.subscription_details.
  const parent = obj.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const v = obj.subscription ?? parent?.subscription_details?.subscription;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'id' in v) return String((v as { id: unknown }).id);
  return null;
}

/** Test fake: the webhook body is a BillingEvent as JSON and the signature must be "fake-valid". */
export class FakePaymentProvider implements PaymentProvider {
  sessions: { id: string; priceId: string; metadata: Record<string, string>; successUrl: string }[] = [];
  canceled: { subscriptionId: string; immediately: boolean }[] = [];
  planChanges: { subscriptionId: string; priceId: string }[] = [];
  private seq = 0;

  async createCheckoutSession(p: { priceId: string; planKey: string; successUrl: string; cancelUrl: string; locale: 'nb' | 'en'; metadata: Record<string, string> }) {
    const id = `cs_test_${++this.seq}`;
    this.sessions.push({ id, priceId: p.priceId, metadata: p.metadata, successUrl: p.successUrl });
    return { id, url: `https://checkout.stripe.test/${id}` };
  }
  async createPortalSession(p: { customerId: string }) {
    return { url: `https://billing.stripe.test/${p.customerId}` };
  }
  async changePlan(p: { subscriptionId: string; priceId: string }) {
    this.planChanges.push(p);
  }
  async cancelSubscription(p: { subscriptionId: string; immediately: boolean }) {
    this.canceled.push(p);
  }
  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingEvent {
    if (signature !== 'fake-valid') throw new Error('invalid signature');
    return JSON.parse(rawBody.toString('utf8')) as BillingEvent;
  }
}
