import type { Har, HarEntry } from './types.js';
import { sortedEntries } from './parser.js';

export type ResourceType =
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'font'
  | 'image'
  | 'xhr'
  | 'other';

export interface NormalizedEntry {
  index: number;
  url: string;
  hostname: string;
  method: string;
  status: number;
  mimeType: string;
  resourceType: ResourceType;
  startMs: number;
  endMs: number;
  durationMs: number;
  blockedMs: number;
  dnsMs: number;
  connectMs: number;
  sslMs: number;
  sendMs: number;
  waitMs: number;
  receiveMs: number;
  transferBytes: number;
  thirdParty: boolean;
  initiatorType?: string | undefined;
  initiatorUrl?: string | undefined;
  renderBlocking: boolean;
}

export interface ThirdPartyAttribution {
  hostname: string;
  requestCount: number;
  totalBytes: number;
  pctOfPageBytes: number;
  totalBlockingTimeMs: number;
  pctOfLoadTime: number;
}

export interface CriticalChainStep {
  url: string;
  hostname: string;
  resourceType: ResourceType;
  startMs: number;
  endMs: number;
  durationMs: number;
  reason: string;
}

export interface QueuedRequest {
  url: string;
  hostname: string;
  blockedMs: number;
  startMs: number;
}

export interface WaterfallReport {
  sourceLabel: string;
  pageUrl: string | undefined;
  primaryHostname: string;
  totalRequests: number;
  totalBytes: number;
  totalLoadTimeMs: number;
  domContentLoadedMs: number | undefined;
  onLoadMs: number | undefined;
  firstPaintEstimateMs: number;
  entries: NormalizedEntry[];
  thirdPartyAttribution: ThirdPartyAttribution[];
  criticalChain: CriticalChainStep[];
  queuedRequests: QueuedRequest[];
  explanation: string;
}

const nonNeg = (n: number | undefined): number => (typeof n === 'number' && n > 0 ? n : 0);

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown-host';
  }
}

function classifyResourceType(mimeType: string, url: string): ResourceType {
  const mt = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (mt === 'text/html') return 'document';
  if (mt === 'text/css') return 'stylesheet';
  if (mt.includes('javascript') || mt === 'application/json' && url.endsWith('.js')) return 'script';
  if (mt.startsWith('font/') || mt.includes('font-woff') || mt.includes('opentype')) return 'font';
  if (mt.startsWith('image/')) return 'image';
  if (mt === 'application/json' || mt.includes('xml') && !mt.includes('html')) return 'xhr';
  // Fall back to extension when the server sent a generic/missing content-type.
  const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? '';
  if (['css'].includes(ext)) return 'stylesheet';
  if (['js', 'mjs'].includes(ext)) return 'script';
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) return 'font';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'ico'].includes(ext)) return 'image';
  if (['html', 'htm'].includes(ext)) return 'document';
  return 'other';
}

/** content.mimeType is required by the HAR spec but hand-edited files omit or mistype it. */
function mimeTypeOf(entry: HarEntry): string {
  const mt: unknown = entry.response.content.mimeType;
  return typeof mt === 'string' ? mt : '';
}

function transferBytesOf(entry: HarEntry): number {
  const r = entry.response;
  if (typeof r._transferSize === 'number' && r._transferSize >= 0) return r._transferSize;
  const headers = nonNeg(r.headersSize);
  const body = nonNeg(r.bodySize) || nonNeg(r.content.size);
  return headers + body;
}

/**
 * Render-blocking heuristic (documented, not a browser-exact simulation — HAR
 * carries no async/defer/media attributes):
 *  - the navigation document itself always blocks first paint.
 *  - any text/css response blocks first paint (media-query gated stylesheets
 *    cannot be distinguished from HAR alone).
 *  - a script blocks first paint only when the DevTools `_initiator.type` is
 *    "parser" (a plain `<script src>` the HTML parser hit directly) — parser
 *    is synchronous by default, whereas scripts injected by other scripts
 *    (`_initiator.type === "script"`) are how async/defer loaders behave in
 *    practice, so they are treated as non-blocking.
 */
function isRenderBlocking(resourceType: ResourceType, initiatorType: string | undefined): boolean {
  if (resourceType === 'document') return true;
  if (resourceType === 'stylesheet') return true;
  if (resourceType === 'script') return initiatorType === 'parser';
  return false;
}

