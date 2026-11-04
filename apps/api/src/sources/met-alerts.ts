import { xmlParser } from './cap';
import { RateLimitedError, type AlertSource, type FeedItem, type FeedResult, type HttpFetch, type SourceStateRow } from './types';

type Node = Record<string, unknown>;

/**
 * MET MetAlerts 2.0. The RSS list is polled at most every 10 minutes and never before
 * Expires; each CAP file is fetched once (CAP files never change after issue). The beta
 * GeoJSON output is deliberately not used.
 */
export class MetAlertsSource implements AlertSource {
  readonly key = 'met' as const;
  readonly enabled: boolean;
  readonly disabledReason?: string;

  constructor(
    private readonly opts: { userAgent: string | undefined; listUrl: string; pollIntervalSec: number; fetch?: HttpFetch },
  ) {
    this.enabled = !!opts.userAgent;
    if (!this.enabled) this.disabledReason = 'MET_USER_AGENT is not set; MET is never called without it';
  }

  get pollIntervalSec() {
    return this.opts.pollIntervalSec;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.opts.userAgent) throw new Error(this.disabledReason);
    return { 'user-agent': this.opts.userAgent, ...extra };
  }

  private get http(): HttpFetch {
    return this.opts.fetch ?? fetch;
  }

  async list(state: SourceStateRow): Promise<FeedResult> {
    const res = await this.http(this.opts.listUrl, {
      headers: this.headers(state.last_modified ? { 'if-modified-since': state.last_modified } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const expiresAt = parseHttpDate(res.headers.get('expires'));
    if (res.status === 429) throw new RateLimitedError(Number(res.headers.get('retry-after')) || null);
    if (res.status === 304) return { notModified: true, items: [], lastModified: state.last_modified, expiresAt };
    if (!res.ok) throw new Error(`MET list HTTP ${res.status}`);
    const xml = await res.text();
    return { notModified: false, items: parseMetRss(xml), lastModified: res.headers.get('last-modified'), expiresAt };
  }

  async fetchCap(item: FeedItem): Promise<string> {
    if (!item.url) throw new Error('feed item without link');
    const res = await this.http(item.url, { headers: this.headers(), signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw new RateLimitedError(Number(res.headers.get('retry-after')) || null);
    if (!res.ok) throw new Error(`MET CAP HTTP ${res.status}`);
    return res.text();
  }
}

export function parseMetRss(xml: string): FeedItem[] {
  const doc = xmlParser.parse(xml) as Node;
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  const items = (channel?.item as Node[] | undefined) ?? [];
  return items
    .map((it) => {
      const guid = it.guid;
      const id = typeof guid === 'object' && guid ? String((guid as Node)['#text'] ?? '') : String(guid ?? '');
      const link = it.link ? String(it.link) : null;
      return { sourceId: id || link || '', url: link };
    })
    .filter((i) => i.sourceId);
}

function parseHttpDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
