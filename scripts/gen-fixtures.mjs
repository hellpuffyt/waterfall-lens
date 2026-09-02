// One-off generator for the sample HAR fixtures committed under fixtures/.
// Not part of the build; run manually with `node scripts/gen-fixtures.mjs`
// whenever a fixture needs regenerating so the shape stays consistent.
import { writeFileSync } from 'node:fs';

const ORIGIN = '2024-03-14T09:00:00.000';

function iso(offsetMs) {
  const d = new Date(ORIGIN + 'Z');
  d.setUTCMilliseconds(d.getUTCMilliseconds() + offsetMs);
  return d.toISOString().replace('Z', '') + 'Z';
}

function entry({
  url,
  method = 'GET',
  status = 200,
  mimeType,
  startMs,
  blocked = 0,
  dns = 0,
  connect = 0,
  ssl = -1,
  send = 0.2,
  wait,
  receive,
  size,
  initiatorType,
  initiatorUrl,
}) {
  const time = blocked + Math.max(dns, 0) + Math.max(connect, 0) + Math.max(ssl, 0) + send + wait + receive;
  return {
    startedDateTime: iso(startMs),
    time,
    request: {
      method,
      url,
      httpVersion: 'HTTP/1.1',
      headers: [],
      headersSize: 200,
      bodySize: 0,
    },
    response: {
      status,
      statusText: status === 200 ? 'OK' : 'Not Modified',
      httpVersion: 'HTTP/1.1',
      headers: [{ name: 'content-type', value: mimeType }],
      content: { size, mimeType },
      redirectURL: '',
      headersSize: 250,
      bodySize: size,
      _transferSize: size + 250,
    },
    cache: {},
    timings: { blocked, dns, connect, ssl, send, wait, receive },
    serverIPAddress: '93.184.216.34',
    connection: '80',
    ...(initiatorType ? { _initiator: { type: initiatorType, url: initiatorUrl } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Fixture 1: a heavy news-style article page with an ad/analytics tail.
// ---------------------------------------------------------------------------
const heavy = {
  log: {
    version: '1.2',
    creator: { name: 'waterfall-lens fixture generator', version: '1.0' },
    pages: [
      {
        startedDateTime: iso(0),
        id: 'page_1',
        title: 'https://example-news.test/articles/rocket-launch',
        pageTimings: { onContentLoad: 890, onLoad: 2400 },
      },
    ],
    entries: [
      entry({
        url: 'https://example-news.test/articles/rocket-launch',
        mimeType: 'text/html',
        startMs: 0,
        dns: 20,
        connect: 30,
        ssl: 40,
        wait: 180,
        receive: 30,
        size: 18000,
      }),
      entry({
        url: 'https://example-news.test/static/main.css',
        mimeType: 'text/css',
        startMs: 305,
        wait: 60,
        receive: 15,
        size: 42000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://example-news.test/static/app.js',
        mimeType: 'application/javascript',
        startMs: 306,
        wait: 140,
        receive: 55,
        size: 210000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://fonts.example-cdn.test/inter-var.woff2',
        mimeType: 'font/woff2',
        startMs: 320,
        dns: 15,
        connect: 25,
        ssl: 30,
        wait: 90,
        receive: 20,
        size: 84000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://example-news.test/static/analytics-loader.js',
        mimeType: 'application/javascript',
        startMs: 310,
        wait: 35,
        receive: 10,
        size: 4200,
        initiatorType: 'parser',
      }),
      // Injected by analytics-loader.js — script-initiated, so non-blocking by classification.
      entry({
        url: 'https://ads.thirdparty-cdn.test/tag.js',
        mimeType: 'application/javascript',
        startMs: 370,
        blocked: 25,
        dns: 30,
        connect: 40,
        ssl: 45,
        wait: 210,
        receive: 40,
        size: 156000,
        initiatorType: 'script',
        initiatorUrl: 'https://example-news.test/static/analytics-loader.js',
      }),
      entry({
        url: 'https://ads.thirdparty-cdn.test/pixel.gif',
        mimeType: 'image/gif',
        startMs: 745,
        wait: 55,
        receive: 5,
        size: 43,
        initiatorType: 'script',
        initiatorUrl: 'https://ads.thirdparty-cdn.test/tag.js',
      }),
      entry({
        url: 'https://analytics.thirdparty-cdn.test/collect',
        method: 'POST',
        mimeType: 'application/json',
        startMs: 760,
        blocked: 15,
        dns: 20,
        connect: 25,
        ssl: 28,
        wait: 90,
        receive: 8,
        size: 120,
        initiatorType: 'script',
        initiatorUrl: 'https://ads.thirdparty-cdn.test/tag.js',
      }),
      entry({
        url: 'https://example-news.test/static/hero.jpg',
        mimeType: 'image/jpeg',
        startMs: 400,
        blocked: 22,
        wait: 120,
        receive: 60,
        size: 340000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://example-news.test/static/thumb-1.jpg',
        mimeType: 'image/jpeg',
        startMs: 402,
        // Queued behind the 6-per-host connection limit: no DNS/connect/SSL cost, pure queueing.
        blocked: 340,
        wait: 60,
        receive: 20,
        size: 62000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://example-news.test/static/thumb-2.jpg',
        mimeType: 'image/jpeg',
        startMs: 404,
        blocked: 360,
        wait: 58,
        receive: 18,
        size: 60000,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://widgets.thirdparty-cdn.test/comments.js',
        mimeType: 'application/javascript',
        startMs: 900,
        blocked: 10,
        dns: 25,
        connect: 35,
        ssl: 40,
        wait: 160,
        receive: 30,
        size: 98000,
        initiatorType: 'script',
        initiatorUrl: 'https://example-news.test/static/app.js',
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Fixture 2: a fast, lean marketing page — near-instant first paint, no
// third parties at all. Exercises the "nothing much to report" path.
// ---------------------------------------------------------------------------
const lean = {
  log: {
    version: '1.2',
    creator: { name: 'waterfall-lens fixture generator', version: '1.0' },
    pages: [
      {
        startedDateTime: iso(0),
        id: 'page_1',
        title: 'https://fastsite.test/',
        pageTimings: { onContentLoad: 140, onLoad: 210 },
      },
    ],
    entries: [
      entry({
        url: 'https://fastsite.test/',
        mimeType: 'text/html',
        startMs: 0,
        dns: 5,
        connect: 10,
        ssl: 12,
        wait: 40,
        receive: 8,
        size: 3200,
      }),
      entry({
        url: 'https://fastsite.test/critical.css',
        mimeType: 'text/css',
        startMs: 80,
        wait: 18,
        receive: 4,
        size: 2100,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://fastsite.test/app.js',
        mimeType: 'application/javascript',
        startMs: 82,
        wait: 22,
        receive: 6,
        size: 8400,
        initiatorType: 'parser',
      }),
      entry({
        url: 'https://fastsite.test/logo.svg',
        mimeType: 'image/svg+xml',
        startMs: 90,
        wait: 12,
        receive: 3,
        size: 1800,
        initiatorType: 'parser',
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Fixture 3: an edge-case capture — a single document entry, no third
// parties, no CSS/JS at all (e.g. a plain-text or redirect-only capture).
// ---------------------------------------------------------------------------
const minimal = {
  log: {
    version: '1.2',
    creator: { name: 'waterfall-lens fixture generator', version: '1.0' },
    entries: [
      entry({
        url: 'https://bare.test/',
        mimeType: 'text/html',
        startMs: 0,
        wait: 50,
        receive: 10,
        size: 512,
      }),
    ],
  },
};

writeFileSync('fixtures/news-article-heavy.har', JSON.stringify(heavy, null, 2) + '\n');
writeFileSync('fixtures/fast-marketing-page.har', JSON.stringify(lean, null, 2) + '\n');
writeFileSync('fixtures/minimal-single-request.har', JSON.stringify(minimal, null, 2) + '\n');
console.log('Wrote fixtures/news-article-heavy.har, fixtures/fast-marketing-page.har, fixtures/minimal-single-request.har');
