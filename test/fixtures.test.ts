import { describe, it, expect } from 'vitest';
import { loadHarFile } from '../src/parser.js';
import { analyzeHar } from '../src/analyze.js';
import { renderHtmlReport } from '../src/html.js';

const FIXTURES = [
  { file: 'fixtures/news-article-heavy.har', minRequests: 10 },
  { file: 'fixtures/fast-marketing-page.har', minRequests: 3 },
  { file: 'fixtures/minimal-single-request.har', minRequests: 1 },
];

describe('sample fixtures', () => {
  for (const { file, minRequests } of FIXTURES) {
    it(`parses and analyzes ${file} end to end`, () => {
      const har = loadHarFile(file);
      const report = analyzeHar(har, file);
      expect(report.totalRequests).toBeGreaterThanOrEqual(minRequests);
      expect(report.explanation.length).toBeGreaterThan(0);
      const html = renderHtmlReport(report);
      expect(html).toMatch(/^<!doctype html>/);
    });
  }

  it('flags ads.thirdparty-cdn.test as third-party weight in the heavy fixture', () => {
    const report = analyzeHar(loadHarFile('fixtures/news-article-heavy.har'), 'x');
    expect(report.thirdPartyAttribution.some((t) => t.hostname === 'ads.thirdparty-cdn.test')).toBe(true);
  });

  it('finds queued (connection-limited) requests in the heavy fixture', () => {
    const report = analyzeHar(loadHarFile('fixtures/news-article-heavy.har'), 'x');
    expect(report.queuedRequests.length).toBeGreaterThan(0);
  });

  it('produces a non-trivial critical chain for the heavy fixture', () => {
    const report = analyzeHar(loadHarFile('fixtures/news-article-heavy.har'), 'x');
    expect(report.criticalChain.length).toBeGreaterThan(0);
  });

  it('reports no third parties for the minimal fixture', () => {
    const report = analyzeHar(loadHarFile('fixtures/minimal-single-request.har'), 'x');
    expect(report.thirdPartyAttribution).toEqual([]);
  });

  it('estimates a fast first paint for the lean marketing fixture', () => {
    const report = analyzeHar(loadHarFile('fixtures/fast-marketing-page.har'), 'x');
    expect(report.firstPaintEstimateMs).toBeLessThan(150);
  });
});