export function normalizeEntries(har: Har): { entries: NormalizedEntry[]; primaryHostname: string } {
  const sorted = sortedEntries(har);
  const first = sorted[0];
  if (!first) {
    return { entries: [], primaryHostname: 'unknown-host' };
  }
  const originMs = Date.parse(first.startedDateTime);

  const documentEntry =
    sorted.find((e) => classifyResourceType(mimeTypeOf(e), e.request.url) === 'document') ?? first;
  const primaryHostname = hostnameOf(documentEntry.request.url);

  const entries: NormalizedEntry[] = sorted.map((e, index) => {
    const startMs = Date.parse(e.startedDateTime) - originMs;
    const t = e.timings;
    const blockedMs = nonNeg(t.blocked);
    const dnsMs = nonNeg(t.dns);
    const connectMs = nonNeg(t.connect);
    const sslMs = nonNeg(t.ssl);
    const sendMs = nonNeg(t.send);
    const waitMs = nonNeg(t.wait);
    const receiveMs = nonNeg(t.receive);
    // e.time is the HAR-spec authoritative total; fall back to the component sum if absent.
    const durationMs =
      typeof e.time === 'number' && e.time >= 0
        ? e.time
        : blockedMs + dnsMs + connectMs + sslMs + sendMs + waitMs + receiveMs;
    const mimeType = mimeTypeOf(e) || 'application/octet-stream';
    const resourceType = classifyResourceType(mimeType, e.request.url);
    const hostname = hostnameOf(e.request.url);
    return {
      index,
      url: e.request.url,
      hostname,
      method: e.request.method,
      status: e.response.status,
      mimeType,
      resourceType,
      startMs,
      endMs: startMs + durationMs,
      durationMs,
      blockedMs,
      dnsMs,
      connectMs,
      sslMs,
      sendMs,
      waitMs,
      receiveMs,
      transferBytes: transferBytesOf(e),
      thirdParty: hostname !== primaryHostname,
      initiatorType: e._initiator?.type,
      initiatorUrl: e._initiator?.url,
      renderBlocking: isRenderBlocking(resourceType, e._initiator?.type),
    };
  });

  return { entries, primaryHostname };
}

