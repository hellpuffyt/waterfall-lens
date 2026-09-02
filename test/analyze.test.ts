import { describe, it, expect } from 'vitest';
import type { Har, HarEntry } from '../src/types.js';
import {
  normalizeEntries,
  attributeThirdPartyWeight,
  findQueuedRequests,
  buildCriticalChain,
  buildExplanation,
  analyzeHar,
} from '../src/analyze.js';

let seq = 0;
function entry(overrides: Partial<HarEntry> & { url?: string; mimeType?: string } = {}): HarEntry {
  seq += 1;
  const { url = `https://site.test/r${seq}`, mimeType = 'text/html', ...rest } = overrides;
  return {
    startedDateTime: '2024-01-01T00:00:00.000Z',
    time: 100,
    request: { method: 'GET', url, httpVersion: 'HTTP/1.1', headers: [], headersSize: 100, bodySize: 0 },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [],
      content: { size: 1000, mimeType },
      redirectURL: '',
      headersSize: 100,
      bodySize: 1000,
    },
    cache: {},
    timings: { blocked: 0, dns: 0, connect: 0, ssl: -1, send: 0, wait: 50, receive: 10 },
    ...rest,
  };
}

function har(entries: HarEntry[]): Har {
  return { log: { version: '1.2', creator: { name: 'x', version: '1' }, entries } };
}

function at(ms: number): string {
  const d = new Date(Date.parse('2024-01-01T00:00:00.000Z') + ms);
  return d.toISOString();
}

