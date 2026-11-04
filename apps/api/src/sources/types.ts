export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SourceStateRow {
  last_modified: string | null;
  next_poll_after: Date | null;
}

export interface FeedItem {
  /** Stable id of the feed item; stored as source_alerts.source_id. */
  sourceId: string;
  url: string | null;
  /** Some feeds embed the CAP document; then no second request is made. */
  inlineXml?: string;
}

export interface FeedResult {
  notModified: boolean;
  items: FeedItem[];
  lastModified?: string | null;
  /** From the Expires header: never poll before this (MET terms, D10). */
  expiresAt?: Date | null;
}

export class RateLimitedError extends Error {
  constructor(public readonly retryAfterSec: number | null) {
    super('rate limited by source');
  }
}

/** Every external warning source sits behind this interface (architecture rule 2). */
export interface AlertSource {
  readonly key: 'met' | 'nve-flood' | 'nve-landslide';
  readonly pollIntervalSec: number;
  /** False when required configuration (MET_USER_AGENT) is missing; the poller then refuses to call it. */
  readonly enabled: boolean;
  readonly disabledReason?: string;
  list(state: SourceStateRow, now: Date): Promise<FeedResult>;
  fetchCap(item: FeedItem): Promise<string>;
}