export function attributeThirdPartyWeight(
  entries: NormalizedEntry[],
): { attribution: ThirdPartyAttribution[]; totalBytes: number; totalLoadTimeMs: number } {
  const totalBytes = entries.reduce((sum, e) => sum + e.transferBytes, 0);
  const totalLoadTimeMs = entries.reduce((max, e) => Math.max(max, e.endMs), 0);

  const byHost = new Map<string, { count: number; bytes: number; blockingMs: number }>();
  for (const e of entries) {
    if (!e.thirdParty) continue;
    const bucket = byHost.get(e.hostname) ?? { count: 0, bytes: 0, blockingMs: 0 };
    bucket.count += 1;
    bucket.bytes += e.transferBytes;
    if (e.renderBlocking) bucket.blockingMs += e.durationMs;
    byHost.set(e.hostname, bucket);
  }

  const attribution: ThirdPartyAttribution[] = [...byHost.entries()]
    .map(([hostname, v]) => ({
      hostname,
      requestCount: v.count,
      totalBytes: v.bytes,
      pctOfPageBytes: totalBytes > 0 ? (v.bytes / totalBytes) * 100 : 0,
      totalBlockingTimeMs: v.blockingMs,
      pctOfLoadTime: totalLoadTimeMs > 0 ? (v.blockingMs / totalLoadTimeMs) * 100 : 0,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  return { attribution, totalBytes, totalLoadTimeMs };
}

/** Requests that were queued behind the browser's per-host connection limit rather than the network itself. */
export function findQueuedRequests(entries: NormalizedEntry[], thresholdMs = 20): QueuedRequest[] {
  return entries
    .filter((e) => e.blockedMs >= thresholdMs && e.dnsMs === 0 && e.connectMs === 0 && e.sslMs === 0)
    .map((e) => ({ url: e.url, hostname: e.hostname, blockedMs: e.blockedMs, startMs: e.startMs }))
    .sort((a, b) => b.blockedMs - a.blockedMs);
}

function findInitiatorEntry(
  entry: NormalizedEntry,
  entries: NormalizedEntry[],
): NormalizedEntry | undefined {
  if (!entry.initiatorUrl) return undefined;
  // Among same-URL candidates that started before this entry, pick the latest one
  // (closest preceding request), matching how a real initiator resolves at runtime.
  let best: NormalizedEntry | undefined;
  for (const candidate of entries) {
    if (candidate.url !== entry.initiatorUrl) continue;
    if (candidate.startMs > entry.startMs) continue;
    if (!best || candidate.startMs > best.startMs) best = candidate;
  }
  return best;
}

export function buildCriticalChain(entries: NormalizedEntry[]): CriticalChainStep[] {
  const blocking = entries.filter((e) => e.renderBlocking);
  if (blocking.length === 0) return [];

  // The critical resource is whichever render-blocking response finishes last —
  // it is what actually gates first paint.
  const target = blocking.reduce((latest, e) => (e.endMs > latest.endMs ? e : latest));

  const chain: CriticalChainStep[] = [];
  const visited = new Set<number>();
  let current: NormalizedEntry | undefined = target;
  while (current && !visited.has(current.index)) {
    visited.add(current.index);
    const parent = findInitiatorEntry(current, entries);
    let reason: string;
    if (current.resourceType === 'document') {
      reason = 'navigation start';
    } else if (!parent) {
      reason =
        current.initiatorType === 'parser' || !current.initiatorType
          ? 'discovered by the HTML parser'
          : `discovered by ${current.initiatorType ?? 'an unknown initiator'}`;
    } else {
      reason = `requested while processing ${parent.url}`;
    }
    chain.unshift({
      url: current.url,
      hostname: current.hostname,
      resourceType: current.resourceType,
      startMs: current.startMs,
      endMs: current.endMs,
      durationMs: current.durationMs,
      reason,
    });
    current = parent;
  }
  return chain;
}

function fmt(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function buildExplanation(
  chain: CriticalChainStep[],
  firstPaintEstimateMs: number,
  queued: QueuedRequest[],
  thirdParty: ThirdPartyAttribution[],
): string {
  if (chain.length === 0) {
    return 'No render-blocking resources were found in this capture, so no critical chain could be determined.';
  }
  const lines: string[] = [];
  const steps = chain
    .map((s, i) => `${i + 1}. ${s.resourceType} ${s.url} (${s.reason}) finished at ${fmt(s.endMs)}`)
    .join('\n');
  lines.push(
    `First paint is estimated at ${fmt(firstPaintEstimateMs)}, gated by a chain of ${chain.length} render-blocking request${chain.length === 1 ? '' : 's'}:`,
  );
  lines.push(steps);

  const bottleneck = chain.reduce((_prev, step) => step);
  lines.push(
    `The longest pole is "${bottleneck.url}", which alone took ${fmt(bottleneck.durationMs)} and did not finish until ${fmt(bottleneck.endMs)}.`,
  );

  const worst = queued[0];
  if (worst) {
    lines.push(
      `${queued.length} request${queued.length === 1 ? '' : 's'} spent time queued behind the browser's per-host connection limit before they could even start; the worst, ${worst.url}, waited ${fmt(worst.blockedMs)}.`,
    );
  }

  const topThirdParty = thirdParty[0];
  if (topThirdParty) {
    lines.push(
      `The heaviest third-party origin is ${topThirdParty.hostname} at ${topThirdParty.pctOfPageBytes.toFixed(1)}% of total page weight across ${topThirdParty.requestCount} request${topThirdParty.requestCount === 1 ? '' : 's'}.`,
    );
  }

  return lines.join('\n');
}

export function analyzeHar(har: Har, sourceLabel: string): WaterfallReport {
  const { entries, primaryHostname } = normalizeEntries(har);
  const { attribution, totalBytes, totalLoadTimeMs } = attributeThirdPartyWeight(entries);
  const queuedRequests = findQueuedRequests(entries);
  const criticalChain = buildCriticalChain(entries);
  const lastChainStep = criticalChain[criticalChain.length - 1];
  const firstPaintEstimateMs = lastChainStep ? lastChainStep.endMs : totalLoadTimeMs;
  const explanation = buildExplanation(criticalChain, firstPaintEstimateMs, queuedRequests, attribution);

  const page = har.log.pages?.[0];

  return {
    sourceLabel,
    pageUrl: entries[0]?.url,
    primaryHostname,
    totalRequests: entries.length,
    totalBytes,
    totalLoadTimeMs,
    domContentLoadedMs: page?.pageTimings?.onContentLoad,
    onLoadMs: page?.pageTimings?.onLoad,
    firstPaintEstimateMs,
    entries,
    thirdPartyAttribution: attribution,
    criticalChain,
    queuedRequests,
    explanation,
  };
}