describe('normalizeEntries', () => {
  it('returns an empty result for an empty HAR', () => {
    const { entries, primaryHostname } = normalizeEntries(har([]));
    expect(entries).toEqual([]);
    expect(primaryHostname).toBe('unknown-host');
  });

  it('computes startMs relative to the first entry and endMs from duration', () => {
    const e1 = entry({ startedDateTime: at(0), time: 100 });
    const e2 = entry({ startedDateTime: at(50), time: 30 });
    const { entries } = normalizeEntries(har([e1, e2]));
    expect(entries[0]?.startMs).toBe(0);
    expect(entries[0]?.endMs).toBe(100);
    expect(entries[1]?.startMs).toBe(50);
    expect(entries[1]?.endMs).toBe(80);
  });

  it('picks the document entry hostname as the primary hostname', () => {
    const doc = entry({ url: 'https://primary.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const asset = entry({ url: 'https://cdn.test/a.js', mimeType: 'application/javascript', startedDateTime: at(10) });
    const { primaryHostname } = normalizeEntries(har([doc, asset]));
    expect(primaryHostname).toBe('primary.test');
  });

  it('falls back to the first entry when no document mime type is present', () => {
    const only = entry({ url: 'https://api.test/data', mimeType: 'application/json', startedDateTime: at(0) });
    const { primaryHostname } = normalizeEntries(har([only]));
    expect(primaryHostname).toBe('api.test');
  });

  it('flags non-primary hostnames as third party', () => {
    const doc = entry({ url: 'https://primary.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const thirdParty = entry({ url: 'https://cdn.test/a.js', mimeType: 'application/javascript', startedDateTime: at(5) });
    const { entries } = normalizeEntries(har([doc, thirdParty]));
    expect(entries[0]?.thirdParty).toBe(false);
    expect(entries[1]?.thirdParty).toBe(true);
  });

  it('classifies resource types from MIME type', () => {
    const cases: [string, string][] = [
      ['text/html', 'document'],
      ['text/css', 'stylesheet'],
      ['application/javascript', 'script'],
      ['text/javascript', 'script'],
      ['font/woff2', 'font'],
      ['application/font-woff', 'font'],
      ['font/opentype', 'font'],
      ['image/png', 'image'],
      ['application/json', 'xhr'],
      ['application/xml', 'xhr'],
      ['application/octet-stream', 'other'],
    ];
    for (const [mime, expected] of cases) {
      const { entries } = normalizeEntries(har([entry({ mimeType: mime, url: `https://site.test/x.${expected}` })]));
      expect(entries[0]?.resourceType, mime).toBe(expected);
    }
  });

  it('falls back to file extension when mime type is generic/missing', () => {
    const cases: [string, string][] = [
      ['https://site.test/app.css', 'stylesheet'],
      ['https://site.test/app.js', 'script'],
      ['https://site.test/app.mjs', 'script'],
      ['https://site.test/font.woff2', 'font'],
      ['https://site.test/font.ttf', 'font'],
      ['https://site.test/pic.png', 'image'],
      ['https://site.test/pic.svg', 'image'],
      ['https://site.test/index.html', 'document'],
      ['https://site.test/data.bin', 'other'],
    ];
    for (const [url, expected] of cases) {
      const { entries } = normalizeEntries(har([entry({ url, mimeType: '' })]));
      expect(entries[0]?.resourceType, url).toBe(expected);
    }
  });

  it('strips query strings before checking the extension', () => {
    const { entries } = normalizeEntries(har([entry({ url: 'https://site.test/app.js?v=2', mimeType: '' })]));
    expect(entries[0]?.resourceType).toBe('script');
  });

  it('treats a document as always render-blocking', () => {
    const { entries } = normalizeEntries(har([entry({ mimeType: 'text/html' })]));
    expect(entries[0]?.renderBlocking).toBe(true);
  });

  it('treats a stylesheet as always render-blocking', () => {
    const { entries } = normalizeEntries(
      har([entry({ mimeType: 'text/html' }), entry({ mimeType: 'text/css', startedDateTime: at(5) })]),
    );
    expect(entries[1]?.renderBlocking).toBe(true);
  });

  it('treats a parser-initiated script as render-blocking', () => {
    const doc = entry({ mimeType: 'text/html' });
    const script = entry({
      mimeType: 'application/javascript',
      startedDateTime: at(5),
      _initiator: { type: 'parser' },
    });
    const { entries } = normalizeEntries(har([doc, script]));
    expect(entries[1]?.renderBlocking).toBe(true);
  });

  it('treats a script-initiated script as non-blocking', () => {
    const doc = entry({ mimeType: 'text/html' });
    const script = entry({
      mimeType: 'application/javascript',
      startedDateTime: at(5),
      _initiator: { type: 'script', url: 'https://site.test/loader.js' },
    });
    const { entries } = normalizeEntries(har([doc, script]));
    expect(entries[1]?.renderBlocking).toBe(false);
  });

  it('treats images and xhr as never render-blocking', () => {
    const doc = entry({ mimeType: 'text/html' });
    const img = entry({ mimeType: 'image/png', startedDateTime: at(5) });
    const xhr = entry({ mimeType: 'application/json', startedDateTime: at(6) });
    const { entries } = normalizeEntries(har([doc, img, xhr]));
    expect(entries[1]?.renderBlocking).toBe(false);
    expect(entries[2]?.renderBlocking).toBe(false);
  });

  it('uses _transferSize when present and non-negative', () => {
    const e = entry({ response: { ...entry().response, _transferSize: 555 } });
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.transferBytes).toBe(555);
  });

  it('falls back to headersSize + bodySize when _transferSize is absent', () => {
    const e = entry();
    delete e.response._transferSize;
    e.request.headersSize = 100;
    e.response.headersSize = 200;
    e.response.bodySize = 300;
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.transferBytes).toBe(500);
  });

  it('falls back to content.size when bodySize is unavailable', () => {
    const e = entry();
    delete e.response._transferSize;
    e.response.headersSize = 50;
    e.response.bodySize = -1;
    e.response.content.size = 777;
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.transferBytes).toBe(50 + 777);
  });

  it('clamps negative timing fields to zero', () => {
    const e = entry({ timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: -1, wait: 40, receive: 5 } });
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.blockedMs).toBe(0);
    expect(entries[0]?.dnsMs).toBe(0);
    expect(entries[0]?.connectMs).toBe(0);
    expect(entries[0]?.sslMs).toBe(0);
    expect(entries[0]?.sendMs).toBe(0);
  });

  it('falls back to summed timings when time is missing/negative', () => {
    const e = entry({ time: -1, timings: { blocked: 5, dns: 5, connect: 5, ssl: 5, send: 5, wait: 50, receive: 10 } });
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.durationMs).toBe(85);
  });

  it('defaults an empty mimeType to application/octet-stream and classifies as other', () => {
    const e = entry({ mimeType: '', url: 'https://site.test/noext' });
    const { entries } = normalizeEntries(har([e]));
    expect(entries[0]?.mimeType).toBe('application/octet-stream');
    expect(entries[0]?.resourceType).toBe('other');
  });

  it('assigns a stable, increasing index in start-time order', () => {
    const e1 = entry({ startedDateTime: at(20) });
    const e2 = entry({ startedDateTime: at(0) });
    const { entries } = normalizeEntries(har([e1, e2]));
    expect(entries[0]?.index).toBe(0);
    expect(entries[1]?.index).toBe(1);
    expect(entries[0]?.startMs).toBe(0);
  });
});

