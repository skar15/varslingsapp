import { xmlParser } from './cap';
import type { AlertSource, FeedItem, FeedResult, HttpFetch } from './types';

type Node = Record<string, unknown>;

/**
 * NVE flood and landslide warnings (CAP). The feed lists warnings for a date range;
 * each CAP is fetched by id. NVE's API version and payload shape must be confirmed
 * against real responses (docs/decisions/006-nve-payloads-unverified.md): the parser
 * accepts a JSON list of ids, an Atom/RSS feed, or inline CAP alerts.
 */
export class NveSource implements AlertSource {
  readonly enabled: boolean;
  constructor(
    readonly key: 'nve-flood' | 'nve-landslide',
    private readonly opts: { baseUrl: string; pollIntervalSec: number; enabled: boolean; fetch?: HttpFetch },
  ) {
    this.enabled = opts.enabled;
  }

  get pollIntervalSec() {
    return this.opts.pollIntervalSec;
  }

  private get http(): HttpFetch {
    return this.opts.fetch ?? fetch;
  }

  async list(_state: unknown, now: Date): Promise<FeedResult> {
    const start = ymd(new Date(now.getTime() - 86_400_000));
    const end = ymd(new Date(now.getTime() + 3 * 86_400_000));
    const res = await this.http(`${this.opts.baseUrl}/Cap/Feed/${start}/${end}`, {
      headers: { accept: 'application/json, application/xml;q=0.9' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`NVE feed HTTP ${res.status}`);
    const body = await res.text();
    return { notModified: false, items: parseNveFeed(body, this.opts.baseUrl) };
  }

  async fetchCap(item: FeedItem): Promise<string> {
    if (item.inlineXml) return item.inlineXml;
    const url = item.url ?? `${this.opts.baseUrl}/Cap/Id/${encodeURIComponent(item.sourceId)}`;
    const res = await this.http(url, { headers: { accept: 'application/xml' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`NVE CAP HTTP ${res.status}`);
    const text = await res.text();
    // Some endpoints wrap the XML in a JSON string.
    return text.trim().startsWith('"') ? (JSON.parse(text) as string) : text;
  }
}

export function parseNveFeed(body: string, baseUrl: string): FeedItem[] {
  const trimmed = body.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(json) ? json : ((json as Node).items ?? (json as Node).Items ?? (json as Node).alerts ?? []);
    return (list as unknown[])
      .map((x) => {
        if (typeof x === 'string' || typeof x === 'number') return String(x);
        const o = x as Node;
        return String(o.Id ?? o.id ?? o.CapId ?? o.capId ?? o.Identifier ?? o.identifier ?? '');
      })
      .filter(Boolean)
      .map((id) => ({ sourceId: id, url: `${baseUrl}/Cap/Id/${encodeURIComponent(id)}` }));
  }
  const doc = xmlParser.parse(trimmed) as Node;
  // Inline CAP alerts (a list of <alert> elements under any root).
  const roots = Object.values(doc).filter((v) => v && typeof v === 'object') as Node[];
  const inline: FeedItem[] = [];
  for (const root of [doc, ...roots]) {
    for (const a of (root.alert as Node[] | undefined) ?? []) {
      const id = String(a.identifier ?? '');
      if (id) inline.push({ sourceId: id, url: null, inlineXml: rebuildAlert(trimmed, id) });
    }
  }
  if (inline.length) return inline;
  const feed = (doc.feed as Node | undefined) ?? ((doc.rss as Node | undefined)?.channel as Node | undefined);
  const entries = ((feed?.entry ?? feed?.item) as Node[] | undefined) ?? [];
  return entries
    .map((e) => {
      const link = e.link;
      const href = typeof link === 'object' && link ? String((link as Node)['@_href'] ?? (link as Node)['#text'] ?? '') : link ? String(link) : '';
      const id = String((e.id as string | undefined) ?? (typeof e.guid === 'object' ? (e.guid as Node)['#text'] : e.guid) ?? href);
      return { sourceId: id, url: href || `${baseUrl}/Cap/Id/${encodeURIComponent(id)}` };
    })
    .filter((i) => i.sourceId);
}

/** Extracts one <alert>…</alert> block containing the identifier from a multi-alert document. */
function rebuildAlert(xml: string, identifier: string): string {
  const re = /<(\w+:)?alert\b[\s\S]*?<\/(\w+:)?alert>/g;
  for (const m of xml.matchAll(re)) if (m[0].includes(`>${identifier}<`)) return m[0];
  return xml;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
