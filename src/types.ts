/**
 * Minimal but spec-accurate HAR 1.2 types.
 * See http://www.softwareishard.com/blog/har-12-spec/
 * Only the fields waterfall-lens actually reads are modeled strictly;
 * everything else is passed through loosely so real-world captures
 * (which routinely add vendor extension fields) still parse.
 */

export interface HarTimings {
  blocked?: number;
  dns?: number;
  connect?: number;
  send: number;
  wait: number;
  receive: number;
  ssl?: number;
  comment?: string;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: HarHeader[];
  headersSize: number;
  bodySize: number;
}

export interface HarContent {
  size: number;
  compression?: number;
  mimeType: string;
  text?: string;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: HarHeader[];
  content: HarContent;
  redirectURL: string;
  headersSize: number;
  bodySize: number;
  _transferSize?: number;
}

/**
 * Chrome/Edge DevTools export this on every entry even though it is not
 * part of the HAR 1.2 spec. When present it is the only reliable signal
 * for "what caused this request", so waterfall-lens uses it when
 * available and falls back to timing-overlap heuristics when it is not.
 */
export interface HarInitiator {
  /** Known values: "parser" | "script" | "preload" | "other" | "redirect"; widened to string since real captures vary. */
  type: string;
  url?: string;
  lineNumber?: number;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache: Record<string, unknown>;
  timings: HarTimings;
  pageref?: string;
  serverIPAddress?: string;
  connection?: string;
  _initiator?: HarInitiator;
}

export interface HarPageTimings {
  onContentLoad?: number;
  onLoad?: number;
  comment?: string;
}

export interface HarPage {
  startedDateTime: string;
  id: string;
  title: string;
  /** Required by the HAR spec, but hand-edited and some exported files omit it. */
  pageTimings?: HarPageTimings;
}

export interface HarLog {
  version: string;
  creator: { name: string; version: string };
  pages?: HarPage[];
  entries: HarEntry[];
}

export interface Har {
  log: HarLog;
}