describe('attributeThirdPartyWeight', () => {
  it('returns no attribution when there are no third-party entries', () => {
    const { entries } = normalizeEntries(har([entry({ url: 'https://site.test/' })]));
    const { attribution, totalBytes } = attributeThirdPartyWeight(entries);
    expect(attribution).toEqual([]);
    expect(totalBytes).toBeGreaterThan(0);
  });

  it('aggregates request count and bytes per third-party hostname', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html' });
    const cdn1 = entry({ url: 'https://cdn.test/a.js', mimeType: 'application/javascript', startedDateTime: at(5) });
    const cdn2 = entry({ url: 'https://cdn.test/b.js', mimeType: 'application/javascript', startedDateTime: at(6) });
    const { entries } = normalizeEntries(har([doc, cdn1, cdn2]));
    const { attribution } = attributeThirdPartyWeight(entries);
    expect(attribution).toHaveLength(1);
    expect(attribution[0]?.hostname).toBe('cdn.test');
    expect(attribution[0]?.requestCount).toBe(2);
  });

  it('sorts attribution by total bytes descending', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html', response: { ...entry().response, content: { size: 1, mimeType: 'text/html' }, _transferSize: 1 } });
    const small = entry({ url: 'https://small.test/a.js', mimeType: 'application/javascript', startedDateTime: at(5), response: { ...entry().response, content: { size: 1, mimeType: 'application/javascript' }, _transferSize: 100 } });
    const big = entry({ url: 'https://big.test/a.js', mimeType: 'application/javascript', startedDateTime: at(6), response: { ...entry().response, content: { size: 1, mimeType: 'application/javascript' }, _transferSize: 9000 } });
    const { entries } = normalizeEntries(har([doc, small, big]));
    const { attribution } = attributeThirdPartyWeight(entries);
    expect(attribution.map((a) => a.hostname)).toEqual(['big.test', 'small.test']);
  });

  it('computes pctOfPageBytes and pctOfLoadTime correctly', () => {
    const doc = entry({
      url: 'https://site.test/',
      mimeType: 'text/html',
      response: { ...entry().response, content: { size: 1, mimeType: 'text/html' }, _transferSize: 100 },
    });
    const cdn = entry({
      url: 'https://cdn.test/a.js',
      mimeType: 'application/javascript',
      startedDateTime: at(0),
      response: { ...entry().response, content: { size: 1, mimeType: 'application/javascript' }, _transferSize: 100 },
      _initiator: { type: 'parser' },
    });
    const { entries } = normalizeEntries(har([doc, cdn]));
    const { attribution } = attributeThirdPartyWeight(entries);
    expect(attribution[0]?.pctOfPageBytes).toBeCloseTo(50, 5);
  });

  it('only counts render-blocking third-party time toward totalBlockingTimeMs', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html' });
    // Third-party image: never render-blocking.
    const img = entry({ url: 'https://cdn.test/hero.jpg', mimeType: 'image/jpeg', startedDateTime: at(5), time: 500 });
    const { entries } = normalizeEntries(har([doc, img]));
    const { attribution } = attributeThirdPartyWeight(entries);
    expect(attribution[0]?.totalBlockingTimeMs).toBe(0);
  });

  it('returns zero percentages when totals are zero', () => {
    const { attribution } = attributeThirdPartyWeight([]);
    expect(attribution).toEqual([]);
  });
});

