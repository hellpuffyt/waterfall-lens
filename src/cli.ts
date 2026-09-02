#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadHarFile, HarParseError } from './parser.js';
import { analyzeHar } from './analyze.js';
import { renderHtmlReport } from './html.js';

const USAGE = `waterfall-lens — analyse a HAR capture into an interactive waterfall

Usage:
  waterfall-lens analyze <file.har> [--json]
  waterfall-lens report <file.har> [--out <path.html>]
  waterfall-lens --help

Commands:
  analyze   Print the plain-English first-paint explanation and a summary
            (or the full report as JSON with --json) to stdout.
  report    Write a self-contained interactive HTML waterfall report.
            Defaults to <file>.report.html next to the input.
`;

function fail(message: string): never {
  process.stderr.write(`waterfall-lens: ${message}\n`);
  process.exit(1);
}

function runAnalyze(args: string[]): void {
  const jsonFlag = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('analyze requires a <file.har> argument.');

  let har;
  try {
    har = loadHarFile(file);
  } catch (err) {
    fail(err instanceof HarParseError ? err.message : String(err));
  }
  const report = analyzeHar(har, basename(file));

  if (jsonFlag) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`waterfall-lens: ${report.sourceLabel}\n`);
  process.stdout.write(`${report.totalRequests} requests, ${report.totalBytes} bytes, load time ${Math.round(report.totalLoadTimeMs)}ms\n\n`);
  process.stdout.write(`${report.explanation}\n`);
}

function runReport(args: string[]): void {
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) fail('report requires a <file.har> argument.');

  const outFlagIndex = args.indexOf('--out');
  const out = outFlagIndex !== -1 ? args[outFlagIndex + 1] : `${file}.report.html`;
  if (!out) fail('--out requires a path argument.');

  let har;
  try {
    har = loadHarFile(file);
  } catch (err) {
    fail(err instanceof HarParseError ? err.message : String(err));
  }
  const report = analyzeHar(har, basename(file));
  const html = renderHtmlReport(report);
  writeFileSync(out, html, 'utf-8');
  process.stdout.write(`Wrote ${out} (${report.totalRequests} requests analysed)\n`);
}

export function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case 'analyze':
      runAnalyze(rest);
      break;
    case 'report':
      runReport(rest);
      break;
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

/* c8 ignore start -- process.argv entrypoint, exercised via CLI integration tests spawning node */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
/* c8 ignore stop */
