/**
 * Hostile and malformed HAR input. HAR files come from anywhere (bug reports,
 * support tickets, other people's captures), so every string in them is
 * untrusted: the HTML report must render them as text, and malformed files
 * must end in a clear error rather than a crash or NaN output.
 */
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyzeHar } from '../src/analyze.js';
import { renderHtmlReport } from '../src/html.js';
import { parseHar, HarParseError } from '../src/parser.js';
import type { Har, HarEntry } from '../src/types.js';

const PAYLOAD = '"><img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';

function entry(url: string, opts: Partial<HarEntry> & { mimeType?: string; startedDateTime?: string } = {}): HarEntry {
  const { mimeType = 'text/html', ...rest } = opts;
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

function renderInDom(report: ReturnType<typeof analyzeHar>): JSDOM {
  return new JSDOM(renderHtmlReport(report), { runScripts: 'dangerously' });
}

describe('HTML report escapes untrusted HAR content', () => {
  const hostile = har([
    entry('https://site.test/'),
    // render-blocking stylesheet on a third-party host -> appears in the chain, waterfall and table
    entry(`https://evil.test/a.css?${PAYLOAD}`, {
      mimeType: 'text/css',
      startedDateTime: '2024-01-01T00:00:00.050Z',
      _initiator: { type: 'parser', url: 'https://site.test/' },
    }),
    entry(`https://evil.test/b.css?x=${PAYLOAD}`, {
      mimeType: 'text/css',
      startedDateTime: '2024-01-01T00:00:00.060Z',
      _initiator: { type: 'parser', url: `https://evil.test/a.css?${PAYLOAD}` },
    }),
  ]);

  it('no element or script from the HAR is created, and the text is shown literally', () => {
    const report = analyzeHar(hostile, `cap${PAYLOAD}.har`);
    expect(report.criticalChain.some((s) => s.url.includes('<img'))).toBe(true); // the payload really reaches the chain
    const dom = renderInDom(report);
    const doc = dom.window.document;
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(doc.querySelectorAll('script')).toHaveLength(2); // the report's own data + code blocks only
    expect((dom.window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(doc.getElementById('chain')?.textContent).toContain('<img src=x');
    expect(doc.getElementById('waterfall')?.textContent).toContain('evil.test');
  });

  it('a hostname that is not a real URL host is escaped in the third-party table', () => {
    const report = analyzeHar(hostile, 'x.har');
    report.thirdPartyAttribution.push({
      hostname: '<b id="inj">x</b>',
      requestCount: 1,
      totalBytes: 1,
      pctOfPageBytes: 1,
      totalBlockingTimeMs: 1,
      pctOfLoadTime: 1,
    });
    const doc = renderInDom(report).window.document;
    expect(doc.getElementById('inj')).toBeNull();
    expect(doc.getElementById('third-party-table')?.textContent).toContain('<b id="inj">x</b>');
  });
});

describe('malformed HAR files fail with a clear error', () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(har([entry('https://site.test/')]))) as Record<string, unknown>;
  const firstEntry = (h: Record<string, unknown>): Record<string, unknown> => {
    const entries = (h.log as Record<string, unknown>).entries as Record<string, unknown>[];
    const first = entries[0];
    if (!first) throw new Error('fixture has no entries');
    return first;
  };

  it('rejects an unparseable startedDateTime instead of producing NaN timings', () => {
    const h = base();
    firstEntry(h).startedDateTime = 'yesterday';
    expect(() => parseHar(JSON.stringify(h))).toThrow(/startedDateTime is not a valid date/);
  });

  it('rejects a missing response.content instead of crashing in analysis', () => {
    const h = base();
    delete (firstEntry(h).response as Record<string, unknown>).content;
    expect(() => parseHar(JSON.stringify(h))).toThrow(HarParseError);
  });

  it('tolerates a non-string content.mimeType', () => {
    const h = base();
    ((firstEntry(h).response as Record<string, unknown>).content as Record<string, unknown>).mimeType = 42;
    const report = analyzeHar(parseHar(JSON.stringify(h)), 'x.har');
    expect(report.entries[0]?.mimeType).toBe('application/octet-stream');
  });

  it('tolerates a page without pageTimings', () => {
    const h = base();
    (h.log as Record<string, unknown>).pages = [{ id: 'p', title: 't', startedDateTime: '2024-01-01T00:00:00.000Z' }];
    const report = analyzeHar(parseHar(JSON.stringify(h)), 'x.har');
    expect(report.onLoadMs).toBeUndefined();
  });

  it('the CLI exits 1 with a one-line message (no stack trace) for each malformed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-hostile-'));
    try {
      const cases: Record<string, string> = {
        'truncated.har': JSON.stringify(base()).slice(0, 40),
        'baddate.har': JSON.stringify(base()).replace('2024-01-01T00:00:00.000Z', 'yesterday'),
        'nocontent.har': JSON.stringify(base()).replace(/"content":\{[^}]*\},/, ''),
        'nothar.har': '[1,2,3]',
      };
      for (const [name, body] of Object.entries(cases)) {
        writeFileSync(join(dir, name), body);
        let stderr = '';
        let status = 0;
        try {
          execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'analyze', join(dir, name)], { stdio: 'pipe' });
        } catch (err) {
          const e = err as { status: number; stderr: Buffer };
          status = e.status;
          stderr = e.stderr.toString();
        }
        expect(status, name).toBe(1);
        expect(stderr, name).toMatch(/^waterfall-lens: /);
        expect(stderr, name).not.toMatch(/\n\s+at /);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('large captures', () => {
  it('analyses 20,000 entries in well under the test timeout', () => {
    const entries = [entry('https://site.test/')];
    for (let i = 0; i < 20_000; i++) {
      entries.push(
        entry(`https://site.test/i${String(i)}.js`, {
          mimeType: 'application/javascript',
          startedDateTime: '2024-01-01T00:00:00.100Z',
          _initiator: { type: 'parser', url: 'https://site.test/' },
        }),
      );
    }
    const t0 = Date.now();
    const report = analyzeHar(har(entries), 'big.har');
    expect(report.totalRequests).toBe(20_001);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });
});