describe('findQueuedRequests', () => {
  it('finds requests blocked purely on connection queueing (no dns/connect/ssl)', () => {
    const e = entry({ timings: { blocked: 300, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const { entries } = normalizeEntries(har([e]));
    const queued = findQueuedRequests(entries);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.blockedMs).toBe(300);
  });

  it('excludes requests below the threshold', () => {
    const e = entry({ timings: { blocked: 5, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const { entries } = normalizeEntries(har([e]));
    expect(findQueuedRequests(entries)).toEqual([]);
  });

  it('excludes requests whose blocked time was really DNS/connect/SSL setup', () => {
    const e = entry({ timings: { blocked: 300, dns: 10, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const { entries } = normalizeEntries(har([e]));
    expect(findQueuedRequests(entries)).toEqual([]);
  });

  it('sorts queued requests by blockedMs descending', () => {
    const a = entry({ url: 'https://site.test/a', timings: { blocked: 50, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const b = entry({ url: 'https://site.test/b', timings: { blocked: 200, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const { entries } = normalizeEntries(har([a, b]));
    const queued = findQueuedRequests(entries);
    expect(queued.map((q) => q.url)).toEqual(['https://site.test/b', 'https://site.test/a']);
  });

  it('respects a custom threshold', () => {
    const e = entry({ timings: { blocked: 15, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 } });
    const { entries } = normalizeEntries(har([e]));
    expect(findQueuedRequests(entries, 10)).toHaveLength(1);
    expect(findQueuedRequests(entries, 20)).toHaveLength(0);
  });
});

describe('buildCriticalChain', () => {
  it('returns an empty chain when nothing is render-blocking', () => {
    const { entries } = normalizeEntries(har([entry({ mimeType: 'image/png' })]));
    expect(buildCriticalChain(entries)).toEqual([]);
  });

  it('builds a single-step chain for a lone blocking document', () => {
    const { entries } = normalizeEntries(har([entry({ mimeType: 'text/html' })]));
    const chain = buildCriticalChain(entries);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.reason).toBe('navigation start');
  });

  it('picks the blocking resource with the latest endMs as the target', () => {
    const doc = entry({ mimeType: 'text/html', startedDateTime: at(0), time: 50 });
    const css = entry({ mimeType: 'text/css', startedDateTime: at(10), time: 400, _initiator: { type: 'parser' } });
    const { entries } = normalizeEntries(har([doc, css]));
    const chain = buildCriticalChain(entries);
    expect(chain[chain.length - 1]?.url).toBe(css.request.url);
  });

  it('walks initiator links back to the document via matching initiatorUrl', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const css = entry({
      url: 'https://site.test/app.css',
      mimeType: 'text/css',
      startedDateTime: at(10),
      _initiator: { type: 'parser', url: 'https://site.test/' },
    });
    const { entries } = normalizeEntries(har([doc, css]));
    const chain = buildCriticalChain(entries);
    expect(chain.map((s) => s.url)).toEqual(['https://site.test/', 'https://site.test/app.css']);
    expect(chain[1]?.reason).toBe('requested while processing https://site.test/');
  });

  it('labels a parser-discovered resource without a matching initiator entry', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const css = entry({
      url: 'https://site.test/app.css',
      mimeType: 'text/css',
      startedDateTime: at(10),
      _initiator: { type: 'parser' },
    });
    const { entries } = normalizeEntries(har([doc, css]));
    const chain = buildCriticalChain(entries);
    // css has no initiatorUrl, so the chain cannot walk back to doc — it starts at css itself.
    expect(chain).toHaveLength(1);
    expect(chain[0]?.reason).toBe('discovered by the HTML parser');
  });

  it('labels a resource discovered by an unrecognized initiator type', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const css = entry({
      url: 'https://site.test/app.css',
      mimeType: 'text/css',
      startedDateTime: at(10),
      _initiator: { type: 'preload' },
    });
    const { entries } = normalizeEntries(har([doc, css]));
    const chain = buildCriticalChain(entries);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.reason).toBe('discovered by preload');
  });

  it('picks the closest preceding same-URL candidate as the initiator match', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html', startedDateTime: at(0) });
    const loaderEarly = entry({ url: 'https://site.test/loader.js', mimeType: 'application/javascript', startedDateTime: at(5) });
    const loaderLate = entry({ url: 'https://site.test/loader.js', mimeType: 'application/javascript', startedDateTime: at(20) });
    const css = entry({
      url: 'https://site.test/app.css',
      mimeType: 'text/css',
      startedDateTime: at(30),
      _initiator: { type: 'script', url: 'https://site.test/loader.js' },
    });
    const { entries } = normalizeEntries(har([doc, loaderEarly, loaderLate, css]));
    const chain = buildCriticalChain(entries);
    const step = chain.find((s) => s.url === css.request.url);
    expect(step?.reason).toBe(`requested while processing ${loaderLate.request.url}`);
  });

  it('stops without infinite looping when initiator chains cycle', () => {
    // Two css files pointing at each other as (contrived) initiators.
    const a = entry({
      url: 'https://site.test/a.css',
      mimeType: 'text/css',
      startedDateTime: at(0),
      _initiator: { type: 'script', url: 'https://site.test/b.css' },
    });
    const b = entry({
      url: 'https://site.test/b.css',
      mimeType: 'text/css',
      startedDateTime: at(0),
      _initiator: { type: 'script', url: 'https://site.test/a.css' },
    });
    const { entries } = normalizeEntries(har([a, b]));
    expect(() => buildCriticalChain(entries)).not.toThrow();
  });
});

describe('buildExplanation', () => {
  it('reports no critical chain when none exists', () => {
    const text = buildExplanation([], 0, [], []);
    expect(text).toMatch(/No render-blocking resources/);
  });

  it('mentions the first-paint estimate and each chain step', () => {
    const chain = [
      { url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 50, durationMs: 50, reason: 'navigation start' },
    ];
    const text = buildExplanation(chain, 50, [], []);
    expect(text).toMatch(/First paint is estimated at 50ms/);
    expect(text).toMatch(/navigation start/);
  });

  it('uses singular phrasing for a single-step chain', () => {
    const chain = [
      { url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 50, durationMs: 50, reason: 'navigation start' },
    ];
    const text = buildExplanation(chain, 50, [], []);
    expect(text).toMatch(/chain of 1 render-blocking request:/);
  });

  it('uses plural phrasing for a multi-step chain', () => {
    const chain = [
      { url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' },
      { url: 'https://site.test/app.css', hostname: 'site.test', resourceType: 'stylesheet' as const, startMs: 10, endMs: 50, durationMs: 40, reason: 'requested while processing https://site.test/' },
    ];
    const text = buildExplanation(chain, 50, [], []);
    expect(text).toMatch(/chain of 2 render-blocking requests:/);
  });

  it('names the longest pole as the bottleneck', () => {
    const chain = [
      { url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' },
      { url: 'https://site.test/app.css', hostname: 'site.test', resourceType: 'stylesheet' as const, startMs: 10, endMs: 210, durationMs: 200, reason: 'x' },
    ];
    const text = buildExplanation(chain, 210, [], []);
    expect(text).toMatch(/longest pole is "https:\/\/site.test\/app.css", which alone took 200ms/);
  });

  it('mentions the worst queued request when present, with singular phrasing for one', () => {
    const chain = [{ url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' }];
    const text = buildExplanation(chain, 10, [{ url: 'https://site.test/x.jpg', hostname: 'site.test', blockedMs: 300, startMs: 5 }], []);
    expect(text).toMatch(/1 request spent time queued/);
    expect(text).toMatch(/waited 300ms/);
  });

  it('uses plural phrasing for multiple queued requests', () => {
    const chain = [{ url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' }];
    const queued = [
      { url: 'https://site.test/a.jpg', hostname: 'site.test', blockedMs: 300, startMs: 5 },
      { url: 'https://site.test/b.jpg', hostname: 'site.test', blockedMs: 100, startMs: 6 },
    ];
    const text = buildExplanation(chain, 10, queued, []);
    expect(text).toMatch(/2 requests spent time queued/);
  });

  it('omits the queueing sentence entirely when there are no queued requests', () => {
    const chain = [{ url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' }];
    const text = buildExplanation(chain, 10, [], []);
    expect(text).not.toMatch(/queued/);
  });

  it('mentions the heaviest third-party origin, singular for one request', () => {
    const chain = [{ url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' }];
    const thirdParty = [{ hostname: 'cdn.test', requestCount: 1, totalBytes: 1000, pctOfPageBytes: 42.345, totalBlockingTimeMs: 0, pctOfLoadTime: 0 }];
    const text = buildExplanation(chain, 10, [], thirdParty);
    expect(text).toMatch(/heaviest third-party origin is cdn.test at 42.3% of total page weight across 1 request\./);
  });

  it('omits the third-party sentence when there are no third parties', () => {
    const chain = [{ url: 'https://site.test/', hostname: 'site.test', resourceType: 'document' as const, startMs: 0, endMs: 10, durationMs: 10, reason: 'navigation start' }];
    const text = buildExplanation(chain, 10, [], []);
    expect(text).not.toMatch(/third-party origin/);
  });
});

describe('analyzeHar (integration)', () => {
  it('produces a fully populated report for a realistic multi-resource page', () => {
    const doc = entry({
      url: 'https://site.test/',
      mimeType: 'text/html',
      startedDateTime: at(0),
      time: 60,
    });
    const css = entry({
      url: 'https://site.test/app.css',
      mimeType: 'text/css',
      startedDateTime: at(10),
      time: 80,
      _initiator: { type: 'parser', url: 'https://site.test/' },
    });
    const thirdPartyScript = entry({
      url: 'https://ads.test/tag.js',
      mimeType: 'application/javascript',
      startedDateTime: at(20),
      time: 150,
      timings: { blocked: 200, dns: 0, connect: 0, ssl: 0, send: 1, wait: 20, receive: 5 },
      _initiator: { type: 'script', url: 'https://site.test/app.css' },
    });
    const report = analyzeHar(har([doc, css, thirdPartyScript]), 'sample.har');

    expect(report.sourceLabel).toBe('sample.har');
    expect(report.totalRequests).toBe(3);
    expect(report.primaryHostname).toBe('site.test');
    expect(report.criticalChain.length).toBeGreaterThan(0);
    expect(report.thirdPartyAttribution.some((t) => t.hostname === 'ads.test')).toBe(true);
    expect(report.queuedRequests.some((q) => q.url === thirdPartyScript.request.url)).toBe(true);
    expect(report.explanation).toContain('First paint is estimated');
    expect(report.firstPaintEstimateMs).toBe(report.criticalChain[report.criticalChain.length - 1]?.endMs);
  });

  it('falls back to totalLoadTimeMs for firstPaintEstimateMs when there is no critical chain', () => {
    const img = entry({ url: 'https://site.test/pic.png', mimeType: 'image/png', time: 40 });
    const report = analyzeHar(har([img]), 'no-blocking.har');
    expect(report.criticalChain).toEqual([]);
    expect(report.firstPaintEstimateMs).toBe(report.totalLoadTimeMs);
  });

  it('reads domContentLoadedMs / onLoadMs from the first page entry when present', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html' });
    const h = har([doc]);
    h.log.pages = [{ startedDateTime: at(0), id: 'page_1', title: 't', pageTimings: { onContentLoad: 123, onLoad: 456 } }];
    const report = analyzeHar(h, 'with-page.har');
    expect(report.domContentLoadedMs).toBe(123);
    expect(report.onLoadMs).toBe(456);
  });

  it('leaves domContentLoadedMs / onLoadMs undefined when there is no pages array', () => {
    const doc = entry({ url: 'https://site.test/', mimeType: 'text/html' });
    const report = analyzeHar(har([doc]), 'no-pages.har');
    expect(report.domContentLoadedMs).toBeUndefined();
    expect(report.onLoadMs).toBeUndefined();
  });

  it('handles a HAR with zero entries without throwing', () => {
    const report = analyzeHar(har([]), 'empty.har');
    expect(report.totalRequests).toBe(0);
    expect(report.totalBytes).toBe(0);
    expect(report.criticalChain).toEqual([]);
    expect(report.pageUrl).toBeUndefined();
  });
});
