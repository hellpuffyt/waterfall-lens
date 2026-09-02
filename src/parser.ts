import { readFileSync } from 'node:fs';
import type { Har, HarEntry } from './types.js';

export class HarParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarParseError';
  }
}

/** Structural validation — enough to catch truncated/hand-edited/non-HAR JSON early with a useful message. */
export function validateHar(data: unknown): asserts data is Har {
  if (typeof data !== 'object' || data === null) {
    throw new HarParseError('Not a JSON object at the top level.');
  }
  const log = (data as { log?: unknown }).log;
  if (typeof log !== 'object' || log === null) {
    throw new HarParseError('Missing required "log" object.');
  }
  const entries = (log as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    throw new HarParseError('Missing required "log.entries" array.');
  }
  entries.forEach((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new HarParseError(`log.entries[${i}] is not an object.`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.startedDateTime !== 'string') {
      throw new HarParseError(`log.entries[${i}].startedDateTime is missing or not a string.`);
    }
    if (typeof e.time !== 'number') {
      throw new HarParseError(`log.entries[${i}].time is missing or not a number.`);
    }
    const request = e.request;
    if (typeof request !== 'object' || request === null || typeof (request as Record<string, unknown>).url !== 'string') {
      throw new HarParseError(`log.entries[${i}].request.url is missing or not a string.`);
    }
    const response = e.response;
    if (typeof response !== 'object' || response === null || typeof (response as Record<string, unknown>).status !== 'number') {
      throw new HarParseError(`log.entries[${i}].response.status is missing or not a number.`);
    }
    const timings = e.timings;
    if (typeof timings !== 'object' || timings === null) {
      throw new HarParseError(`log.entries[${i}].timings is missing.`);
    }
    const timingsObj = timings as Record<string, unknown>;
    for (const field of ['send', 'wait', 'receive']) {
      if (typeof timingsObj[field] !== 'number') {
        throw new HarParseError(`log.entries[${i}].timings.${field} is missing or not a number.`);
      }
    }
  });
}

export function parseHar(raw: string): Har {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new HarParseError(`Invalid JSON: ${(err as Error).message}`);
  }
  validateHar(data);
  return data;
}

export function loadHarFile(path: string): Har {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new HarParseError(`Could not read file "${path}": ${(err as Error).message}`);
  }
  return parseHar(raw);
}

/** Entries sorted by wall-clock start time; HAR does not guarantee entry order. */
export function sortedEntries(har: Har): HarEntry[] {
  return [...har.log.entries].sort(
    (a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime),
  );
}
