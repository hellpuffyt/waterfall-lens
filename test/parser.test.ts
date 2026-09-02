import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHar, loadHarFile, validateHar, sortedEntries, HarParseError } from '../src/parser.js';
import type { Har } from '../src/types.js';

function makeEntry(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    startedDateTime: '2024-01-01T00:00:00.000Z',
    time: 100,
    request: { method: 'GET', url: 'https://a.test/', httpVersion: 'HTTP/1.1', headers: [], headersSize: 0, bodySize: 0 },
    response: {
      status: 200,
      statusText: 'OK',
      httpVersion: 'HTTP/1.1',
      headers: [],
      content: { size: 10, mimeType: 'text/html' },
      redirectURL: '',
      headersSize: 0,
      bodySize: 10,
    },
    cache: {},
    timings: { send: 1, wait: 50, receive: 5 },
    ...overrides,
  };
}

function makeHar(entries: unknown[]): Record<string, unknown> {
  return { log: { version: '1.2', creator: { name: 'x', version: '1' }, entries } };
}

describe('validateHar', () => {
  it('accepts a minimal valid HAR', () => {
    expect(() => { validateHar(makeHar([makeEntry()])); }).not.toThrow();
  });

  it('rejects a non-object top level', () => {
    expect(() => { validateHar('nope'); }).toThrow(HarParseError);
    expect(() => { validateHar(null); }).toThrow(HarParseError);
    expect(() => { validateHar(42); }).toThrow(HarParseError);
  });

  it('rejects a missing log object', () => {
    expect(() => { validateHar({}); }).toThrow(/Missing required "log"/);
    expect(() => { validateHar({ log: null }); }).toThrow(/Missing required "log"/);
  });

  it('rejects a missing entries array', () => {
    expect(() => { validateHar({ log: {} }); }).toThrow(/Missing required "log.entries"/);
    expect(() => { validateHar({ log: { entries: 'nope' } }); }).toThrow(/Missing required "log.entries"/);
  });

  it('rejects an entry that is not an object', () => {
    expect(() => { validateHar(makeHar([null])); }).toThrow(/entries\[0\] is not an object/);
  });

  it('rejects an entry missing startedDateTime', () => {
    const e = makeEntry();
    delete (e).startedDateTime;
    expect(() => { validateHar(makeHar([e])); }).toThrow(/startedDateTime is missing/);
  });

  it('rejects an entry with non-string startedDateTime', () => {
    expect(() => { validateHar(makeHar([makeEntry({ startedDateTime: 123 })])); }).toThrow(/startedDateTime/);
  });

  it('rejects an entry missing time', () => {
    const e = makeEntry();
    delete (e).time;
    expect(() => { validateHar(makeHar([e])); }).toThrow(/\.time is missing/);
  });

  it('rejects an entry with a non-numeric time', () => {
    expect(() => { validateHar(makeHar([makeEntry({ time: '100' })])); }).toThrow(/\.time is missing or not a number/);
  });

  it('rejects an entry with a missing request.url', () => {
    expect(() => { validateHar(makeHar([makeEntry({ request: {} })])); }).toThrow(/request\.url is missing/);
  });

  it('rejects an entry with a non-object request', () => {
    expect(() => { validateHar(makeHar([makeEntry({ request: 'nope' })])); }).toThrow(/request\.url is missing/);
  });

  it('rejects an entry with a missing response.status', () => {
    expect(() => { validateHar(makeHar([makeEntry({ response: {} })])); }).toThrow(/response\.status is missing/);
  });

  it('rejects an entry with a non-object response', () => {
    expect(() => { validateHar(makeHar([makeEntry({ response: 3 })])); }).toThrow(/response\.status is missing/);
  });

  it('rejects an entry with missing timings', () => {
    expect(() => { validateHar(makeHar([makeEntry({ timings: null })])); }).toThrow(/timings is missing/);
  });

  it('rejects timings missing required numeric fields', () => {
    expect(() => { validateHar(makeHar([makeEntry({ timings: { send: 1, wait: 2 } })])); }).toThrow(/timings\.receive/);
    expect(() => { validateHar(makeHar([makeEntry({ timings: { wait: 2, receive: 3 } })])); }).toThrow(/timings\.send/);
    expect(() => { validateHar(makeHar([makeEntry({ timings: { send: 1, receive: 3 } })])); }).toThrow(/timings\.wait/);
  });

  it('reports the correct index for the second bad entry', () => {
    expect(() => { validateHar(makeHar([makeEntry(), makeEntry({ time: undefined })])); }).toThrow(/entries\[1\]/);
  });
});

describe('parseHar', () => {
  it('parses valid JSON into a Har', () => {
    const har = parseHar(JSON.stringify(makeHar([makeEntry()])));
    expect(har.log.entries).toHaveLength(1);
  });

  it('throws a HarParseError with a message on invalid JSON', () => {
    expect(() => parseHar('{not json')).toThrow(HarParseError);
    expect(() => parseHar('{not json')).toThrow(/Invalid JSON/);
  });

  it('propagates structural validation errors', () => {
    expect(() => parseHar('{}')).toThrow(/Missing required "log"/);
  });
});

describe('loadHarFile', () => {
  it('reads and parses a HAR file from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-test-'));
    const path = join(dir, 'sample.har');
    writeFileSync(path, JSON.stringify(makeHar([makeEntry()])));
    const har = loadHarFile(path);
    expect(har.log.entries).toHaveLength(1);
  });

  it('throws a HarParseError when the file does not exist', () => {
    expect(() => loadHarFile('/does/not/exist.har')).toThrow(HarParseError);
    expect(() => loadHarFile('/does/not/exist.har')).toThrow(/Could not read file/);
  });
});

describe('sortedEntries', () => {
  it('sorts entries by startedDateTime ascending', () => {
    const har: Har = makeHar([
      makeEntry({ startedDateTime: '2024-01-01T00:00:02.000Z', request: { ...(makeEntry().request as object), url: 'https://a.test/second' } }),
      makeEntry({ startedDateTime: '2024-01-01T00:00:01.000Z', request: { ...(makeEntry().request as object), url: 'https://a.test/first' } }),
    ]) as unknown as Har;
    const sorted = sortedEntries(har);
    expect(sorted.map((e) => e.request.url)).toEqual(['https://a.test/first', 'https://a.test/second']);
  });

  it('does not mutate the original entries array', () => {
    const har: Har = makeHar([
      makeEntry({ startedDateTime: '2024-01-01T00:00:02.000Z' }),
      makeEntry({ startedDateTime: '2024-01-01T00:00:01.000Z' }),
    ]) as unknown as Har;
    const before = har.log.entries.map((e) => e.startedDateTime);
    sortedEntries(har);
    expect(har.log.entries.map((e) => e.startedDateTime)).toEqual(before);
  });

  it('returns an empty array for an empty HAR', () => {
    const har: Har = makeHar([]) as unknown as Har;
    expect(sortedEntries(har)).toEqual([]);
  });
});
