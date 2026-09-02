import { describe, it, expect } from 'vitest';
import { analyzeHar } from '../src/analyze.js';
import { renderHtmlReport } from '../src/html.js';
import type { Har, HarEntry } from '../src/types.js';

function entry(overrides: Partial<HarEntry> & { url?: string; mimeType?: string } = {}): HarEntry {
  const { url = 'https://site.test/', mimeType = 'text/html', ...rest } = overrides;
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

describe('renderHtmlReport', () => {
  it('produces a self-contained document with no external resource references', () => {
    const report = analyzeHar(har([entry()]), 'test.har');
    const html = renderHtmlReport(report);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  it('embeds the report data as JSON inside a script tag', () => {
    const report = analyzeHar(har([entry({ url: 'https://site.test/embedded-marker' })]), 'test.har');
    const html = renderHtmlReport(report);
    expect(html).toContain('id="report-data"');
    expect(html).toContain('embedded-marker');
  });

  it('escapes "<" in embedded JSON so it cannot break out of the script tag', () => {
    const report = analyzeHar(har([entry({ url: 'https://site.test/</script><script>alert(1)' })]), 'test.har');
    const html = renderHtmlReport(report);
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script>');
  });

  it('HTML-escapes the source label in the title and page head', () => {
    const report = analyzeHar(har([entry()]), '<img src=x onerror=alert(1)>.har');
    const html = renderHtmlReport(report);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.har');
    expect(html).not.toContain('<img src=x onerror=alert(1)>.har</title>');
  });

  it('includes the zoom control, filter checkboxes, and legend markup', () => {
    const report = analyzeHar(har([entry()]), 'test.har');
    const html = renderHtmlReport(report);
    expect(html).toContain('id="zoom-range"');
    expect(html).toContain('id="third-party-only"');
    expect(html).toContain('id="blocking-only"');
    expect(html).toContain('id="legend"');
  });

  it('includes a click-to-highlight hint for the initiator chain', () => {
    const report = analyzeHar(har([entry()]), 'test.har');
    const html = renderHtmlReport(report);
    expect(html).toMatch(/initiator chain/);
  });

  it('renders identically regardless of report size (smoke test on a larger report)', () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      entry({ url: `https://site.test/r${i}.js`, mimeType: 'application/javascript', startedDateTime: '2024-01-01T00:00:00.010Z' }),
    );
    const report = analyzeHar(har([entry(), ...entries]), 'big.har');
    const html = renderHtmlReport(report);
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('waterfall-lens');
  });

  it('does not throw when rendering a report with zero entries', () => {
    const report = analyzeHar(har([]), 'empty.har');
    expect(() => renderHtmlReport(report)).not.toThrow();
    const html = renderHtmlReport(report);
    expect(html).toContain('report-data');
  });
});
