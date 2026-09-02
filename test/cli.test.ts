import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';

let dir: string;
let harPath: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;
interface Restorable {
  mockRestore: () => void;
}
let stdoutSpy: Restorable;
let stderrSpy: Restorable;
let exitSpy: Restorable;

const VALID_HAR = JSON.stringify({
  log: {
    version: '1.2',
    creator: { name: 'x', version: '1' },
    entries: [
      {
        startedDateTime: '2024-01-01T00:00:00.000Z',
        time: 50,
        request: { method: 'GET', url: 'https://site.test/', httpVersion: 'HTTP/1.1', headers: [], headersSize: 10, bodySize: 0 },
        response: {
          status: 200,
          statusText: 'OK',
          httpVersion: 'HTTP/1.1',
          headers: [],
          content: { size: 100, mimeType: 'text/html' },
          redirectURL: '',
          headersSize: 10,
          bodySize: 100,
        },
        cache: {},
        timings: { send: 1, wait: 40, receive: 9 },
      },
    ],
  },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wl-cli-'));
  harPath = join(dir, 'sample.har');
  writeFileSync(harPath, VALID_HAR);
  stdout = [];
  stderr = [];
  exitCode = undefined;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error(`process.exit(${String(code)})`);
  }) as never);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI: help', () => {
  it('prints usage with no arguments', () => {
    main([]);
    expect(stdout.join('')).toMatch(/waterfall-lens — analyse a HAR capture/);
  });

  it('prints usage with --help', () => {
    main(['--help']);
    expect(stdout.join('')).toMatch(/Usage:/);
  });

  it('prints usage with -h', () => {
    main(['-h']);
    expect(stdout.join('')).toMatch(/Usage:/);
  });
});

describe('CLI: unknown command', () => {
  it('fails with a message and exit code 1', () => {
    expect(() => { main(['bogus']); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/Unknown command "bogus"/);
  });
});

describe('CLI: analyze', () => {
  it('fails when no file argument is given', () => {
    expect(() => { main(['analyze']); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/analyze requires a <file.har> argument/);
  });

  it('prints a human-readable summary and explanation by default', () => {
    main(['analyze', harPath]);
    const out = stdout.join('');
    expect(out).toMatch(/waterfall-lens: sample\.har/);
    expect(out).toMatch(/1 requests/);
    expect(out).toMatch(/First paint is estimated/);
  });

  it('prints full JSON with --json', () => {
    main(['analyze', harPath, '--json']);
    const parsed: unknown = JSON.parse(stdout.join(''));
    expect(parsed).toMatchObject({ sourceLabel: 'sample.har', totalRequests: 1 });
  });

  it('fails with a clear message on invalid JSON', () => {
    const badPath = join(dir, 'bad.har');
    writeFileSync(badPath, '{not json');
    expect(() => { main(['analyze', badPath]); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/Invalid JSON/);
  });

  it('fails with a clear message on a missing file', () => {
    expect(() => { main(['analyze', join(dir, 'missing.har')]); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/Could not read file/);
  });

  it('fails with a clear message on a structurally invalid HAR', () => {
    const badPath = join(dir, 'structurally-bad.har');
    writeFileSync(badPath, JSON.stringify({ log: {} }));
    expect(() => { main(['analyze', badPath]); }).toThrow();
    expect(stderr.join('')).toMatch(/Missing required "log.entries"/);
  });
});

describe('CLI: report', () => {
  it('fails when no file argument is given', () => {
    expect(() => { main(['report']); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/report requires a <file.har> argument/);
  });

  it('writes an HTML report next to the input by default', () => {
    main(['report', harPath]);
    const outPath = `${harPath}.report.html`;
    const html = readFileSync(outPath, 'utf-8');
    expect(html).toMatch(/^<!doctype html>/);
    expect(stdout.join('')).toMatch(/Wrote .*\.report\.html \(1 requests analysed\)/);
  });

  it('writes to a custom path with --out', () => {
    const outPath = join(dir, 'custom-name.html');
    main(['report', harPath, '--out', outPath]);
    const html = readFileSync(outPath, 'utf-8');
    expect(html).toContain('waterfall-lens');
  });

  it('fails when --out is given without a path', () => {
    expect(() => { main(['report', harPath, '--out']); }).toThrow();
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toMatch(/--out requires a path argument/);
  });

  it('fails with a clear message on a missing file', () => {
    expect(() => { main(['report', join(dir, 'missing.har')]); }).toThrow();
    expect(stderr.join('')).toMatch(/Could not read file/);
  });
});
